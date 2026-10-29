# SilentCatch backend — Python 3.11 (PRD §8.1)
# Build context: repo ROOT (dockerfile: backend/Dockerfile)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependency layer first for cache hits
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY eval/ /app/eval/

# Never run as root (docker-expert security floor)
RUN useradd --create-home appuser \
    && chmod -R a+rX /app/backend /app/eval
USER appuser

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
