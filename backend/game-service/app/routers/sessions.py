"""Timed Challenge game sessions: create, answer, end, replay."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import CredibilityLog, GameSession, Question, SessionAnswer, User
from shared.deps import get_db, get_optional_user

from schemas import (
    AnswerRequest,
    AnswerResult,
    CreateSessionRequest,
    SessionAnswerOut,
    SessionDetail,
    SessionOut,
    SessionSummary,
)
from leaderboard import incr_weekly
from scoring import is_answer_correct, points_for_answer, updated_credibility

router = APIRouter(prefix='/sessions', tags=['sessions'])


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

    correct = is_answer_correct(payload.chosen_answer, question.correct_answer)
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


async def _apply_credibility_update(
    db: AsyncSession, user_id: int, accuracy: float
) -> tuple[float, float] | None:
    """Apply the post-game credibility formula. Returns (before, after) or None."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return None

    before = float(user.credibility_score)
    after = updated_credibility(before, accuracy)
    user.credibility_score = after
    db.add(
        CredibilityLog(
            user_id=user.id,
            delta=round(after - before, 4),
            reason='timed_game',
            new_score=after,
        )
    )
    return before, after


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

    if session.ended_at is None:
        session.score = float(total_points)
        session.ended_at = datetime.now(timezone.utc)

    credibility_before: float | None = None
    credibility_after: float | None = None
    credibility_delta: float | None = None
    if session.user_id is not None:
        applied = await _apply_credibility_update(db, session.user_id, accuracy)
        if applied is not None:
            credibility_before, credibility_after = applied
            credibility_delta = round(credibility_after - credibility_before, 4)

    await db.commit()

    return SessionSummary(
        session_id=session.id,
        score=float(session.score),
        total_answers=total_answers,
        correct_answers=correct_answers,
        accuracy=round(accuracy, 4),
        credibility_before=credibility_before,
        credibility_after=credibility_after,
        credibility_delta=credibility_delta,
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
