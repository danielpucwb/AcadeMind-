"""
services/transcricao.py — Transcricao de video/audio com faster-whisper (GPU/CPU).

Fluxo por tipo de material:
  VIDEO / AUDIO -> faster-whisper -> TXT em storage/{disc_id}/transcricoes/{mat_id}.txt
  DOCUMENTO     -> LibreOffice headless -> PDF em storage/{disc_id}/convertidos/
  PDF / TXT     -> sem processamento, status -> CONCLUIDO

Configuracao via variaveis de ambiente:
  WHISPER_MODEL   = large-v3 (padrao) | medium | small | base | tiny
  WHISPER_DEVICE  = cuda (padrao, fallback automatico para cpu)
  WHISPER_COMPUTE = float16 (padrao cuda) | int8

O modelo Whisper e carregado uma unica vez (singleton lazy) e reutilizado.
Progresso transmitido via WebSocket (utils/progresso.py) em cada etapa.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from backend.models import StatusAudit, StatusMaterial, TipoMaterial
from backend.utils.audit import log_auditoria_sync

logger = logging.getLogger("academind.transcricao")

# ---------------------------------------------------------------------------
# Configuracao via env vars
# ---------------------------------------------------------------------------
_MODELO = os.getenv("WHISPER_MODEL", "large-v3")
_DEVICE_PREFERIDO = os.getenv("WHISPER_DEVICE", "cuda")
_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "float16")
_LIMITE_BYTES = 4 * 1024 ** 3  # 4 GB — arquivos maiores sao rejeitados

# ---------------------------------------------------------------------------
# Singleton do modelo Whisper
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_device_real: str = _DEVICE_PREFERIDO
_whisper_lock = asyncio.Lock()


async def _carregar_modelo():
    """Carrega o modelo Whisper na primeira chamada (lazy loading thread-safe)."""
    global _whisper_model, _whisper_device_real
    async with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        loop = asyncio.get_event_loop()
        model, device_usado = await loop.run_in_executor(None, _carregar_sync)
        _whisper_model = model
        _whisper_device_real = device_usado
        logger.info(f"Modelo Whisper '{_MODELO}' carregado em {device_usado.upper()}")
        return _whisper_model


def _carregar_sync() -> tuple:
    """Carregamento sincrono em thread pool. Tenta CUDA, faz fallback para CPU."""
    from faster_whisper import WhisperModel

    if _DEVICE_PREFERIDO == "cuda":
        try:
            model = WhisperModel(_MODELO, device="cuda", compute_type=_COMPUTE_TYPE)
            return model, "cuda"
        except Exception as exc:
            log_auditoria_sync(
                entidade="Sistema",
                entidade_id=None,
                acao="whisper_fallback_cpu",
                detalhes={"motivo": str(exc), "modelo": _MODELO},
                status=StatusAudit.ERRO,
            )
            logger.warning(f"CUDA nao disponivel ({exc}). Usando CPU (int8) — mais lento.")

    model = WhisperModel(_MODELO, device="cpu", compute_type="int8")
    return model, "cpu"


# ---------------------------------------------------------------------------
# Funcao principal — chamada como BackgroundTask pelo router
# ---------------------------------------------------------------------------

async def transcrever_material(material_id: str, disciplina_id: str) -> None:
    """
    Ponto de entrada assicrono para processamento de um material.
    Atualiza o banco e transmite progresso via WebSocket em cada etapa.
    Nunca lanca excecao para fora — erros sao capturados e persistidos.
    """
    from backend.database import AsyncSessionLocal
    from backend.models import Material
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Material).where(Material.id == material_id))
        material = result.scalar_one_or_none()

        if material is None:
            logger.error(f"Material {material_id} nao encontrado para transcricao.")
            return

        await _broadcast(material_id, status="PROCESSANDO", pct=0,
                         msg="Iniciando processamento...")

        try:
            base = Path(__file__).resolve().parent.parent.parent

            if material.tipo in (TipoMaterial.VIDEO, TipoMaterial.AUDIO):
                txt_path = await _processar_audio(material)
                material.transcricao_caminho = str(txt_path.relative_to(base))

            elif material.tipo == TipoMaterial.DOCUMENTO:
                await _broadcast(material_id, status="PROCESSANDO", pct=10,
                                 msg="Convertendo documento para PDF...")
                from backend.services.conversao import converter_para_pdf
                pdf_path = await converter_para_pdf(material)
                material.transcricao_caminho = str(pdf_path.relative_to(base))
                await _broadcast(material_id, status="PROCESSANDO", pct=90,
                                 msg="Conversao concluida.")

            elif material.tipo in (TipoMaterial.PDF, TipoMaterial.TXT):
                await _broadcast(material_id, status="PROCESSANDO", pct=50,
                                 msg="Arquivo pronto - sem conversao necessaria.")

            material.status = StatusMaterial.CONCLUIDO
            material.erro_mensagem = None

            log_auditoria_sync(
                entidade="Material",
                entidade_id=material_id,
                acao="processamento_concluido",
                detalhes={
                    "tipo": material.tipo.value,
                    "transcricao_caminho": material.transcricao_caminho,
                    "device": _whisper_device_real,
                },
                status=StatusAudit.OK,
            )
            await _broadcast(material_id, status="CONCLUIDO", pct=100,
                             msg="Processamento concluido com sucesso!")

        except Exception as exc:
            material.status = StatusMaterial.ERRO
            material.erro_mensagem = _mensagem_amigavel(exc)
            log_auditoria_sync(
                entidade="Material",
                entidade_id=material_id,
                acao="processamento_erro",
                detalhes={"erro": str(exc), "tipo": material.tipo.value},
                status=StatusAudit.ERRO,
            )
            logger.exception(f"Erro ao processar material {material_id}: {exc}")
            await _broadcast(material_id, status="ERRO", pct=0,
                             msg=material.erro_mensagem)

        finally:
            await db.commit()


# ---------------------------------------------------------------------------
# Processamento de audio/video
# ---------------------------------------------------------------------------

async def _processar_audio(material) -> Path:
    """Transcreve arquivo de video ou audio. Retorna o Path do TXT gerado."""
    from backend.utils.storage import caminho_absoluto, caminho_transcricao_material

    caminho_arquivo = caminho_absoluto(material.caminho_arquivo)

    if not caminho_arquivo.exists():
        raise FileNotFoundError(f"Arquivo nao encontrado no storage: {caminho_arquivo.name}")
    tamanho = caminho_arquivo.stat().st_size
    if tamanho > _LIMITE_BYTES:
        raise ValueError(
            f"Arquivo '{material.nome_original}' excede o limite de 4 GB "
            f"({tamanho / 1024**3:.1f} GB). Divida em partes menores."
        )
    if tamanho == 0:
        raise ValueError(f"Arquivo '{material.nome_original}' esta vazio.")

    destino_txt = caminho_transcricao_material(material.disciplina_id, material.id)

    logger.info(
        f"Iniciando transcricao: {caminho_arquivo.name} ({tamanho / 1024**2:.1f} MB)"
    )
    await _broadcast(material.id, status="PROCESSANDO", pct=5,
                     msg="Carregando modelo Whisper...")

    model = await _carregar_modelo()
    await _broadcast(material.id, status="PROCESSANDO", pct=15,
                     msg="Transcrevendo... (pode levar alguns minutos)")

    loop = asyncio.get_event_loop()
    texto, idioma, prob_idioma, duracao_total = await loop.run_in_executor(
        None, _transcrever_sync, model, str(caminho_arquivo), material.id
    )

    cabecalho = _gerar_cabecalho(
        nome_original=material.nome_original,
        idioma=idioma,
        prob_idioma=prob_idioma,
        duracao_total=duracao_total,
        modelo=_MODELO,
        device=_whisper_device_real,
    )
    destino_txt.write_text(cabecalho + texto, encoding="utf-8")

    chars = len(texto)
    logger.info(f"Transcricao concluida: {destino_txt.name} ({chars} caracteres)")
    await _broadcast(material.id, status="PROCESSANDO", pct=95,
                     msg=f"TXT gerado ({chars} caracteres). Salvando...")
    return destino_txt


def _transcrever_sync(model, caminho: str, material_id: str) -> tuple:
    """
    Transcricao sincrona em thread pool.
    Itera o gerador inteiro — nenhum segmento e omitido.
    Retorna (texto, idioma, prob_idioma, duracao_total).
    """
    import asyncio as _asyncio

    segments_gen, info = model.transcribe(
        caminho,
        beam_size=5,
        language=None,                   # deteccao automatica de idioma
        condition_on_previous_text=True,
        vad_filter=True,                 # remove silencias longos
        vad_parameters={"min_silence_duration_ms": 500},
    )

    duracao_total = max(info.duration or 1.0, 1.0)
    linhas: list[str] = []

    try:
        loop = _asyncio.get_event_loop()
    except RuntimeError:
        loop = None

    from backend.utils.progresso import manager as _mgr

    for seg in segments_gen:
        linhas.append(
            f"[{_fmt_tempo(seg.start)} --> {_fmt_tempo(seg.end)}] {seg.text.strip()}"
        )
        pct = min(int(15 + (seg.end / duracao_total) * 80), 94)
        if loop and loop.is_running():
            _asyncio.run_coroutine_threadsafe(
                _mgr.broadcast(material_id, {
                    "status": "PROCESSANDO",
                    "progresso_pct": pct,
                    "mensagem": (
                        f"Transcrevendo {_fmt_tempo(seg.end)} / "
                        f"{_fmt_tempo(duracao_total)}..."
                    ),
                }),
                loop,
            )

    return (
        "\n".join(linhas),
        info.language or "und",
        info.language_probability or 0.0,
        duracao_total,
    )


def _gerar_cabecalho(
    nome_original: str,
    idioma: str,
    prob_idioma: float,
    duracao_total: float,
    modelo: str,
    device: str,
) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    sep = "=" * 70
    return (
        f"{sep}\n"
        f"TRANSCRICAO AUTOMATICA - AcadeMind\n"
        f"{sep}\n"
        f"Arquivo           : {nome_original}\n"
        f"Data processamento: {ts}\n"
        f"Idioma detectado  : {idioma.upper()} (confianca: {prob_idioma:.0%})\n"
        f"Duracao total     : {_fmt_tempo(duracao_total)}\n"
        f"Modelo Whisper    : {modelo} ({device.upper()})\n"
        f"{sep}\n\n"
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_tempo(segundos: float) -> str:
    s = int(segundos)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _mensagem_amigavel(exc: Exception) -> str:
    msg = str(exc)
    for chave, amigavel in [
        ("No such file",       "Arquivo nao encontrado no storage."),
        ("codec can't decode", "Arquivo corrompido ou formato invalido."),
        ("CUDA out of memory", "VRAM insuficiente. Tente WHISPER_MODEL=medium."),
        ("ffmpeg",             "Erro de decodificacao (ffmpeg). Arquivo pode estar corrompido."),
        ("No audio",           "Nenhum trecho de audio detectado no arquivo."),
        ("Timeout",            "Tempo limite excedido durante a conversao."),
        ("excede o limite",    msg),
        ("esta vazio",         msg),
        ("nao encontrado",     msg),
    ]:
        if chave.lower() in msg.lower():
            return amigavel
    return msg[:500]


async def _broadcast(material_id: str, status: str, pct: int, msg: str) -> None:
    from backend.utils.progresso import manager
    await manager.broadcast(
        material_id,
        {"status": status, "progresso_pct": pct, "mensagem": msg},
    )
