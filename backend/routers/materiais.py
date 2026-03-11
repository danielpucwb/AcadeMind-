"""
routers/materiais.py — Upload e gestão de materiais por disciplina.

Endpoints:
  GET    /disciplinas/{id}/materiais            — lista materiais da disciplina
  POST   /disciplinas/{id}/materiais/upload     — faz upload de um arquivo
  GET    /disciplinas/{id}/materiais/{mat_id}   — detalhe do material
  PATCH  /disciplinas/{id}/materiais/{mat_id}   — atualiza campos (ordem, status)
  DELETE /disciplinas/{id}/materiais/{mat_id}   — remove material e arquivo
  POST   /disciplinas/{id}/materiais/{mat_id}/transcrever — dispara transcrição
  GET    /disciplinas/{id}/materiais/{mat_id}/progresso   — SSE de progresso
"""

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Disciplina, Material, StatusAudit, StatusMaterial, TipoMaterial
from backend.schemas import MaterialOut, MaterialUpdate, MensagemOut
from backend.services.transcricao import transcrever_material
from backend.utils.audit import log_auditoria
from backend.utils.storage import (
    caminho_absoluto,
    excluir_arquivo,
    salvar_upload,
    tamanho_arquivo,
)

router = APIRouter(prefix="/disciplinas", tags=["Materiais"])

# Extensões permitidas por tipo
_EXTENSOES_TIPO: dict[TipoMaterial, set[str]] = {
    TipoMaterial.VIDEO: {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"},
    TipoMaterial.AUDIO: {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"},
    TipoMaterial.PDF: {".pdf"},
    TipoMaterial.DOCUMENTO: {".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls"},
    TipoMaterial.TXT: {".txt", ".md"},
}


def _detectar_tipo(nome: str) -> TipoMaterial:
    """Infere o TipoMaterial pela extensão do arquivo."""
    ext = Path(nome).suffix.lower()
    for tipo, exts in _EXTENSOES_TIPO.items():
        if ext in exts:
            return tipo
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Extensão '{ext}' não suportada. Tipos aceitos: vídeo, áudio, PDF, documentos Office, TXT.",
    )


async def _get_disciplina_ou_404(db: AsyncSession, disciplina_id: str) -> Disciplina:
    result = await db.execute(
        select(Disciplina).where(Disciplina.id == disciplina_id)
    )
    disciplina = result.scalar_one_or_none()
    if not disciplina:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disciplina '{disciplina_id}' não encontrada.",
        )
    return disciplina


async def _get_material_ou_404(
    db: AsyncSession,
    disciplina_id: str,
    material_id: str,
) -> Material:
    result = await db.execute(
        select(Material).where(
            Material.id == material_id,
            Material.disciplina_id == disciplina_id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Material '{material_id}' não encontrado na disciplina.",
        )
    return material


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/materiais
# ---------------------------------------------------------------------------
@router.get("/{disciplina_id}/materiais", response_model=list[MaterialOut])
async def listar_materiais(
    disciplina_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _get_disciplina_ou_404(db, disciplina_id)
    result = await db.execute(
        select(Material)
        .where(Material.disciplina_id == disciplina_id)
        .order_by(Material.ordem, Material.criado_em)
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /disciplinas/{id}/materiais/upload
# ---------------------------------------------------------------------------
@router.post(
    "/{disciplina_id}/materiais/upload",
    response_model=MaterialOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_material(
    disciplina_id: str,
    arquivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    await _get_disciplina_ou_404(db, disciplina_id)

    tipo = _detectar_tipo(arquivo.filename or "sem_nome")
    conteudo = await arquivo.read()

    if len(conteudo) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo enviado está vazio.",
        )

    nome_armazenado, caminho_relativo, _ = salvar_upload(
        conteudo=conteudo,
        nome_original=arquivo.filename or "sem_nome",
        disciplina_id=disciplina_id,
    )

    # Determina a próxima ordem
    result = await db.execute(
        select(Material.ordem)
        .where(Material.disciplina_id == disciplina_id)
        .order_by(Material.ordem.desc())
        .limit(1)
    )
    ultima_ordem = result.scalar_one_or_none() or 0

    material = Material(
        disciplina_id=disciplina_id,
        tipo=tipo,
        nome_original=arquivo.filename or "sem_nome",
        nome_armazenado=nome_armazenado,
        caminho_arquivo=caminho_relativo,
        status=StatusMaterial.PENDENTE,
        ordem=ultima_ordem + 1,
    )
    db.add(material)
    await db.flush()

    await log_auditoria(
        db=db,
        entidade="Material",
        entidade_id=material.id,
        acao="upload",
        detalhes={
            "nome_original": arquivo.filename,
            "tipo": tipo.value,
            "tamanho_bytes": len(conteudo),
            "caminho": caminho_relativo,
        },
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(material)
    return material


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/materiais/{mat_id}
# ---------------------------------------------------------------------------
@router.get("/{disciplina_id}/materiais/{material_id}", response_model=MaterialOut)
async def obter_material(
    disciplina_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await _get_material_ou_404(db, disciplina_id, material_id)


# ---------------------------------------------------------------------------
# PATCH /disciplinas/{id}/materiais/{mat_id}
# ---------------------------------------------------------------------------
@router.patch("/{disciplina_id}/materiais/{material_id}", response_model=MaterialOut)
async def atualizar_material(
    disciplina_id: str,
    material_id: str,
    payload: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, disciplina_id, material_id)
    alteracoes = payload.model_dump(exclude_unset=True)

    for campo, valor in alteracoes.items():
        setattr(material, campo, valor)

    await log_auditoria(
        db=db,
        entidade="Material",
        entidade_id=material_id,
        acao="atualizacao",
        detalhes=alteracoes,
        status=StatusAudit.OK,
    )

    await db.commit()
    await db.refresh(material)
    return material


# ---------------------------------------------------------------------------
# DELETE /disciplinas/{id}/materiais/{mat_id}
# ---------------------------------------------------------------------------
@router.delete(
    "/{disciplina_id}/materiais/{material_id}",
    response_model=MensagemOut,
)
async def excluir_material(
    disciplina_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, disciplina_id, material_id)
    nome = material.nome_original

    # Remove arquivos físicos
    excluir_arquivo(caminho_absoluto(material.caminho_arquivo))
    if material.transcricao_caminho:
        excluir_arquivo(caminho_absoluto(material.transcricao_caminho))

    await log_auditoria(
        db=db,
        entidade="Material",
        entidade_id=material_id,
        acao="exclusao",
        detalhes={"nome_original": nome},
        status=StatusAudit.OK,
    )

    await db.delete(material)
    await db.commit()

    return MensagemOut(mensagem=f"Material '{nome}' excluído com sucesso.")


# ---------------------------------------------------------------------------
# POST /disciplinas/{id}/materiais/{mat_id}/transcrever
# ---------------------------------------------------------------------------
@router.post(
    "/{disciplina_id}/materiais/{material_id}/transcrever",
    response_model=MensagemOut,
)
async def iniciar_transcricao(
    disciplina_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Dispara a transcrição/conversão em background para o material especificado.
    Tipos aceitos: VIDEO, AUDIO, DOCUMENTO.
    PDFs e TXTs não precisam de transcrição.
    """
    material = await _get_material_ou_404(db, disciplina_id, material_id)

    if material.tipo == TipoMaterial.TXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivos TXT não precisam de transcrição.",
        )

    if material.status == StatusMaterial.PROCESSANDO:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este material já está sendo processado.",
        )

    # Atualiza status para PROCESSANDO imediatamente
    material.status = StatusMaterial.PROCESSANDO
    material.erro_mensagem = None
    await db.commit()

    # Dispara processamento em background (fire-and-forget)
    asyncio.create_task(
        transcrever_material(material_id=material_id, disciplina_id=disciplina_id)
    )

    return MensagemOut(
        mensagem="Processamento iniciado.",
        detalhe=f"Material '{material.nome_original}' está sendo processado em background.",
    )


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/materiais/{mat_id}/progresso — SSE
# ---------------------------------------------------------------------------
@router.get("/{disciplina_id}/materiais/{material_id}/progresso")
async def progresso_material(
    disciplina_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events: envia atualizações de status a cada 2 segundos
    até o material atingir CONCLUIDO ou ERRO.
    """
    await _get_material_ou_404(db, disciplina_id, material_id)

    async def _gerador():
        import json
        from backend.database import AsyncSessionLocal

        for _ in range(150):  # timeout máximo: 5 minutos (150 × 2s)
            async with AsyncSessionLocal() as sess:
                res = await sess.execute(
                    select(Material).where(Material.id == material_id)
                )
                mat = res.scalar_one_or_none()

            if mat is None:
                yield f"data: {json.dumps({'status': 'REMOVIDO'})}\n\n"
                return

            payload = json.dumps(
                {
                    "status": mat.status.value,
                    "erro": mat.erro_mensagem,
                    "transcricao_caminho": mat.transcricao_caminho,
                }
            )
            yield f"data: {payload}\n\n"

            if mat.status in (StatusMaterial.CONCLUIDO, StatusMaterial.ERRO):
                return

            await asyncio.sleep(2)

        yield f"data: {json.dumps({'status': 'TIMEOUT'})}\n\n"

    return StreamingResponse(
        _gerador(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
