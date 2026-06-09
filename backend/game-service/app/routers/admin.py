"""Admin question pipeline (Phase 9). All routes require an admin JWT.

CRUD over the question library, AI-assisted explanation writing (delegated to
the ai-service worker via arq, with a heuristic fallback), and CSV bulk import.
"""
from __future__ import annotations

import csv
import io
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import settings
from shared.db.models import Question, SessionAnswer, User
from shared.deps import get_current_admin, get_db
from shared.explain import heuristic_explanation

from schemas import (
    AdminQuestionFeed,
    AdminQuestionOut,
    BulkImportError,
    BulkImportResult,
    CreateQuestionRequest,
    GenerateExplanationRequest,
    GenerateExplanationResponse,
    UpdateQuestionRequest,
)
from storage import save_base64_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/admin', tags=['admin'])

_TYPES = {'misleading_headline', 'deepfake', 'manipulated_media', 'scam_message', 'satire'}
_DIFFICULTIES = {'easy', 'medium', 'hard'}
_EXPLAIN_TIMEOUT_SECONDS = 12


def _split_tags(tags: str | None) -> list[str]:
    if not tags:
        return []
    return [t.strip() for t in tags.split(',') if t.strip()]


def _join_tags(tags: list[str] | None) -> str | None:
    if not tags:
        return None
    cleaned = [t.strip() for t in tags if t.strip()]
    return ','.join(cleaned) or None


def _serialize(question: Question) -> AdminQuestionOut:
    return AdminQuestionOut(
        id=question.id,
        content=question.content,
        type=question.type,
        media_url=question.media_url,
        correct_answer=question.correct_answer,
        explanation=question.explanation,
        difficulty=question.difficulty,
        tags=_split_tags(question.tags),
        is_active=question.is_active,
        created_at=question.created_at,
    )


def _resolve_media(media: str | None, media_url: str | None) -> str | None:
    """A base64 `media` payload wins (saved locally); else the raw url passes through."""
    if media:
        return save_base64_image(media)
    return media_url


@router.get('/questions', response_model=AdminQuestionFeed)
async def list_questions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    type: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    search: str | None = Query(default=None),
    include_inactive: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminQuestionFeed:
    stmt = select(Question)
    if not include_inactive:
        stmt = stmt.where(Question.is_active.is_(True))
    if type:
        stmt = stmt.where(Question.type == type)
    if difficulty:
        stmt = stmt.where(func.lower(Question.difficulty) == difficulty.lower())
    if search:
        stmt = stmt.where(Question.content.ilike(f'%{search}%'))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    rows = (
        await db.execute(
            stmt.order_by(Question.id.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()

    return AdminQuestionFeed(
        items=[_serialize(q) for q in rows],
        page=page,
        page_size=page_size,
        total=int(total),
    )


@router.post('/questions', response_model=AdminQuestionOut, status_code=status.HTTP_201_CREATED)
async def create_question(
    payload: CreateQuestionRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminQuestionOut:
    question = Question(
        content=payload.content,
        type=payload.type,
        correct_answer=payload.correct_answer,
        explanation=payload.explanation,
        difficulty=payload.difficulty,
        tags=_join_tags(payload.tags),
        media_url=_resolve_media(payload.media, payload.media_url),
        is_active=True,
    )
    db.add(question)
    await db.commit()
    await db.refresh(question)
    return _serialize(question)


async def _load_question(db: AsyncSession, question_id: int) -> Question:
    question = (
        await db.execute(select(Question).where(Question.id == question_id))
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Question not found')
    return question


@router.put('/questions/{question_id}', response_model=AdminQuestionOut)
async def update_question(
    question_id: int,
    payload: UpdateQuestionRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> AdminQuestionOut:
    question = await _load_question(db, question_id)
    fields = payload.model_dump(exclude_unset=True)

    for attr in ('content', 'type', 'correct_answer', 'explanation', 'difficulty', 'is_active'):
        if attr in fields:
            setattr(question, attr, fields[attr])
    if 'tags' in fields:
        question.tags = _join_tags(fields['tags'])
    if fields.get('media'):
        question.media_url = save_base64_image(fields['media'])
    elif 'media_url' in fields:
        question.media_url = fields['media_url']

    await db.commit()
    await db.refresh(question)
    return _serialize(question)


@router.delete('/questions/{question_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> None:
    """Hard delete — the question is removed from the library. Dependent
    session_answers rows are cleared first (the FK has no ON DELETE cascade)."""
    question = await _load_question(db, question_id)
    await db.execute(delete(SessionAnswer).where(SessionAnswer.question_id == question_id))
    await db.delete(question)
    await db.commit()


async def _ai_explanation(content: str, correct_answer: str) -> str:
    """Run the ai-service `generate_explanation` task and wait for its result;
    fall back to the deterministic heuristic if the worker is slow/unavailable."""
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        try:
            job = await pool.enqueue_job('generate_explanation', content, correct_answer)
            if job is not None:
                text = await job.result(timeout=_EXPLAIN_TIMEOUT_SECONDS)
                if text:
                    return str(text)
        finally:
            close = getattr(pool, 'aclose', pool.close)
            await close()
    except Exception as exc:  # noqa: BLE001 — worker down / timeout / no redis
        logger.warning('generate_explanation via worker failed: %s', exc)
    return heuristic_explanation(content, correct_answer)


@router.post('/questions/generate-explanation', response_model=GenerateExplanationResponse)
async def generate_explanation(
    payload: GenerateExplanationRequest,
    _admin: User = Depends(get_current_admin),
) -> GenerateExplanationResponse:
    text = await _ai_explanation(payload.content, payload.correct_answer)
    return GenerateExplanationResponse(explanation=text)


_CSV_COLUMNS = ('content', 'type', 'correct_answer', 'explanation', 'difficulty', 'tags')


@router.post('/questions/bulk-import', response_model=BulkImportResult)
async def bulk_import(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> BulkImportResult:
    raw = await file.read()
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='File must be UTF-8 CSV'
        )

    reader = csv.DictReader(io.StringIO(text))
    errors: list[BulkImportError] = []
    to_add: list[Question] = []

    # Row numbers are 1-based over data rows (header is row 0).
    for idx, row in enumerate(reader, start=1):
        content = (row.get('content') or '').strip()
        qtype = (row.get('type') or '').strip()
        correct = (row.get('correct_answer') or '').strip()
        difficulty = (row.get('difficulty') or 'medium').strip().lower() or 'medium'
        explanation = (row.get('explanation') or '').strip() or None
        # tags cell may use ';' to avoid clashing with the CSV comma delimiter.
        tags = (row.get('tags') or '').replace(';', ',').strip() or None

        if not content:
            errors.append(BulkImportError(row=idx, reason='content is required'))
            continue
        if qtype not in _TYPES:
            errors.append(BulkImportError(row=idx, reason=f'invalid type: {qtype!r}'))
            continue
        if not correct:
            errors.append(BulkImportError(row=idx, reason='correct_answer is required'))
            continue
        if difficulty not in _DIFFICULTIES:
            errors.append(BulkImportError(row=idx, reason=f'invalid difficulty: {difficulty!r}'))
            continue

        to_add.append(
            Question(
                content=content,
                type=qtype,
                correct_answer=correct,
                explanation=explanation,
                difficulty=difficulty,
                tags=tags,
                is_active=True,
            )
        )

    # Valid rows are imported even when some rows failed validation.
    for question in to_add:
        db.add(question)
    await db.commit()

    return BulkImportResult(imported=len(to_add), errors=errors)
