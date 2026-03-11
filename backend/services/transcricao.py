"""
services/transcricao.py — Transcrição de vídeo/áudio com faster-whisper (GPU).

Fluxo para materiais de VÍDEO e ÁUDIO:
  1. Carrega o modelo Whisper na GPU (RTX 4080 — CUDA float16)
  2. Transcreve segmento a segmento, sem truncar
  3. Salva o TXT resultante em storage/{disciplina_id}/transcritos/
  4. Atualiza o status do Material no banco

Fluxo para materiais de DOCUMENTO (.docx, .pptx, .xlsx):
  1. Delega para conversao.py (LibreOffice → PDF)
  2. Atualiza status no banco

PDFs originais: apenas atualiza status para CONCLUIDO (já são PDF nativamente).
TXTs: nunca chegam aqui (o router filtra antes).

Decisão de implementação: o modelo Whisper é carregado uma única vez em memória
e reutilizado para todas as transcrições (singleton thread-safe via asyncio.Lock).
Isso evita o custo de carregar o modelo a cada requisição (~5–10s no primeiro uso).
"""

import asyncio
import logging
from pathlib import Path

from backend.models import StatusMaterial, TipoMaterial
from backend.utils.audit import log_auditoria_sync
from backend.models import StatusAudit

logger = logging.getLogger("academind.transcricao")

# ---------------------------------------------------------------------------
# Singleton do modelo Whisper
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_lock = asyncio.Lock()

# Modelo padrão: "large-v3" para melhor precisão; altere para "medium" se VRAM for limitada
_MODELO = "large-v3"
_DEVICE = "cuda"
_COMPUTE_TYPE = "float16"  # RTX 4080 suporta float16; use "int8" para modelos maiores


async def _carregar_modelo():
    """Carrega o modelo Whisper na GPU na primeira chamada (lazy loading)."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        # Executa em thread pool para não bloquear o event loop durante o carregamento
        loop = asyncio.get_event_loop()
        _whisper_model = await loop.run_in_executor(None, _carregar_sync)
        logger.info(f"Modelo Whisper '{_MODELO}' carregado na GPU.")
        return _whisper_model


def _carregar_sync():
    from faster_whisper import WhisperModel
    return WhisperModel(_MODELO, device=_DEVICE, compute_type=_COMPUTE_TYPE)


# ---------------------------------------------------------------------------
# Função principal (chamada pelo router em background)
# ---------------------------------------------------------------------------

async def transcrever_material(material_id: str, disciplina_id: str) -> None:
    """
    Processa um material: transcreve áudio/vídeo ou converte documento.
    Atualiza o banco de dados ao final com status CONCLUIDO ou ERRO.
    """
    from backend.database import AsyncSessionLocal
    from backend.models import Material
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Material).where(Material.id == material_id))
        material = result.scalar_one_or_none()

        if material is None:
            logger.error(f"Material {material_id} não encontrado para transcrição.")
            return

        try:
            if material.tipo in (TipoMaterial.VIDEO, TipoMaterial.AUDIO):
                transcricao_path = await _transcrever_audio(material)
                material.transcricao_caminho = str(
                    transcricao_path.relative_to(
                        Path(__file__).resolve().parent.parent.parent
                    )
                )

            elif material.tipo == TipoMaterial.DOCUMENTO:
                from backend.services.conversao import converter_para_pdf
                pdf_path = await converter_para_pdf(material)
                material.transcricao_caminho = str(
                    pdf_path.relative_to(
                        Path(__file__).resolve().parent.parent.parent
                    )
                )

            elif material.tipo == TipoMaterial.PDF:
                # PDF nativo: já processável, sem necessidade de conversão
                pass

            material.status = StatusMaterial.CONCLUIDO
            material.erro_mensagem = None

            log_auditoria_sync(
                entidade="Material",
                entidade_id=material_id,
                acao="processamento_concluido",
                detalhes={
                    "tipo": material.tipo.value,
                    "transcricao_caminho": material.transcricao_caminho,
                },
                status=StatusAudit.OK,
            )

        except Exception as exc:
            material.status = StatusMaterial.ERRO
            material.erro_mensagem = str(exc)[:1000]  # Limita para não estourar coluna

            log_auditoria_sync(
                entidade="Material",
                entidade_id=material_id,
                acao="processamento_erro",
                detalhes={"erro": str(exc), "tipo": material.tipo.value},
                status=StatusAudit.ERRO,
            )
            logger.exception(f"Erro ao processar material {material_id}: {exc}")

        finally:
            await db.commit()


async def _transcrever_audio(material) -> Path:
    """
    Transcreve um arquivo de vídeo/áudio usando faster-whisper na GPU.
    Retorna o Path do arquivo TXT gerado.
    """
    from backend.utils.storage import caminho_absoluto, caminho_transcricao

    caminho_arquivo = caminho_absoluto(material.caminho_arquivo)
    destino_txt = caminho_transcricao(material.disciplina_id, material.nome_armazenado)

    logger.info(f"Iniciando transcrição: {caminho_arquivo.name}")

    model = await _carregar_modelo()

    # Executa transcrição em thread pool (CPU-bound + GPU)
    loop = asyncio.get_event_loop()
    texto = await loop.run_in_executor(
        None,
        _transcrever_sync,
        model,
        str(caminho_arquivo),
    )

    destino_txt.write_text(texto, encoding="utf-8")
    logger.info(f"Transcrição concluída: {destino_txt.name} ({len(texto)} caracteres)")
    return destino_txt


def _transcrever_sync(model, caminho: str) -> str:
    """
    Executa a transcrição de forma síncrona (rodada em thread pool).
    Concatena todos os segmentos sem omitir nenhum.
    """
    segments, info = model.transcribe(
        caminho,
        beam_size=5,
        language=None,        # Detecção automática de idioma
        condition_on_previous_text=True,
        vad_filter=True,      # Remove silêncios longos para acelerar
        vad_parameters={"min_silence_duration_ms": 500},
    )

    linhas = []
    for seg in segments:
        inicio = _formatar_tempo(seg.start)
        fim = _formatar_tempo(seg.end)
        linhas.append(f"[{inicio} --> {fim}] {seg.text.strip()}")

    return "\n".join(linhas)


def _formatar_tempo(segundos: float) -> str:
    """Converte segundos em HH:MM:SS."""
    h = int(segundos // 3600)
    m = int((segundos % 3600) // 60)
    s = int(segundos % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"
