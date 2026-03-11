"""
routers/consolidados.py — Geração e gestão de arquivos consolidados.

Routers registrados:
  router       — prefixo /disciplinas (rotas aninhadas)
  router_flat  — prefixo /consolidados (rotas planas)

Endpoints (router):
  GET    /disciplinas/{id}/consolidados            — lista consolidados da disciplina
  POST   /disciplinas/{id}/consolidar/txt          — gera consolidado TXT
  POST   /disciplinas/{id}/consolidar/pdf          — gera consolidado PDF

Endpoints (router_flat):
  GET    /consolidados/{id}/download               — download do arquivo consolidado
  DELETE /consolidados/{id}                        — remove registro e arquivo físico
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
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
from backend.schemas import (
    ConsolidarPdfCreate,
    ConsolidarTxtCreate,
    ConsolidadoOut,
    ConsolidadoResultOut,
    FalhaConsolidacao,
    MensagemOut,
)
from backend.services.consolidacao import consolidar_pdf, consolidar_txt
from backend.utils.audit import log_auditoria
from backend.utils.storage import caminho_absoluto, excluir_arquivo

router      = APIRouter(prefix="/disciplinas",  tags=["Consolidados"])
router_flat = APIRouter(prefix="/consolidados", tags=["Consolidados"])


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

async def _get_disciplina_ou_404(db: AsyncSession, disciplina_id: str) -> Disciplina:
    result = await db.execute(select(Disciplina).where(Disciplina.id == disciplina_id))
    disc = result.scalar_one_or_none()
    if not disc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )
    return disc


async def _get_consolidado_ou_404(
    db: AsyncSession, consolidado_id: str
) -> ConsolidadoArquivo:
    result = await db.execute(
        select(ConsolidadoArquivo).where(ConsolidadoArquivo.id == consolidado_id)
    )
    cons = result.scalar_one_or_none()
    if not cons:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Consolidado '{consolidado_id}' não encontrado.",
        )
    return cons


async def _carregar_materiais(
    db: AsyncSession,
    disciplina_id: str,
    materiais_ids: list[str],
) -> list[Material]:
    """
    Carrega materiais por ID, verifica que pertencem à disciplina e estão CONCLUIDOS.
    Levanta HTTPException se algum não for encontrado ou não estiver concluído.
    """
    result = await db.execute(
        select(Material).where(
            Material.id.in_(materiais_ids),
            Material.disciplina_id == disciplina_id,
        )
    )
    materiais = result.scalars().all()

    encontrados = {m.id for m in materiais}
    nao_encontrados = set(materiais_ids) - encontrados
    if nao_encontrados:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Materiais não encontrados na disciplina: {sorted(nao_encontrados)}",
        )

    nao_concluidos = [m.nome_original for m in materiais if m.status != StatusMaterial.CONCLUIDO]
    if nao_concluidos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Os seguintes materiais ainda não foram processados: "
                + ", ".join(nao_concluidos)
            ),
        )

    # Retorna na ordem solicitada pelo caller
    ordem_map = {mid: i for i, mid in enumerate(materiais_ids)}
    return sorted(materiais, key=lambda m: ordem_map.get(m.id, 999))


def _construir_resultado(
    consolidado: ConsolidadoArquivo,
    incluidos: list[str],
    falhas: list[dict],
    preview_txt: str | None,
) -> ConsolidadoResultOut:
    aviso = None
    if falhas:
        nomes = ", ".join(f["material"] for f in falhas)
        aviso = f"{len(falhas)} arquivo(s) não puderam ser incluídos: {nomes}"

    return ConsolidadoResultOut(
        consolidado=ConsolidadoOut.model_validate(consolidado),
        incluidos=incluidos,
        falhas=[FalhaConsolidacao(**f) for f in falhas],
        aviso=aviso,
        preview_txt=preview_txt,
    )


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
# POST /disciplinas/{id}/consolidar/txt
# ---------------------------------------------------------------------------
@router.post(
    "/{disciplina_id}/consolidar/txt",
    response_model=ConsolidadoResultOut,
    status_code=status.HTTP_201_CREATED,
)
async def consolidar_materiais_txt(
    disciplina_id: str,
    payload: ConsolidarTxtCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Gera um TXT consolidado a partir de:
      - Materiais do tipo TXT (originais)
      - Materiais de vídeo/áudio com transcrição gerada (CONCLUIDO)
      - Materiais de documento com transcrição em TXT

    Materiais que não possuem texto são registrados como falha e ignorados
    (o processo não é interrompido).
    """
    await _get_disciplina_ou_404(db, disciplina_id)
    materiais = await _carregar_materiais(db, disciplina_id, payload.materiais_ids)

    # Filtra apenas materiais elegíveis para TXT
    elegiveis = [
        m for m in materiais
        if m.tipo == TipoMaterial.TXT
        or (m.tipo in (TipoMaterial.VIDEO, TipoMaterial.AUDIO) and m.transcricao_caminho)
        or (m.tipo == TipoMaterial.DOCUMENTO and m.transcricao_caminho
            and m.transcricao_caminho.endswith(".txt"))
    ]

    nao_elegiveis = [m for m in materiais if m not in elegiveis]
    falhas_tipo = [
        {"material": m.nome_original, "erro": f"Tipo '{m.tipo.value}' não gera conteúdo TXT."}
        for m in nao_elegiveis
    ]

    if not elegiveis:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nenhum dos materiais selecionados possui conteúdo TXT disponível.",
        )

    resultado = await consolidar_txt(elegiveis, disciplina_id, payload.nome)
    resultado.falhas = falhas_tipo + resultado.falhas

    consolidado = ConsolidadoArquivo(
        disciplina_id=disciplina_id,
        nome=payload.nome,
        tipo=TipoConsolidado.TXT,
        caminho_arquivo=resultado.caminho_relativo,
        materiais_ids=payload.materiais_ids,
    )
    db.add(consolidado)
    await db.flush()

    await log_auditoria(
        db=db,
        entidade="ConsolidadoArquivo",
        entidade_id=consolidado.id,
        acao="geracao_txt",
        detalhes={
            "nome": payload.nome,
            "incluidos": resultado.incluidos,
            "falhas": resultado.falhas,
            "tamanho_bytes": consolidado.tamanho_bytes,
        },
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(consolidado)
    return _construir_resultado(consolidado, resultado.incluidos, resultado.falhas, resultado.preview_txt)


# ---------------------------------------------------------------------------
# POST /disciplinas/{id}/consolidar/pdf
# ---------------------------------------------------------------------------
@router.post(
    "/{disciplina_id}/consolidar/pdf",
    response_model=ConsolidadoResultOut,
    status_code=status.HTTP_201_CREATED,
)
async def consolidar_materiais_pdf(
    disciplina_id: str,
    payload: ConsolidarPdfCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Gera um PDF consolidado a partir de:
      - Materiais do tipo PDF (originais)
      - Materiais de documento Office já convertidos para PDF (CONCLUIDO)

    Materiais que falham na concatenação são registrados e ignorados
    (o processo não é interrompido).
    """
    await _get_disciplina_ou_404(db, disciplina_id)
    materiais = await _carregar_materiais(db, disciplina_id, payload.materiais_ids)

    # Filtra apenas materiais elegíveis para PDF
    elegiveis = [
        m for m in materiais
        if m.tipo == TipoMaterial.PDF
        or (m.tipo == TipoMaterial.DOCUMENTO and m.transcricao_caminho
            and m.transcricao_caminho.endswith(".pdf"))
    ]

    nao_elegiveis = [m for m in materiais if m not in elegiveis]
    falhas_tipo = [
        {"material": m.nome_original, "erro": f"Tipo '{m.tipo.value}' não possui PDF disponível."}
        for m in nao_elegiveis
    ]

    if not elegiveis:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nenhum dos materiais selecionados possui PDF disponível.",
        )

    resultado = await consolidar_pdf(elegiveis, disciplina_id, payload.nome)
    resultado.falhas = falhas_tipo + resultado.falhas

    consolidado = ConsolidadoArquivo(
        disciplina_id=disciplina_id,
        nome=payload.nome,
        tipo=TipoConsolidado.PDF,
        caminho_arquivo=resultado.caminho_relativo,
        materiais_ids=payload.materiais_ids,
    )
    db.add(consolidado)
    await db.flush()

    await log_auditoria(
        db=db,
        entidade="ConsolidadoArquivo",
        entidade_id=consolidado.id,
        acao="geracao_pdf",
        detalhes={
            "nome": payload.nome,
            "incluidos": resultado.incluidos,
            "falhas": resultado.falhas,
            "tamanho_bytes": consolidado.tamanho_bytes,
        },
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(consolidado)
    return _construir_resultado(consolidado, resultado.incluidos, resultado.falhas, None)


# ===========================================================================
# Rotas planas — router_flat (prefixo /consolidados)
# ===========================================================================

# ---------------------------------------------------------------------------
# GET /consolidados/{id}/download
# ---------------------------------------------------------------------------
@router_flat.get("/{consolidado_id}/download")
async def download_consolidado(
    consolidado_id: str,
    db: AsyncSession = Depends(get_db),
):
    consolidado = await _get_consolidado_ou_404(db, consolidado_id)
    caminho = caminho_absoluto(consolidado.caminho_arquivo)

    if not caminho.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Arquivo consolidado não encontrado no storage.",
        )

    ext = caminho.suffix
    nome_download = f"{consolidado.nome}{ext}"

    return FileResponse(
        path=str(caminho),
        filename=nome_download,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{nome_download}"'},
    )


# ---------------------------------------------------------------------------
# DELETE /consolidados/{id}
# ---------------------------------------------------------------------------
@router_flat.delete("/{consolidado_id}", response_model=MensagemOut)
async def excluir_consolidado(
    consolidado_id: str,
    db: AsyncSession = Depends(get_db),
):
    consolidado = await _get_consolidado_ou_404(db, consolidado_id)
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
