"""
routers/materiais.py — Upload e gestão de materiais por disciplina.

Routers registrados:
  router_disc  — prefixo /disciplinas (rotas aninhadas)
  router_mat   — prefixo /materiais  (rotas planas)

Endpoints (router_disc):
  GET    /disciplinas/{id}/materiais            — lista materiais da disciplina
  POST   /disciplinas/{id}/materiais/upload     — faz upload de um ou mais arquivos
  GET    /disciplinas/{id}/materiais/{mat_id}/progresso — SSE de progresso (fallback)

Endpoints (router_mat):
  GET    /materiais/{mat_id}                    — detalhe do material
  PATCH  /materiais/{mat_id}                    — atualiza campos (ordem, nome)
  DELETE /materiais/{mat_id}                    — remove material e arquivo físico
  GET    /materiais/{mat_id}/download           — download do arquivo original
  GET    /materiais/{mat_id}/transcricao/download — download do TXT/PDF gerado
"""

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
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
)

router_disc = APIRouter(prefix="/disciplinas", tags=["Materiais"])
router_mat  = APIRouter(prefix="/materiais",   tags=["Materiais"])

# ---------------------------------------------------------------------------
# Extensões aceitas por tipo
# ---------------------------------------------------------------------------
_EXT_TIPO: dict[str, TipoMaterial] = {
    # Vídeo
    ".mp4": TipoMaterial.VIDEO, ".mkv": TipoMaterial.VIDEO,
    ".avi": TipoMaterial.VIDEO, ".mov": TipoMaterial.VIDEO,
    ".webm": TipoMaterial.VIDEO, ".m4v": TipoMaterial.VIDEO,
    # Áudio
    ".mp3": TipoMaterial.AUDIO, ".wav": TipoMaterial.AUDIO,
    ".m4a": TipoMaterial.AUDIO, ".ogg": TipoMaterial.AUDIO,
    ".flac": TipoMaterial.AUDIO, ".aac": TipoMaterial.AUDIO,
    # Documentos Office
    ".docx": TipoMaterial.DOCUMENTO, ".pptx": TipoMaterial.DOCUMENTO,
    ".xlsx": TipoMaterial.DOCUMENTO, ".doc": TipoMaterial.DOCUMENTO,
    ".ppt": TipoMaterial.DOCUMENTO, ".xls": TipoMaterial.DOCUMENTO,
    ".odt": TipoMaterial.DOCUMENTO, ".odp": TipoMaterial.DOCUMENTO,
    ".ods": TipoMaterial.DOCUMENTO,
    # PDF
    ".pdf": TipoMaterial.PDF,
    # Texto
    ".txt": TipoMaterial.TXT, ".md": TipoMaterial.TXT,
}

_TIPOS_SEM_PROCESSAMENTO = {TipoMaterial.PDF, TipoMaterial.TXT}
_TAMANHO_MAX = 4 * 1024 ** 3  # 4 GB


def _detectar_tipo(nome: str) -> TipoMaterial:
    ext = Path(nome).suffix.lower()
    tipo = _EXT_TIPO.get(ext)
    if tipo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Extensão '{ext}' não suportada. "
                "Aceitos: vídeo, áudio, PDF, documentos Office (.docx/.pptx/.xlsx/.odt/…), TXT."
            ),
        )
    return tipo


# ---------------------------------------------------------------------------
# Helpers de busca
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


async def _get_material_ou_404(db: AsyncSession, material_id: str) -> Material:
    result = await db.execute(select(Material).where(Material.id == material_id))
    mat = result.scalar_one_or_none()
    if not mat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Material '{material_id}' não encontrado.",
        )
    return mat


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/materiais
# ---------------------------------------------------------------------------
@router_disc.get("/{disciplina_id}/materiais", response_model=list[MaterialOut])
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
# POST /disciplinas/{id}/materiais/upload  — multi-file
# ---------------------------------------------------------------------------
@router_disc.post(
    "/{disciplina_id}/materiais/upload",
    response_model=list[MaterialOut],
    status_code=status.HTTP_201_CREATED,
)
async def upload_materiais(
    disciplina_id: str,
    background_tasks: BackgroundTasks,
    arquivos: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Recebe um ou mais arquivos, persiste cada um e dispara processamento
    automático em background (transcrição/conversão) para cada material.
    """
    await _get_disciplina_ou_404(db, disciplina_id)

    if not arquivos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nenhum arquivo enviado.",
        )

    # Próxima ordem disponível
    result = await db.execute(
        select(Material.ordem)
        .where(Material.disciplina_id == disciplina_id)
        .order_by(Material.ordem.desc())
        .limit(1)
    )
    proxima_ordem = (result.scalar_one_or_none() or 0) + 1

    criados: list[Material] = []

    for arquivo in arquivos:
        nome = arquivo.filename or "sem_nome"
        tipo = _detectar_tipo(nome)
        conteudo = await arquivo.read()

        if len(conteudo) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Arquivo '{nome}' está vazio.",
            )
        if len(conteudo) > _TAMANHO_MAX:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Arquivo '{nome}' excede o limite de 4 GB.",
            )

        nome_armazenado, caminho_relativo, _ = salvar_upload(
            conteudo=conteudo,
            nome_original=nome,
            disciplina_id=disciplina_id,
        )

        # PDF e TXT já nascem como CONCLUIDO (sem processamento adicional)
        status_inicial = (
            StatusMaterial.CONCLUIDO
            if tipo in _TIPOS_SEM_PROCESSAMENTO
            else StatusMaterial.PENDENTE
        )

        material = Material(
            disciplina_id=disciplina_id,
            tipo=tipo,
            nome_original=nome,
            nome_armazenado=nome_armazenado,
            caminho_arquivo=caminho_relativo,
            status=status_inicial,
            ordem=proxima_ordem,
        )
        db.add(material)
        await db.flush()

        await log_auditoria(
            db=db,
            entidade="Material",
            entidade_id=material.id,
            acao="upload",
            detalhes={
                "nome_original": nome,
                "tipo": tipo.value,
                "tamanho_bytes": len(conteudo),
                "caminho": caminho_relativo,
            },
            status=StatusAudit.OK,
        )

        criados.append(material)
        proxima_ordem += 1

    await db.commit()
    for m in criados:
        await db.refresh(m)

    # Dispara processamento em background para os que precisam
    for m in criados:
        if m.tipo not in _TIPOS_SEM_PROCESSAMENTO:
            background_tasks.add_task(
                transcrever_material,
                material_id=m.id,
                disciplina_id=disciplina_id,
            )

    return criados


# ---------------------------------------------------------------------------
# GET /disciplinas/{id}/materiais/{mat_id}/progresso — SSE (fallback)
# ---------------------------------------------------------------------------
@router_disc.get("/{disciplina_id}/materiais/{material_id}/progresso")
async def progresso_material_sse(
    disciplina_id: str,
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events: polling a cada 2s até CONCLUIDO/ERRO.
    Use o WebSocket em /ws/materiais/{id}/progresso quando possível.
    """
    await _get_disciplina_ou_404(db, disciplina_id)
    await _get_material_ou_404(db, material_id)

    async def _gerador():
        import json
        from backend.database import AsyncSessionLocal

        for _ in range(150):  # timeout máximo: 5 min
            async with AsyncSessionLocal() as sess:
                res = await sess.execute(select(Material).where(Material.id == material_id))
                mat = res.scalar_one_or_none()

            if mat is None:
                yield f"data: {json.dumps({'status': 'REMOVIDO'})}\n\n"
                return

            yield f"data: {json.dumps({'status': mat.status.value, 'erro': mat.erro_mensagem, 'transcricao_caminho': mat.transcricao_caminho})}\n\n"

            if mat.status in (StatusMaterial.CONCLUIDO, StatusMaterial.ERRO):
                return

            await asyncio.sleep(2)

        yield f"data: {json.dumps({'status': 'TIMEOUT'})}\n\n"

    return StreamingResponse(
        _gerador(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===========================================================================
# Rotas planas — router_mat (prefixo /materiais)
# ===========================================================================

# ---------------------------------------------------------------------------
# GET /materiais/{mat_id}
# ---------------------------------------------------------------------------
@router_mat.get("/{material_id}", response_model=MaterialOut)
async def obter_material(
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await _get_material_ou_404(db, material_id)


# ---------------------------------------------------------------------------
# PATCH /materiais/{mat_id}
# ---------------------------------------------------------------------------
@router_mat.patch("/{material_id}", response_model=MaterialOut)
async def atualizar_material(
    material_id: str,
    payload: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, material_id)
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
# DELETE /materiais/{mat_id}
# ---------------------------------------------------------------------------
@router_mat.delete("/{material_id}", response_model=MensagemOut)
async def excluir_material(
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, material_id)
    nome = material.nome_original

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
# GET /materiais/{mat_id}/download — arquivo original
# ---------------------------------------------------------------------------
@router_mat.get("/{material_id}/download")
async def download_material(
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, material_id)
    caminho = caminho_absoluto(material.caminho_arquivo)

    if not caminho.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Arquivo físico não encontrado no storage.",
        )

    return FileResponse(
        path=str(caminho),
        filename=material.nome_original,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{material.nome_original}"'
        },
    )


# ---------------------------------------------------------------------------
# GET /materiais/{mat_id}/transcricao/download — TXT/PDF gerado
# ---------------------------------------------------------------------------
@router_mat.get("/{material_id}/transcricao/download")
async def download_transcricao(
    material_id: str,
    db: AsyncSession = Depends(get_db),
):
    material = await _get_material_ou_404(db, material_id)

    if not material.transcricao_caminho:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nenhuma transcrição disponível para este material.",
        )

    if material.status != StatusMaterial.CONCLUIDO:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Material ainda não concluído (status: {material.status.value}).",
        )

    caminho = caminho_absoluto(material.transcricao_caminho)
    if not caminho.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Arquivo de transcrição não encontrado no storage.",
        )

    stem = Path(material.nome_original).stem
    nome_download = f"{stem}_transcricao{caminho.suffix}"

    return FileResponse(
        path=str(caminho),
        filename=nome_download,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{nome_download}"'},
    )
