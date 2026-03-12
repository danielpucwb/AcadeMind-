"""
routers/disciplinas.py — CRUD completo de Disciplinas.

Endpoints:
  GET    /disciplinas          — lista todas, ordenadas por nome
  POST   /disciplinas          — cria nova disciplina
  GET    /disciplinas/{id}     — detalhe com materiais e consolidados
  PUT    /disciplinas/{id}     — substitui disciplina (atualização completa)
  PATCH  /disciplinas/{id}     — atualiza parcialmente
  DELETE /disciplinas/{id}     — remove disciplina, materiais, consolidados e pasta física
"""

import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import Disciplina, Material, StatusAudit, StatusMaterial
from backend.schemas import (
    DisciplinaComMateriais,
    DisciplinaCreate,
    DisciplinaOut,
    DisciplinaUpdate,
    MensagemOut,
)
from backend.utils.audit import log_auditoria
from backend.utils.storage import STORAGE_ROOT

router = APIRouter(prefix="/disciplinas", tags=["Disciplinas"])


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

async def _get_ou_404(db: AsyncSession, disciplina_id: str) -> Disciplina:
    result = await db.execute(
        select(Disciplina).where(Disciplina.id == disciplina_id)
    )
    disc = result.scalar_one_or_none()
    if not disc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )
    return disc


async def _verificar_codigo_unico(
    db: AsyncSession,
    codigo: str,
    excluir_id: str | None = None,
) -> None:
    """Lança 409 se o código já pertence a outra disciplina."""
    q = select(Disciplina).where(Disciplina.codigo == codigo)
    if excluir_id:
        q = q.where(Disciplina.id != excluir_id)
    existe = await db.execute(q)
    if existe.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Já existe uma disciplina com o código '{codigo}'.",
        )


def _remover_pasta_storage(disciplina_id: str) -> None:
    """Remove fisicamente ./storage/{disciplina_id}/ e todo seu conteúdo."""
    pasta = STORAGE_ROOT / disciplina_id
    if pasta.exists():
        shutil.rmtree(pasta, ignore_errors=True)


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
    if payload.codigo:
        await _verificar_codigo_unico(db, payload.codigo)

    disciplina = Disciplina(
        nome=payload.nome,
        descricao=payload.descricao,
        codigo=payload.codigo,
    )
    db.add(disciplina)
    await db.flush()

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
# PUT /disciplinas/{id} — substituição completa
# ---------------------------------------------------------------------------
@router.put("/{disciplina_id}", response_model=DisciplinaOut)
async def substituir_disciplina(
    disciplina_id: str,
    payload: DisciplinaCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Atualização completa (PUT): todos os campos são substituídos.
    Equivalente semântico a DELETE + POST sem alterar o ID.
    """
    disciplina = await _get_ou_404(db, disciplina_id)

    if payload.codigo and payload.codigo != disciplina.codigo:
        await _verificar_codigo_unico(db, payload.codigo, excluir_id=disciplina_id)

    disciplina.nome = payload.nome
    disciplina.descricao = payload.descricao
    disciplina.codigo = payload.codigo
    disciplina.atualizado_em = datetime.now(timezone.utc)

    await log_auditoria(
        db=db,
        entidade="Disciplina",
        entidade_id=disciplina_id,
        acao="substituicao_put",
        detalhes={"nome": payload.nome, "codigo": payload.codigo},
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(disciplina)
    return disciplina


# ---------------------------------------------------------------------------
# PATCH /disciplinas/{id} — atualização parcial
# ---------------------------------------------------------------------------
@router.patch("/{disciplina_id}", response_model=DisciplinaOut)
async def atualizar_disciplina(
    disciplina_id: str,
    payload: DisciplinaUpdate,
    db: AsyncSession = Depends(get_db),
):
    disciplina = await _get_ou_404(db, disciplina_id)
    alteracoes = payload.model_dump(exclude_unset=True)

    novo_codigo = alteracoes.get("codigo")
    if novo_codigo and novo_codigo != disciplina.codigo:
        await _verificar_codigo_unico(db, novo_codigo, excluir_id=disciplina_id)

    for campo, valor in alteracoes.items():
        setattr(disciplina, campo, valor)

    disciplina.atualizado_em = datetime.now(timezone.utc)

    await log_auditoria(
        db=db,
        entidade="Disciplina",
        entidade_id=disciplina_id,
        acao="atualizacao_patch",
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
    """
    Remove a disciplina do banco (cascade apaga materiais e consolidados)
    e exclui fisicamente a pasta ./storage/{disciplina_id}/.
    """
    disciplina = await _get_ou_404(db, disciplina_id)
    nome = disciplina.nome

    # Bloqueia exclusão se houver materiais em processamento
    processando = await db.execute(
        select(Material)
        .where(
            Material.disciplina_id == disciplina_id,
            Material.status == StatusMaterial.PROCESSANDO,
        )
        .limit(1)
    )
    if processando.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Não é possível excluir a disciplina enquanto há materiais sendo processados. "
                "Aguarde a conclusão ou cancele o processamento antes de excluir."
            ),
        )

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

    # Remove arquivos físicos APÓS o commit (garante consistência do banco primeiro)
    _remover_pasta_storage(disciplina_id)

    return MensagemOut(mensagem=f"Disciplina '{nome}' excluída com sucesso.")
