# Enterprise same-origin React + FastAPI runtime. The preserved Node service is
# still available with --file deployment/Dockerfile.node.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/dist \
    AUTO_MIGRATE=false \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libglib2.0-0 libgomp1 tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 omr \
    && useradd --uid 10001 --gid omr --create-home omr \
    && install -d -m 0700 -o omr -g omr /app/data
COPY backend/requirements.lock ./backend/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r backend/requirements.lock
COPY backend ./backend
COPY alembic.ini ./alembic.ini
COPY public/fonts ./public/fonts
COPY --from=builder /app/dist ./dist
USER omr
VOLUME ["/app/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).close()"]
# Trust only the local reverse proxy. See deployment/compose.yaml for its fixed
# private address; never trust arbitrary forwarded headers on a public API port.
CMD ["uvicorn", "backend.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=127.0.0.1,172.29.241.10"]
