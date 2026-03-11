"""
routers/disciplinas.py — CRUD completo de Disciplinas.

Endpoints:
  GET    /disciplinas          — lista todas
  POST   /disciplinas          — cria nova
  GET    /disciplinas/{id}     — detalhe com materiais e consolidados
  PATCH  /disciplinas/{id}     — atualiza parcialmente
  DELETE /disciplinas/{id}     — remove (cascateia materiais e consolidados)
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import AuditLog, Disciplina, StatusAudit
from backend.schemas import (
    DisciplinaComMateriais,
    DisciplinaCreate,
    DisciplinaOut,
    DisciplinaUpdate,
    MensagemOut,
)
from backend.utils.audit import log_auditoria

router = APIRouter(prefix="/disciplinas", tags=["Disciplinas"])


# ---------------------------------------------------------------------------
# GET /disciplinas
# ---------------------------------------------------------------------------
@router.get("/", response_model=list[DisciplinaOut])
async def listar_disciplinas(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Disciplina).order_by(Disciplina.nome))
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /disciplinas
# ---------------------------------------------------------------------------
@router.post("/", response_model=DisciplinaOut, status_code=status.HTTP_201_CREATED)
async def criar_disciplina(
    payload: DisciplinaCreate,
    db: AsyncSession = Depends(get_db),
):
    # Verifica unicidade do código, se informado
    if payload.codigo:
        existe = await db.execute(
            select(Disciplina).where(Disciplina.codigo == payload.codigo)
        )
        if existe.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Já existe uma disciplina com o código '{payload.codigo}'.",
            )

    disciplina = Disciplina(
        nome=payload.nome,
        descricao=payload.descricao,
        codigo=payload.codigo,
    )
    db.add(disciplina)
    await db.flush()  # Gera o id antes do log

    await log_auditoria(
        db=db,
        entidade="Disciplina",
        entidade_id=disciplina.id,
        acao="criacao",
        detalhes={"nome": disciplina.nome, "codigo": disciplina.codigo},
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(disciplina)
    return disciplina


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}
# ---------------------------------------------------------------------------
@router.get("/{disciplina_id}", response_model=DisciplinaComMateriais)
async def obter_disciplina(
    disciplina_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Disciplina)
        .where(Disciplina.id == disciplina_id)
        .options(
            selectinload(Disciplina.materiais),
            selectinload(Disciplina.consolidados),
        )
    )
    disciplina = result.scalar_one_or_none()
    if not disciplina:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )
    return disciplina


# ---------------------------------------------------------------------------
# PATCH /disciplinas/{id}
# ---------------------------------------------------------------------------
@router.patch("/{disciplina_id}", response_model=DisciplinaOut)
async def atualizar_disciplina(
    disciplina_id: str,
    payload: DisciplinaUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Disciplina).where(Disciplina.id == disciplina_id)
    )
    disciplina = result.scalar_one_or_none()
    if not disciplina:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )

    alteracoes = payload.model_dump(exclude_unset=True)

    # Verifica unicidade do código se estiver sendo alterado
    novo_codigo = alteracoes.get("codigo")
    if novo_codigo and novo_codigo != disciplina.codigo:
        existe = await db.execute(
            select(Disciplina).where(Disciplina.codigo == novo_codigo)
        )
        if existe.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Já existe uma disciplina com o código '{novo_codigo}'.",
            )

    for campo, valor in alteracoes.items():
        setattr(disciplina, campo, valor)

    disciplina.atualizado_em = datetime.now(timezone.utc)

    await log_auditoria(
        db=db,
        entidade="Disciplina",
        entidade_id=disciplina_id,
        acao="atualizacao",
        detalhes=alteracoes,
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(disciplina)
    return disciplina


# ---------------------------------------------------------------------------
# DELETE /disciplinas/{id}
# ---------------------------------------------------------------------------
@router.delete("/{disciplina_id}", response_model=MensagemOut)
async def excluir_disciplina(
    disciplina_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Disciplina).where(Disciplina.id == disciplina_id)
    )
    disciplina = result.scalar_one_or_none()
    if not disciplina:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )

    nome = disciplina.nome
    await log_auditoria(
        db=db,
        entidade="Disciplina",
        entidade_id=disciplina_id,
        acao="exclusao",
        detalhes={"nome": nome},
        status=StatusAudit.OK,
    )

    await db.delete(disciplina)
    await db.commit()

    return MensagemOut(mensagem=f"Disciplina '{nome}' excluída com sucesso.")
