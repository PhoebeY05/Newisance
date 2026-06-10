"""Community Verification Hub: submissions, feed, and credibility-weighted votes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
import redis.asyncio as aioredis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.community_scoring import SUBMISSION_VERDICT_CREDIBILITY_DELTA
from shared.config import settings
from shared.credibility import clamp_credibility, tier_for
from shared.db.models import AiAnalysis, Comment, Submission, User, Vote
from shared.db.models import CredibilityLog, SubmissionAppeal, SubmissionCredibilityAdjustment
from shared.deps import get_current_user, get_db, get_optional_user

from schemas import (
    AppealOut,
    AiAnalysisOut,
    CommentOut,
    CreateCommentRequest,
    CreateSubmissionRequest,
    SubmissionDetail,
    SubmissionFeed,
    SubmissionOut,
    UpdateSubmissionRequest,
    VoteRequest,
    VoteResult,
)
from scoring import aggregate, vote_weight_for
from storage import save_base64_image
from tasks import enqueue_analysis

router = APIRouter(prefix='/submissions', tags=['community'])


async def _vote_rows(db: AsyncSession, submission_id: int) -> list[tuple[str, int, float]]:
    result = await db.execute(
        select(Vote.verdict, Vote.impact_score, Vote.credibility_weight).where(
            Vote.submission_id == submission_id
        )
    )
    return [(verdict, int(impact), float(weight)) for verdict, impact, weight in result.all()]


async def _aggregates_for(
    db: AsyncSession, submission_ids: list[int]
) -> dict[int, tuple[int, float | None, float | None]]:
    """Compute (count, fake_likelihood, weighted_impact) for many submissions at once."""
    if not submission_ids:
        return {}
    result = await db.execute(
        select(
            Vote.submission_id, Vote.verdict, Vote.impact_score, Vote.credibility_weight
        ).where(Vote.submission_id.in_(submission_ids))
    )
    grouped: dict[int, list[tuple[str, int, float]]] = {sid: [] for sid in submission_ids}
    for submission_id, verdict, impact, weight in result.all():
        grouped[submission_id].append((verdict, int(impact), float(weight)))
    return {sid: aggregate(rows) for sid, rows in grouped.items()}


async def _comment_counts_for(db: AsyncSession, submission_ids: list[int]) -> dict[int, int]:
    if not submission_ids:
        return {}
    rows = (
        await db.execute(
            select(Comment.submission_id, func.count(Comment.id))
            .where(Comment.submission_id.in_(submission_ids))
            .group_by(Comment.submission_id)
        )
    ).all()
    return {int(submission_id): int(count) for submission_id, count in rows}


async def _appeals_for(
    db: AsyncSession, submission_ids: list[int], user_id: int | None
) -> dict[int, str]:
    if not submission_ids or user_id is None:
        return {}
    rows = (
        await db.execute(
            select(SubmissionAppeal.submission_id, SubmissionAppeal.status).where(
                SubmissionAppeal.submission_id.in_(submission_ids),
                SubmissionAppeal.appellant_user_id == user_id,
            )
        )
    ).all()
    return {int(submission_id): str(status_value) for submission_id, status_value in rows}


def _community_verdict(rows: list[tuple[str, int, float]]) -> str | None:
    real = sum(1 for verdict, _, _ in rows if verdict == 'real')
    fake = sum(1 for verdict, _, _ in rows if verdict == 'fake')
    if real == fake:
        return None
    return 'real' if real > fake else 'fake'


async def _effective_verdict(db: AsyncSession, submission_id: int, rows: list[tuple[str, int, float]]) -> str | None:
    analysis = (
        await db.execute(select(AiAnalysis.verdict).where(AiAnalysis.submission_id == submission_id))
    ).scalar_one_or_none()
    if analysis == 'likely_real':
        return 'real'
    if analysis == 'likely_fake':
        return 'fake'
    if analysis == 'uncertain':
        return _community_verdict(rows)
    return None


async def _invalidate_user_credibility_cache(user_id: int) -> None:
    try:
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        try:
            await redis.delete(f'user:{user_id}', f'user:{user_id}:credibility')
            await redis.publish('leaderboard:changed', str(user_id))
        finally:
            await redis.aclose()
    except Exception:
        # Best-effort cache invalidation; DB remains the source of truth.
        pass


async def _apply_voter_credibility_adjustments(
    db: AsyncSession,
    submission: Submission,
    rows: list[tuple[str, int, float]],
) -> None:
    effective = await _effective_verdict(db, submission.id, rows)
    votes = (
        await db.execute(
            select(Vote.user_id, Vote.verdict).where(Vote.submission_id == submission.id)
        )
    ).all()
    existing_rows = (
        await db.execute(
            select(SubmissionCredibilityAdjustment).where(
                SubmissionCredibilityAdjustment.submission_id == submission.id
            )
        )
    ).scalars().all()
    existing_by_user = {adjustment.user_id: adjustment for adjustment in existing_rows}
    affected_user_ids: set[int] = set()

    if effective is None:
        for adjustment in existing_rows:
            if adjustment.reversed:
                continue
            user = (await db.execute(select(User).where(User.id == adjustment.user_id))).scalar_one_or_none()
            if user is None:
                continue
            before = float(user.credibility_score)
            after = clamp_credibility(round(before - float(adjustment.delta), 2))
            user.credibility_score = after
            user.tier = tier_for(after)
            db.add(CredibilityLog(user_id=user.id, delta=round(after - before, 2), reason='vote_verdict_unsettled', new_score=after))
            adjustment.reversed = True
            affected_user_ids.add(user.id)
        for user_id in affected_user_ids:
            await _invalidate_user_credibility_cache(user_id)
        return

    for user_id, voter_verdict in votes:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if user is None:
            continue

        delta = SUBMISSION_VERDICT_CREDIBILITY_DELTA if voter_verdict == effective else -SUBMISSION_VERDICT_CREDIBILITY_DELTA
        existing = existing_by_user.get(user_id)
        previous_delta = 0.0 if existing is None or existing.reversed else float(existing.delta)
        net_delta = delta - previous_delta

        if net_delta:
            before = float(user.credibility_score)
            after = clamp_credibility(round(before + net_delta, 2))
            user.credibility_score = after
            user.tier = tier_for(after)
            db.add(CredibilityLog(user_id=user.id, delta=round(after - before, 2), reason='vote_verdict', new_score=after))
            affected_user_ids.add(user.id)

        if existing is None:
            db.add(
                SubmissionCredibilityAdjustment(
                    submission_id=submission.id,
                    user_id=user.id,
                    effective_verdict=effective,
                    community_verdict=voter_verdict,
                    delta=delta,
                    reversed=False,
                )
            )
        else:
            existing.effective_verdict = effective
            existing.community_verdict = voter_verdict
            existing.delta = delta
            existing.reversed = False

    for user_id in affected_user_ids:
        await _invalidate_user_credibility_cache(user_id)


def _serialize(
    submission: Submission,
    agg: tuple[int, float | None, float | None],
    comment_count: int = 0,
    ai_verdict: str | None = None,
    effective_verdict: str | None = None,
    community_verdict: str | None = None,
    can_appeal: bool = False,
    appeal_status: str | None = None,
) -> SubmissionOut:
    vote_count, fake_likelihood, weighted_impact = agg
    return SubmissionOut(
        id=submission.id,
        user_id=submission.user_id,
        content_type=submission.content_type,
        content_url=submission.content_url,
        caption=submission.caption,
        status=submission.status,
        created_at=submission.created_at,
        fake_likelihood=fake_likelihood,
        weighted_impact=weighted_impact,
        vote_count=vote_count,
        comment_count=comment_count,
        ai_verdict=ai_verdict,
        effective_verdict=effective_verdict,
        community_verdict=community_verdict,
        can_appeal=can_appeal,
        appeal_status=appeal_status,
    )


async def _serialize_for_viewer(
    db: AsyncSession,
    submission: Submission,
    agg: tuple[int, float | None, float | None],
    comment_count: int,
    viewer: User | None,
    appeal_status: str | None = None,
) -> SubmissionOut:
    rows = await _vote_rows(db, submission.id)
    effective = await _effective_verdict(db, submission.id, rows)
    community = _community_verdict(rows)
    viewer_vote = None
    if viewer is not None:
        viewer_vote = (
            await db.execute(
                select(Vote.verdict).where(
                    Vote.submission_id == submission.id,
                    Vote.user_id == viewer.id,
                )
            )
        ).scalar_one_or_none()
    ai_verdict = None
    if viewer_vote is not None:
        ai_verdict = (
            await db.execute(select(AiAnalysis.verdict).where(AiAnalysis.submission_id == submission.id))
        ).scalar_one_or_none()
    can_appeal = (
        viewer_vote is not None
        and effective is not None
        and viewer_vote != effective
        and appeal_status is None
    )
    return _serialize(
        submission,
        agg,
        comment_count,
        ai_verdict=ai_verdict,
        effective_verdict=effective,
        community_verdict=community,
        can_appeal=can_appeal,
        appeal_status=appeal_status,
    )


@router.post('', response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
async def create_submission(
    payload: CreateSubmissionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> SubmissionOut:
    if payload.content_type == 'image':
        content_url = save_base64_image(payload.content)
    else:
        content_url = payload.content

    submission = Submission(
        user_id=current_user.id if current_user else None,
        content_type=payload.content_type,
        content_url=content_url,
        caption=payload.caption,
        status='pending',
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    # Hand off to the Phase 6 AI worker (best-effort; submission already saved).
    await enqueue_analysis(submission.id)

    return _serialize(submission, (0, None, None))


@router.get('', response_model=SubmissionFeed)
async def list_submissions(
    page: int = 1,
    page_size: int = 10,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> SubmissionFeed:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 50)

    total = (await db.execute(select(func.count(Submission.id)))).scalar_one()

    result = await db.execute(
        select(Submission)
        .order_by(Submission.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    submissions = result.scalars().all()

    submission_ids = [s.id for s in submissions]
    aggregates = await _aggregates_for(db, submission_ids)
    comment_counts = await _comment_counts_for(db, submission_ids)
    appeal_statuses = await _appeals_for(db, submission_ids, current_user.id if current_user else None)
    items = [
        await _serialize_for_viewer(
            db,
            s,
            aggregates.get(s.id, (0, None, None)),
            comment_counts.get(s.id, 0),
            current_user,
            appeal_statuses.get(s.id),
        )
        for s in submissions
    ]

    return SubmissionFeed(items=items, page=page, page_size=page_size, total=int(total))


async def _load_submission(db: AsyncSession, submission_id: int) -> Submission:
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    submission = result.scalar_one_or_none()
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Submission not found')
    return submission


def _can_modify(submission: Submission, user: User | None) -> bool:
    """The submitter, an admin, or anyone (for ownerless posts) may edit/delete."""
    if user is None:
        return False
    return (
        user.is_admin
        or submission.user_id is None
        or submission.user_id == user.id
    )


@router.get('/{submission_id}', response_model=SubmissionDetail)
async def get_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> SubmissionDetail:
    submission = await _load_submission(db, submission_id)
    rows = await _vote_rows(db, submission_id)
    comment_counts = await _comment_counts_for(db, [submission_id])
    appeal_statuses = await _appeals_for(db, [submission_id], current_user.id if current_user else None)
    base = await _serialize_for_viewer(
        db,
        submission,
        aggregate(rows),
        comment_counts.get(submission_id, 0),
        current_user,
        appeal_statuses.get(submission_id),
    )

    fake_votes = sum(1 for verdict, _, _ in rows if verdict == 'fake')
    real_votes = sum(1 for verdict, _, _ in rows if verdict == 'real')

    submitter: str | None = None
    submitter_cred = 0.5  # default weight for anonymous/unknown submitters
    if submission.user_id is not None:
        row = (
            await db.execute(
                select(User.username, User.credibility_score).where(User.id == submission.user_id)
            )
        ).first()
        if row is not None:
            submitter = row[0]
            submitter_cred = min(float(row[1]) / 100.0, 1.0)

    analysis_row = (
        await db.execute(select(AiAnalysis).where(AiAnalysis.submission_id == submission_id))
    ).scalar_one_or_none()
    ai_out: AiAnalysisOut | None = None
    if analysis_row is not None:
        ai_out = AiAnalysisOut(
            confidence=analysis_row.confidence,
            signals=list(analysis_row.signals or []),
            verdict=analysis_row.verdict,
            explanation=analysis_row.explanation,
            processed_at=analysis_row.processed_at,
            report=analysis_row.report,
        )

    your_vote: VoteRequest | None = None
    if current_user is not None:
        existing = (
            await db.execute(
                select(Vote).where(
                    Vote.submission_id == submission_id, Vote.user_id == current_user.id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            your_vote = VoteRequest(verdict=existing.verdict, impact_score=existing.impact_score)

    # final_score is only meaningful once AI analysis has landed (Phase 6). This
    # mirrors the AI worker's formula (which also caches it in Redis for Phase 7).
    final_score = None
    if submission.status == 'analysed' and ai_out is not None and ai_out.confidence is not None:
        community_fake = base.fake_likelihood if base.fake_likelihood is not None else 0.5
        final_score = round(
            0.5 * community_fake + 0.3 * ai_out.confidence + 0.2 * submitter_cred, 4
        )

    can_modify = _can_modify(submission, current_user)

    return SubmissionDetail(
        **base.model_dump(),
        final_score=final_score,
        ai_analysis=ai_out,
        your_vote=your_vote,
        submitter=submitter,
        fake_votes=fake_votes,
        real_votes=real_votes,
        can_delete=can_modify,
        can_edit=can_modify,
    )


@router.post('/{submission_id}/vote', response_model=VoteResult)
async def vote_on_submission(
    submission_id: int,
    payload: VoteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoteResult:
    submission = await _load_submission(db, submission_id)

    weight = vote_weight_for(current_user)
    existing_vote = (
        await db.execute(
            select(Vote.id).where(
                Vote.submission_id == submission_id,
                Vote.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing_vote is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail='You have already voted on this submission',
        )

    db.add(
        Vote(
            submission_id=submission_id,
            user_id=current_user.id,
            verdict=payload.verdict,
            impact_score=payload.impact_score,
            credibility_weight=weight,
        )
    )
    await db.flush()
    rows = await _vote_rows(db, submission_id)
    await _apply_voter_credibility_adjustments(db, submission, rows)
    await db.commit()

    vote_count, fake_likelihood, weighted_impact = aggregate(rows)
    return VoteResult(
        fake_likelihood=fake_likelihood,
        weighted_impact=weighted_impact,
        vote_count=vote_count,
        your_vote_weight=round(weight, 4),
    )


def _serialize_appeal(appeal: SubmissionAppeal) -> AppealOut:
    return AppealOut(
        id=appeal.id,
        submission_id=appeal.submission_id,
        appellant_user_id=appeal.appellant_user_id,
        status=appeal.status,
        created_at=appeal.created_at,
    )


@router.post('/{submission_id}/appeal', response_model=AppealOut, status_code=status.HTTP_201_CREATED)
async def appeal_submission_verdict(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppealOut:
    await _load_submission(db, submission_id)
    viewer_vote = (
        await db.execute(
            select(Vote).where(
                Vote.submission_id == submission_id,
                Vote.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if viewer_vote is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Only users who voted on this submission can appeal',
        )

    existing = (
        await db.execute(
            select(SubmissionAppeal).where(
                SubmissionAppeal.submission_id == submission_id,
                SubmissionAppeal.appellant_user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Appeal already submitted')

    rows = await _vote_rows(db, submission_id)
    effective = await _effective_verdict(db, submission_id, rows)
    if effective is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='This submission is not eligible for appeal')
    if viewer_vote.verdict == effective:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Your vote matches the final verdict')

    appeal = SubmissionAppeal(
        submission_id=submission_id,
        appellant_user_id=current_user.id,
        status='pending',
    )
    db.add(appeal)
    await db.commit()
    await db.refresh(appeal)
    return _serialize_appeal(appeal)


def _serialize_comment(
    comment: Comment,
    username: str | None,
    credibility: float | None,
    is_admin: bool | None,
    viewer: User | None,
) -> CommentOut:
    can_delete = viewer is not None and (bool(viewer.is_admin) or comment.user_id == viewer.id)
    return CommentOut(
        id=comment.id,
        submission_id=comment.submission_id,
        user_id=comment.user_id,
        body=comment.body,
        author=username,
        author_credibility=float(credibility) if credibility is not None else 0.0,
        author_is_admin=bool(is_admin),
        created_at=comment.created_at,
        can_delete=can_delete,
    )


@router.get('/{submission_id}/comments', response_model=list[CommentOut])
async def list_comments(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> list[CommentOut]:
    await _load_submission(db, submission_id)
    result = await db.execute(
        select(Comment, User.username, User.credibility_score, User.is_admin)
        .outerjoin(User, Comment.user_id == User.id)
        .where(Comment.submission_id == submission_id)
        .order_by(Comment.id.desc())  # newest first
    )
    return [
        _serialize_comment(comment, username, credibility, is_admin, current_user)
        for comment, username, credibility, is_admin in result.all()
    ]


@router.post(
    '/{submission_id}/comments',
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    submission_id: int,
    payload: CreateCommentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentOut:
    await _load_submission(db, submission_id)
    comment = Comment(
        submission_id=submission_id,
        user_id=current_user.id,
        body=payload.body.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return _serialize_comment(
        comment,
        current_user.username,
        current_user.credibility_score,
        current_user.is_admin,
        current_user,
    )


@router.delete(
    '/{submission_id}/comments/{comment_id}',
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_comment(
    submission_id: int,
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    result = await db.execute(
        select(Comment).where(
            Comment.id == comment_id, Comment.submission_id == submission_id
        )
    )
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Comment not found')
    if not (current_user.is_admin or comment.user_id == current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You can only delete your own comments',
        )
    await db.execute(delete(Comment).where(Comment.id == comment_id))
    await db.commit()


@router.patch('/{submission_id}', response_model=SubmissionDetail)
async def update_submission(
    submission_id: int,
    payload: UpdateSubmissionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubmissionDetail:
    submission = await _load_submission(db, submission_id)
    if not _can_modify(submission, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You can only edit your own submissions',
        )

    fields = payload.model_dump(exclude_unset=True)
    content_changed = False

    if fields.get('content_type') is not None:
        submission.content_type = fields['content_type']
        content_changed = True

    if fields.get('content') is not None:
        if submission.content_type == 'image':
            submission.content_url = save_base64_image(fields['content'])
        else:
            submission.content_url = fields['content']
        content_changed = True

    if 'caption' in fields:  # caption may be intentionally cleared to null
        submission.caption = fields['caption']

    # Changing the content invalidates any prior AI verdict — re-queue analysis.
    if content_changed:
        await db.execute(delete(AiAnalysis).where(AiAnalysis.submission_id == submission_id))
        submission.status = 'pending'

    await db.commit()

    if content_changed:
        await enqueue_analysis(submission_id)

    return await get_submission(submission_id, db, current_user)


@router.delete('/{submission_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    submission = await _load_submission(db, submission_id)
    if not _can_modify(submission, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='You can only delete your own submissions',
        )

    # No DB-level cascade is configured, so clear dependent rows first.
    await db.execute(delete(Vote).where(Vote.submission_id == submission_id))
    await db.execute(delete(Comment).where(Comment.submission_id == submission_id))
    await db.execute(delete(AiAnalysis).where(AiAnalysis.submission_id == submission_id))
    await db.execute(delete(Submission).where(Submission.id == submission_id))
    await db.commit()
