"""
routers/consolidados.py — Geração e gestão de arquivos consolidados.

Endpoints:
  GET    /disciplinas/{id}/consolidados              — lista consolidados
  POST   /disciplinas/{id}/consolidados              — gera novo consolidado
  GET    /disciplinas/{id}/consolidados/{cons_id}    — detalhe
  DELETE /disciplinas/{id}/consolidados/{cons_id}    — remove
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import (
    ConsolidadoArquivo,
    Disciplina,
    Material,
    StatusAudit,
    StatusMaterial,
    TipoConsolidado,
    TipoMaterial,
)
from backend.schemas import ConsolidadoCreate, ConsolidadoOut, MensagemOut
from backend.services.consolidacao import consolidar_materiais
from backend.utils.audit import log_auditoria
from backend.utils.storage import caminho_absoluto, excluir_arquivo

router = APIRouter(prefix="/disciplinas", tags=["Consolidados"])


async def _get_disciplina_ou_404(db: AsyncSession, disciplina_id: str) -> Disciplina:
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


async def _get_consolidado_ou_404(
    db: AsyncSession, disciplina_id: str, consolidado_id: str
) -> ConsolidadoArquivo:
    result = await db.execute(
        select(ConsolidadoArquivo).where(
            ConsolidadoArquivo.id == consolidado_id,
            ConsolidadoArquivo.disciplina_id == disciplina_id,
        )
    )
    cons = result.scalar_one_or_none()
    if not cons:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Consolidado '{consolidado_id}' não encontrado.",
        )
    return cons


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/consolidados
# ---------------------------------------------------------------------------
@router.get("/{disciplina_id}/consolidados", response_model=list[ConsolidadoOut])
async def listar_consolidados(
    disciplina_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _get_disciplina_ou_404(db, disciplina_id)
    result = await db.execute(
        select(ConsolidadoArquivo)
        .where(ConsolidadoArquivo.disciplina_id == disciplina_id)
        .order_by(ConsolidadoArquivo.criado_em.desc())
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /disciplinas/{id}/consolidados
# ---------------------------------------------------------------------------
@router.post(
    "/{disciplina_id}/consolidados",
    response_model=ConsolidadoOut,
    status_code=status.HTTP_201_CREATED,
)
async def criar_consolidado(
    disciplina_id: str,
    payload: ConsolidadoCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Gera um arquivo consolidado (TXT ou PDF) a partir dos materiais selecionados.

    Regras:
    - Para TXT: usa texto de transcrição (materiais de vídeo/áudio) ou o próprio TXT.
    - Para PDF: usa PDFs originais ou convertidos. Materiais sem PDF são ignorados com aviso.
    - Apenas materiais com status CONCLUIDO são aceitos.
    """
    if payload.disciplina_id != disciplina_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="disciplina_id no corpo difere do ID da URL.",
        )

    await _get_disciplina_ou_404(db, disciplina_id)

    # Carrega materiais solicitados
    result = await db.execute(
        select(Material).where(
            Material.id.in_(payload.materiais_ids),
            Material.disciplina_id == disciplina_id,
        )
    )
    materiais = result.scalars().all()

    encontrados_ids = {m.id for m in materiais}
    nao_encontrados = set(payload.materiais_ids) - encontrados_ids
    if nao_encontrados:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Materiais não encontrados na disciplina: {list(nao_encontrados)}",
        )

    # Verifica se todos estão CONCLUIDOS
    nao_concluidos = [
        m.nome_original for m in materiais if m.status != StatusMaterial.CONCLUIDO
    ]
    if nao_concluidos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Os seguintes materiais ainda não foram processados: "
                + ", ".join(nao_concluidos)
            ),
        )

    # Delega a geração do arquivo ao service
    caminho_relativo = await consolidar_materiais(
        materiais=materiais,
        disciplina_id=disciplina_id,
        tipo=payload.tipo,
        nome_base=payload.nome,
    )

    consolidado = ConsolidadoArquivo(
        disciplina_id=disciplina_id,
        nome=payload.nome,
        tipo=payload.tipo,
        caminho_arquivo=caminho_relativo,
        materiais_ids=payload.materiais_ids,
    )
    db.add(consolidado)
    await db.flush()

    await log_auditoria(
        db=db,
        entidade="ConsolidadoArquivo",
        entidade_id=consolidado.id,
        acao="geracao",
        detalhes={
            "nome": payload.nome,
            "tipo": payload.tipo.value,
            "materiais_ids": payload.materiais_ids,
            "caminho": caminho_relativo,
        },
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(consolidado)
    return consolidado


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/consolidados/{cons_id}
# ---------------------------------------------------------------------------
@router.get(
    "/{disciplina_id}/consolidados/{consolidado_id}",
    response_model=ConsolidadoOut,
)
async def obter_consolidado(
    disciplina_id: str,
    consolidado_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await _get_consolidado_ou_404(db, disciplina_id, consolidado_id)


# ---------------------------------------------------------------------------
# DELETE /disciplinas/{id}/consolidados/{cons_id}
# ---------------------------------------------------------------------------
@router.delete(
    "/{disciplina_id}/consolidados/{consolidado_id}",
    response_model=MensagemOut,
)
async def excluir_consolidado(
    disciplina_id: str,
    consolidado_id: str,
    db: AsyncSession = Depends(get_db),
):
    consolidado = await _get_consolidado_ou_404(db, disciplina_id, consolidado_id)
    nome = consolidado.nome

    excluir_arquivo(caminho_absoluto(consolidado.caminho_arquivo))

    await log_auditoria(
        db=db,
        entidade="ConsolidadoArquivo",
        entidade_id=consolidado_id,
        acao="exclusao",
        detalhes={"nome": nome},
        status=StatusAudit.OK,
    )

    await db.delete(consolidado)
    await db.commit()

    return MensagemOut(mensagem=f"Consolidado '{nome}' excluído com sucesso.")
