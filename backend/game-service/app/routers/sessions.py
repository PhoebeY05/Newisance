"""Timed Challenge game sessions: create, answer, end, replay."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import GameSession, Question, SessionAnswer, User
from shared.deps import get_current_user, get_db, get_optional_user

from schemas import (
    AnswerRequest,
    AnswerResult,
    CreateSessionRequest,
    SessionAnswerOut,
    SessionDetail,
    SessionOut,
    SessionSummary,
    TruthTowerAwardBreakdown,
    TruthTowerAwardRequest,
    TruthTowerAwardResult,
)
from leaderboard import incr_weekly
from scoring import (
    is_answer_correct,
    points_for_answer,
    timed_credibility_score,
    truth_tower_credibility_score,
)

router = APIRouter(prefix='/sessions', tags=['sessions'])


def _truth_tower_award(payload: TruthTowerAwardRequest) -> tuple[float, TruthTowerAwardBreakdown]:
    """Small post-run credibility award for Truth Tower, capped and explainable."""
    fact_checks = max(payload.fact_checks, 0)
    correct = max(0, min(payload.correct_fact_checks, fact_checks))
    wrong = max(0, min(payload.wrong_fact_checks, fact_checks - correct))

    stack_component = min(float(payload.height) * 0.01, 0.5)
    stack_milestone_component = min((payload.height // 10) * 0.05, 0.25)
    fact_check_component = correct * 0.08
    wrong_penalty = wrong * 0.04
    raw_award = stack_component + stack_milestone_component + fact_check_component - wrong_penalty
    capped_award = round(max(min(raw_award, 1.25), 0), 2)

    return capped_award, TruthTowerAwardBreakdown(
        stack_component=round(stack_component, 2),
        stack_milestone_component=round(stack_milestone_component, 2),
        fact_check_component=round(fact_check_component, 2),
        wrong_penalty=round(wrong_penalty, 2),
        capped_award=capped_award,
    )


def _serialize_session(session: GameSession) -> SessionOut:
    return SessionOut(
        id=session.id,
        user_id=session.user_id,
        mode=session.mode,
        score=float(session.score),
        started_at=session.started_at,
        ended_at=session.ended_at,
    )


async def _load_session(db: AsyncSession, session_id: int) -> GameSession:
    result = await db.execute(select(GameSession).where(GameSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Session not found')
    return session


@router.post('', response_model=SessionOut)
async def create_session(
    payload: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> SessionOut:
    session = GameSession(
        user_id=current_user.id if current_user else None,
        mode=payload.mode,
        score=0.0,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _serialize_session(session)


@router.post('/{session_id}/answer', response_model=AnswerResult)
async def submit_answer(
    session_id: int,
    payload: AnswerRequest,
    db: AsyncSession = Depends(get_db),
) -> AnswerResult:
    session = await _load_session(db, session_id)
    if session.ended_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Session already ended')

    result = await db.execute(select(Question).where(Question.id == payload.question_id))
    question = result.scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Question not found')

    correct = False if payload.crashed else is_answer_correct(payload.chosen_answer, question.correct_answer)
    points = points_for_answer(question.difficulty, payload.response_ms, correct)

    db.add(
        SessionAnswer(
            session_id=session.id,
            question_id=question.id,
            chosen_answer=payload.chosen_answer,
            is_correct=correct,
            response_ms=payload.response_ms,
            points_earned=points,
        )
    )
    await db.commit()

    # Correct answers count toward the weekly leaderboard (in either game mode).
    if correct and session.user_id is not None:
        await incr_weekly(session.user_id, points)

    return AnswerResult(
        is_correct=correct,
        correct_answer=question.correct_answer,
        explanation=question.explanation,
        points_earned=points,
    )


@router.post('/truth-tower/award', response_model=TruthTowerAwardResult)
async def award_truth_tower_credibility(
    payload: TruthTowerAwardRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TruthTowerAwardResult:
    if payload.correct_fact_checks > payload.fact_checks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='correct_fact_checks cannot exceed fact_checks',
        )
    if payload.correct_fact_checks + payload.wrong_fact_checks > payload.fact_checks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='correct_fact_checks + wrong_fact_checks cannot exceed fact_checks',
        )

    _, breakdown = _truth_tower_award(payload)
    run_credibility = truth_tower_credibility_score(
        height=payload.height,
        score=payload.score,
        fact_checks=payload.fact_checks,
        correct_fact_checks=payload.correct_fact_checks,
    )
    before = float(current_user.credibility_score)
    leaderboard_points = float(max(0, payload.score))
    if leaderboard_points > 0:
        db.add(
            GameSession(
                user_id=current_user.id,
                mode='truth_tower',
                score=round(leaderboard_points, 2),
                ended_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    if leaderboard_points > 0:
        await incr_weekly(current_user.id, leaderboard_points)

    return TruthTowerAwardResult(
        credibility_before=before,
        credibility_after=None,
        credibility_delta=None,
        run_credibility_score=run_credibility.score,
        run_credibility_breakdown=run_credibility.breakdown,
        tier=current_user.tier,
        breakdown=breakdown,
    )


@router.post('/{session_id}/end', response_model=SessionSummary)
async def end_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
) -> SessionSummary:
    session = await _load_session(db, session_id)

    totals = await db.execute(
        select(
            func.count(SessionAnswer.id),
            func.coalesce(func.sum(SessionAnswer.points_earned), 0.0),
            func.coalesce(func.sum(cast(SessionAnswer.is_correct, Integer)), 0),
        ).where(SessionAnswer.session_id == session.id)
    )
    total_answers, total_points, correct_answers = totals.one()
    total_answers = int(total_answers)
    correct_answers = int(correct_answers)
    accuracy = (correct_answers / total_answers) if total_answers else 0.0

    answer_rows = (
        await db.execute(
            select(SessionAnswer.response_ms, SessionAnswer.is_correct)
            .where(SessionAnswer.session_id == session.id)
            .order_by(SessionAnswer.id)
        )
    ).all()
    run_credibility = timed_credibility_score(
        total_answers=total_answers,
        correct_answers=correct_answers,
        response_ms=[row[0] for row in answer_rows],
        correctness=[bool(row[1]) for row in answer_rows],
    )

    first_end = session.ended_at is None
    if first_end:
        session.score = float(total_points)
        session.ended_at = datetime.now(timezone.utc)

    await db.commit()

    return SessionSummary(
        session_id=session.id,
        score=float(session.score),
        total_answers=total_answers,
        correct_answers=correct_answers,
        accuracy=round(accuracy, 4),
        run_credibility_score=run_credibility.score,
        run_credibility_breakdown=run_credibility.breakdown,
        credibility_before=None,
        credibility_after=None,
        credibility_delta=None,
        tier=None,
    )


@router.get('/{session_id}', response_model=SessionDetail)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    session = await _load_session(db, session_id)

    result = await db.execute(
        select(SessionAnswer)
        .where(SessionAnswer.session_id == session.id)
        .order_by(SessionAnswer.id)
    )
    answers = result.scalars().all()

    return SessionDetail(
        **_serialize_session(session).model_dump(),
        answers=[
            SessionAnswerOut(
                question_id=answer.question_id,
                chosen_answer=answer.chosen_answer,
                is_correct=answer.is_correct,
                response_ms=answer.response_ms,
                points_earned=float(answer.points_earned),
            )
            for answer in answers
        ],
    )
