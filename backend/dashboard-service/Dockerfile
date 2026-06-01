FROM python:3.12-slim
WORKDIR /app
RUN python -m pip install --upgrade pip && pip install fastapi uvicorn[standard] sqlalchemy[asyncio] asyncpg pydantic-settings python-jose[cryptography]
COPY shared/ /app/shared/
COPY backend/dashboard-service/app/ /app/
ENV PYTHONPATH=/app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
