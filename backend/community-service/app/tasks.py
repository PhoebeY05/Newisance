"""Best-effort task enqueue for AI analysis.

After a submission is created the community service enqueues
`analyse_submission(submission_id)` onto the local Redis-backed `arq` queue;
the Phase 6 `ai-service` worker consumes it. Enqueuing is best-effort — if
`arq` or Redis is unavailable the submission still succeeds and simply stays in
`pending` until a worker is running.
"""
from __future__ import annotations

import logging

from shared.config import settings

logger = logging.getLogger(__name__)


async def enqueue_analysis(submission_id: int) -> None:
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        try:
            await pool.enqueue_job('analyse_submission', submission_id)
        finally:
            close = getattr(pool, 'aclose', pool.close)
            await close()
    except Exception as exc:  # noqa: BLE001 — never block submission on the queue
        logger.warning('could not enqueue analyse_submission(%s): %s', submission_id, exc)
