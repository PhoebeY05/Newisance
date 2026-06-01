"""Community Verification Hub: submissions, feed, and credibility-weighted votes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import AiAnalysis, Submission, User, Vote
from shared.deps import get_current_user, get_db, get_optional_user

from schemas import (
    AiAnalysisOut,
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


def _serialize(submission: Submission, agg: tuple[int, float | None, float | None]) -> SubmissionOut:
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

    aggregates = await _aggregates_for(db, [s.id for s in submissions])
    items = [_serialize(s, aggregates.get(s.id, (0, None, None))) for s in submissions]

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
    base = _serialize(submission, aggregate(rows))

    fake_votes = sum(1 for verdict, _, _ in rows if verdict == 'fake')
    real_votes = sum(1 for verdict, _, _ in rows if verdict == 'real')

    submitter: str | None = None
    if submission.user_id is not None:
        submitter = (
            await db.execute(select(User.username).where(User.id == submission.user_id))
        ).scalar_one_or_none()

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

    # final_score is only meaningful once AI analysis has landed (Phase 6).
    final_score = None
    if submission.status == 'analysed' and ai_out is not None and ai_out.confidence is not None:
        community_fake = base.fake_likelihood if base.fake_likelihood is not None else 0.5
        submitter_cred = 0.5  # placeholder until submitter credibility wiring (Phase 8)
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
    await _load_submission(db, submission_id)

    weight = vote_weight_for(current_user)

    # One vote per user per submission — re-voting overwrites the existing row.
    stmt = (
        pg_insert(Vote)
        .values(
            submission_id=submission_id,
            user_id=current_user.id,
            verdict=payload.verdict,
            impact_score=payload.impact_score,
            credibility_weight=weight,
        )
        .on_conflict_do_update(
            constraint='uq_votes_submission_user',
            set_={
                'verdict': payload.verdict,
                'impact_score': payload.impact_score,
                'credibility_weight': weight,
            },
        )
    )
    await db.execute(stmt)
    await db.commit()

    vote_count, fake_likelihood, weighted_impact = aggregate(await _vote_rows(db, submission_id))
    return VoteResult(
        fake_likelihood=fake_likelihood,
        weighted_impact=weighted_impact,
        vote_count=vote_count,
        your_vote_weight=round(weight, 4),
    )


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
    await db.execute(delete(AiAnalysis).where(AiAnalysis.submission_id == submission_id))
    await db.execute(delete(Submission).where(Submission.id == submission_id))
    await db.commit()
