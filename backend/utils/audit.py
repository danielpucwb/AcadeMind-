"""
utils/audit.py — Logger de auditoria estruturado do AcadeMind.

Cada operação relevante (upload, transcrição, conversão, consolidação, erro)
é registrada em dois destinos:
  1. Banco de dados (tabela audit_logs) — permite consulta via API
  2. Arquivo de texto ./logs/audit.log — persistência externa e fácil inspeção

Formato no arquivo de log:
  [TIMESTAMP] [STATUS] [ENTIDADE/ACAO] detalhes_json
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AuditLog, StatusAudit

# ---------------------------------------------------------------------------
# Configuração do arquivo de log
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_LOG_FILE = _BASE_DIR / "logs" / "audit.log"

# Logger Python padrão (separado do logger de auditoria para não misturar)
_file_logger = logging.getLogger("academind.audit")

# Garante que o handler de arquivo só é adicionado uma vez
if not _file_logger.handlers:
    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _handler = logging.FileHandler(_LOG_FILE, encoding="utf-8")
    _handler.setFormatter(
        logging.Formatter("%(message)s")  # Mensagem já vem formatada
    )
    _file_logger.addHandler(_handler)
    _file_logger.setLevel(logging.DEBUG)
    _file_logger.propagate = False  # Não duplica no logger raiz


# ---------------------------------------------------------------------------
# Função principal
# ---------------------------------------------------------------------------

async def log_auditoria(
    db: AsyncSession,
    entidade: str,
    entidade_id: str | None,
    acao: str,
    detalhes: dict[str, Any] | None = None,
    status: StatusAudit = StatusAudit.INFO,
) -> AuditLog:
    """
    Registra uma entrada de auditoria no banco de dados e no arquivo de log.

    Args:
        db:          Sessão assíncrona do SQLAlchemy (injetada via Depends).
        entidade:    Nome da entidade afetada (ex: "Material", "Disciplina").
        entidade_id: ID UUID da entidade (pode ser None para operações globais).
        acao:        Descrição curta da ação (ex: "upload", "transcricao_inicio").
        detalhes:    Dicionário com informações extras (nome do arquivo, tamanho, etc.).
        status:      StatusAudit.OK | ERRO | INFO

    Returns:
        Instância de AuditLog salva no banco.
    """
    now = datetime.now(timezone.utc)

    # 1. Persiste no banco
    log_entry = AuditLog(
        entidade=entidade,
        entidade_id=entidade_id,
        acao=acao,
        detalhes=detalhes or {},
        status=status,
        criado_em=now,
    )
    db.add(log_entry)
    await db.flush()  # Garante que o id seja gerado antes de retornar

    # 2. Grava no arquivo de log
    ts = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"  # ISO 8601 ms
    detalhes_str = json.dumps(detalhes or {}, ensure_ascii=False, default=str)
    linha = f"[{ts}] [{status.value}] [{entidade}/{acao}] {detalhes_str}"
    _file_logger.info(linha)

    return log_entry


def log_auditoria_sync(
    entidade: str,
    entidade_id: str | None,
    acao: str,
    detalhes: dict[str, Any] | None = None,
    status: StatusAudit = StatusAudit.INFO,
) -> None:
    """
    Versão síncrona que grava APENAS no arquivo de log (sem acesso ao banco).

    Útil em contextos onde não há sessão de banco disponível, como handlers
    de exceção de nível de serviço ou callbacks de threads.
    """
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    detalhes_str = json.dumps(detalhes or {}, ensure_ascii=False, default=str)
    linha = f"[{ts}] [{status.value}] [{entidade}/{acao}] {detalhes_str}"
    _file_logger.info(linha)
