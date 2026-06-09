"""Question delivery for the games (no auth required)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import Question
from shared.deps import get_db

from schemas import QuestionOut, QuizQuestionOut
from scoring import normalize_verdict

router = APIRouter(prefix='/questions', tags=['questions'])


def _split_tags(tags: str | None) -> list[str]:
    if not tags:
        return []
    return [tag.strip() for tag in tags.split(',') if tag.strip()]


def serialize_question(question: Question) -> QuestionOut:
    """Public shape — deliberately omits `correct_answer` so clients can't cheat."""
    return QuestionOut(
        id=question.id,
        content=question.content,
        type=question.type,
        media_url=question.media_url,
        difficulty=question.difficulty,
        tags=_split_tags(question.tags),
    )


@router.get('/random', response_model=list[QuestionOut])
async def random_questions(
    count: int = Query(default=10, ge=1, le=50),
    difficulty: str = Query(default='mixed'),
    db: AsyncSession = Depends(get_db),
) -> list[QuestionOut]:
    stmt = select(Question).where(Question.is_active.is_(True))
    if difficulty and difficulty.lower() != 'mixed':
        stmt = stmt.where(func.lower(Question.difficulty) == difficulty.lower())
    stmt = stmt.order_by(func.random()).limit(count)

    result = await db.execute(stmt)
    questions = result.scalars().all()
    return [serialize_question(question) for question in questions]


@router.get('/quiz', response_model=list[QuizQuestionOut])
async def quiz_questions(
    count: int = Query(default=12, ge=1, le=50),
    difficulty: str = Query(default='mixed'),
    db: AsyncSession = Depends(get_db),
) -> list[QuizQuestionOut]:
    """Questions for client-graded quiz games (Truth Tower): includes the
    normalized Real/Fake verdict + explanation."""
    stmt = select(Question).where(Question.is_active.is_(True))
    if difficulty and difficulty.lower() != 'mixed':
        stmt = stmt.where(func.lower(Question.difficulty) == difficulty.lower())
    stmt = stmt.order_by(func.random()).limit(count)

    result = await db.execute(stmt)
    questions = result.scalars().all()
    return [
        QuizQuestionOut(
            id=question.id,
            content=question.content,
            type=question.type,
            verdict=normalize_verdict(question.correct_answer),
            explanation=question.explanation,
            difficulty=question.difficulty,
        )
        for question in questions
    ]
