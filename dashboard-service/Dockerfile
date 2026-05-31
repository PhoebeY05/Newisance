FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml /app/
RUN python -m pip install --upgrade pip && pip install fastapi uvicorn[standard]
COPY app /app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
