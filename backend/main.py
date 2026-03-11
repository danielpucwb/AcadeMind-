"""
main.py — Ponto de entrada da aplicação AcadeMind (FastAPI).

Responsabilidades:
  - Criar e configurar o app FastAPI
  - Registrar middleware de CORS (libera localhost para dev)
  - Montar arquivos estáticos do frontend em "/"
  - Incluir os routers da API em "/api/v1"
  - Endpoint WebSocket para progresso em tempo real
  - Inicializar o banco de dados na startup
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database import init_db
from backend.routers import consolidados, disciplinas
from backend.routers.materiais import router_disc, router_mat
from backend.utils.progresso import manager as progresso_manager

# ---------------------------------------------------------------------------
# Logging básico para o servidor
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("academind")

# ---------------------------------------------------------------------------
# Diretórios que precisam existir antes de qualquer requisição
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_STORAGE_DIR = _BASE_DIR / "storage"
_LOGS_DIR = _BASE_DIR / "logs"
_FRONTEND_DIR = _BASE_DIR / "frontend"


# ---------------------------------------------------------------------------
# Lifespan: executado na startup e shutdown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _STORAGE_DIR.mkdir(exist_ok=True)
    _LOGS_DIR.mkdir(exist_ok=True)
    logger.info("Inicializando banco de dados...")
    await init_db()
    logger.info("Banco de dados inicializado. AcadeMind pronto.")
    yield
    # Shutdown (sem ações necessárias)
    logger.info("AcadeMind encerrado.")


# ---------------------------------------------------------------------------
# App FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AcadeMind",
    description="Orientador acadêmico de pós-graduação — API REST",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ---------------------------------------------------------------------------
# CORS — libera localhost em qualquer porta para desenvolvimento local
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers da API
# ---------------------------------------------------------------------------
API_PREFIX = "/api/v1"

app.include_router(disciplinas.router, prefix=API_PREFIX)
app.include_router(router_disc,        prefix=API_PREFIX)
app.include_router(router_mat,         prefix=API_PREFIX)
app.include_router(consolidados.router, prefix=API_PREFIX)


# ---------------------------------------------------------------------------
# WebSocket — progresso de processamento em tempo real
# WS /ws/materiais/{material_id}/progresso
# ---------------------------------------------------------------------------
@app.websocket("/ws/materiais/{material_id}/progresso")
async def ws_progresso(websocket: WebSocket, material_id: str):
    """
    Conecta o cliente ao canal de progresso do material.
    Cada segmento transcrito e cada etapa de conversão emite um evento:
      {"status": "PROCESSANDO"|"CONCLUIDO"|"ERRO", "progresso_pct": 0-100, "mensagem": "..."}
    O cliente deve reconectar automaticamente se a conexão cair.
    """
    await progresso_manager.connect(material_id, websocket)
    try:
        # Mantém a conexão aberta aguardando mensagens do cliente (heartbeat/ping)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        progresso_manager.disconnect(material_id, websocket)


# ---------------------------------------------------------------------------
# Arquivos estáticos do frontend
# Montado por ÚLTIMO para que as rotas /api/* tenham prioridade.
# ---------------------------------------------------------------------------
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
else:
    logger.warning(
        "Diretório frontend/ não encontrado. Servindo apenas a API. "
        "Certifique-se de que frontend/ existe na raiz do projeto."
    )
