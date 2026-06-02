FROM python:3.12-slim
WORKDIR /app
RUN python -m pip install --upgrade pip && pip install \
    sqlalchemy[asyncio] asyncpg pydantic-settings python-jose[cryptography] \
    arq redis httpx beautifulsoup4 google-genai
COPY shared/ /app/shared/
COPY backend/ai-service/app/ /app/
ENV PYTHONPATH=/app
CMD ["arq", "worker.WorkerSettings"]
