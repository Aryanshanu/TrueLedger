# Build from the REPO ROOT so this can COPY the shared agents/ package:
#   docker build -f backend/Dockerfile -t outliers-backend .
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY agents/ ./agents/
COPY backend/ ./backend/

ENV PYTHONUNBUFFERED=1
# Cloud Run injects PORT; default to 8080 for local `docker run`.
ENV PORT=8080

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
