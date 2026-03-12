# ============================================================
# AcadeMind — Dockerfile
#
# Imagem base: Python 3.11 slim (Debian Bookworm)
# Inclui: FFmpeg, LibreOffice, faster-whisper (CPU por padrão)
#
# Para GPU NVIDIA: use docker-compose.yml com nvidia runtime.
# O modelo Whisper é baixado automaticamente na 1ª transcrição
# e cacheado no volume whisper-cache.
#
# Build:
#   docker build -t academind .
#
# Run (CPU):
#   docker run -p 8000:8000 \
#     -v ./storage:/app/storage \
#     -v ./logs:/app/logs \
#     -v ./academind.db:/app/academind.db \
#     academind
# ============================================================

FROM python:3.11-slim-bookworm

# ── Metadados ──────────────────────────────────────────────
LABEL maintainer="AcadeMind"
LABEL description="Orientador acadêmico local para pós-graduação"

# ── Variáveis de ambiente ───────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WHISPER_MODEL=large-v3 \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE=int8 \
    # Cache do modelo Whisper (mapeado como volume)
    HF_HOME=/app/.cache/huggingface \
    XDG_CACHE_HOME=/app/.cache

# ── Dependências do sistema ─────────────────────────────────
# FFmpeg       → decodificação de vídeo/áudio para o Whisper
# LibreOffice  → conversão Office → PDF
# Outras       → suporte a locales, fontes e SSL
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libreoffice \
        libreoffice-writer \
        libreoffice-impress \
        libreoffice-calc \
        fonts-dejavu-core \
        fonts-liberation \
        locales \
        curl \
    && locale-gen pt_BR.UTF-8 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=pt_BR.UTF-8 \
    LC_ALL=pt_BR.UTF-8

# ── Diretório de trabalho ───────────────────────────────────
WORKDIR /app

# ── Instala dependências Python ─────────────────────────────
# Copia apenas requirements.txt primeiro para aproveitar cache de camadas
COPY backend/requirements.txt ./backend/requirements.txt

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r backend/requirements.txt

# ── Copia o código-fonte ────────────────────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# ── Cria diretórios necessários ─────────────────────────────
RUN mkdir -p storage logs .cache/huggingface

# ── Porta exposta ───────────────────────────────────────────
EXPOSE 8000

# ── Health check ───────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/docs > /dev/null 2>&1 || exit 1

# ── Ponto de entrada ────────────────────────────────────────
CMD ["python", "-m", "uvicorn", "backend.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]
