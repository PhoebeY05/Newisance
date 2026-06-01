FROM python:3.12-slim
WORKDIR /app
RUN python -m pip install --upgrade pip && pip install sqlalchemy[asyncio] asyncpg pydantic-settings python-jose[cryptography]
COPY shared/ /app/shared/
COPY backend/ai-service/app/ /app/
ENV PYTHONPATH=/app
CMD ["python", "-u", "worker.py"]
