FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml /app/
RUN python -m pip install --upgrade pip
COPY app /app
CMD ["python", "-u", "app/worker.py"]
