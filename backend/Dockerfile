# Backend image: FastAPI + SQLModel served by uvicorn.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Application code.
COPY app ./app

# SQLite lives on a mounted volume (see docker-compose.prod.yml).
RUN mkdir -p /data

EXPOSE 8000

# create_db_and_tables + seed master data run on startup (app lifespan).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
