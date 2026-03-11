"""
database.py — Configuração do banco de dados SQLite assíncrono.

Usa SQLAlchemy 2.x com aiosqlite para I/O não-bloqueante.
O arquivo do banco é criado em ./academind.db na raiz do projeto.
"""

import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Caminho absoluto para o arquivo do banco, relativo à raiz do projeto (um nível acima de backend/)
_BASE_DIR = Path(__file__).resolve().parent.parent
_DB_PATH = _BASE_DIR / "academind.db"

DATABASE_URL = f"sqlite+aiosqlite:///{_DB_PATH}"

# Engine assíncrona; check_same_thread=False é necessário para SQLite com múltiplas corrotinas
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Mude para True para depurar queries SQL
    connect_args={"check_same_thread": False},
)

# Fábrica de sessões assíncronas
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Classe base para todos os modelos ORM."""
    pass


async def get_db() -> AsyncSession:
    """
    Dependency para injeção de sessão do banco nas rotas FastAPI.
    Uso: db: AsyncSession = Depends(get_db)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Cria todas as tabelas definidas nos models se ainda não existirem."""
    # Import aqui para evitar circular imports; models deve ser importado antes de criar as tabelas
    import backend.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
