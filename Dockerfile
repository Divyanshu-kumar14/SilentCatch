# SilentCatch — Serverless Endpoint Container (Nebius Serverless / Docker)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Dependency layer
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY eval/ /app/eval/
COPY jobs/ /app/jobs/

# Non-root security. a+rX: build context may carry restrictive modes (e.g. a
# 600 results_latest.json) that appuser must still be able to read.
RUN useradd --create-home appuser \
    && chmod -R a+rX /app/backend /app/eval /app/jobs
USER appuser

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
