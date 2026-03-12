"""
routers/logs.py — Consulta e exportação de logs de auditoria.

Endpoints:
  GET /logs          — lista logs com filtros e paginação (50/página)
  GET /logs/exportar — exporta logs filtrados como .json ou .txt
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import AuditLog, StatusAudit
from backend.schemas import AuditLogOut

router = APIRouter(prefix="/logs", tags=["Logs"])


# ---------------------------------------------------------------------------
# Helper: monta query com filtros
# ---------------------------------------------------------------------------

def _query_filtrada(
    disciplina_id: str | None,
    entidade: str | None,
    status: str | None,
    data_inicial: datetime | None,
    data_final: datetime | None,
):
    q = select(AuditLog).order_by(AuditLog.criado_em.desc())
    filtros = []

    if disciplina_id:
        filtros.append(AuditLog.entidade_id == disciplina_id)
    if entidade:
        filtros.append(AuditLog.entidade == entidade)
    if status:
        try:
            filtros.append(AuditLog.status == StatusAudit(status.upper()))
        except ValueError:
            pass  # valor inválido ignorado
    if data_inicial:
        filtros.append(AuditLog.criado_em >= data_inicial)
    if data_final:
        filtros.append(AuditLog.criado_em <= data_final)

    if filtros:
        q = q.where(and_(*filtros))
    return q


# ---------------------------------------------------------------------------
# GET /logs — listagem paginada
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[AuditLogOut])
async def listar_logs(
    disciplina_id: Optional[str] = Query(None, description="Filtrar por entidade_id (ex: UUID de disciplina)"),
    entidade: Optional[str] = Query(None, description="Ex: Material, Disciplina, Consolidado, Sistema"),
    status: Optional[str] = Query(None, description="OK | ERRO | INFO"),
    data_inicial: Optional[datetime] = Query(None),
    data_final: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = _query_filtrada(disciplina_id, entidade, status, data_inicial, data_final)
    q = q.offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# GET /logs/total — contagem para paginação
# ---------------------------------------------------------------------------

@router.get("/total")
async def total_logs(
    disciplina_id: Optional[str] = Query(None),
    entidade: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    data_inicial: Optional[datetime] = Query(None),
    data_final: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func, select as sa_select
    q = _query_filtrada(disciplina_id, entidade, status, data_inicial, data_final)
    count_q = sa_select(func.count()).select_from(q.subquery())
    result = await db.execute(count_q)
    return {"total": result.scalar_one()}


# ---------------------------------------------------------------------------
# GET /logs/exportar — download como JSON ou TXT
# ---------------------------------------------------------------------------

@router.get("/exportar")
async def exportar_logs(
    disciplina_id: Optional[str] = Query(None),
    entidade: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    data_inicial: Optional[datetime] = Query(None),
    data_final: Optional[datetime] = Query(None),
    formato: str = Query("json", description="json | txt"),
    db: AsyncSession = Depends(get_db),
):
    q = _query_filtrada(disciplina_id, entidade, status, data_inicial, data_final)
    result = await db.execute(q)
    logs = result.scalars().all()

    if formato == "json":
        dados = [
            {
                "id": log.id,
                "criado_em": log.criado_em.isoformat(),
                "entidade": log.entidade,
                "entidade_id": log.entidade_id,
                "acao": log.acao,
                "status": log.status.value,
                "detalhes": log.detalhes,
            }
            for log in logs
        ]
        conteudo = json.dumps(dados, ensure_ascii=False, indent=2, default=str)
        media_type = "application/json"
        filename = "academind_audit_logs.json"
    else:
        linhas = []
        for log in logs:
            ts = log.criado_em.strftime("%Y-%m-%dT%H:%M:%SZ")
            det = json.dumps(log.detalhes or {}, ensure_ascii=False)
            linhas.append(f"[{ts}] [{log.status.value}] [{log.entidade}/{log.acao}] {det}")
        conteudo = "\n".join(linhas)
        media_type = "text/plain; charset=utf-8"
        filename = "academind_audit_logs.txt"

    encoded = conteudo.encode("utf-8")

    def _gen():
        yield encoded

    return StreamingResponse(
        _gen(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
