"""
routers/config.py — Configuração do servidor AcadeMind.

Endpoints:
  GET   /config           — lê configuração atual
  PATCH /config           — atualiza campos de configuração
  GET   /config/sistema   — informações do sistema (GPU, FFmpeg, LibreOffice)
  POST  /config/testar-transcricao — testa o pipeline de transcrição com áudio sintético
"""

import asyncio
import logging
import math
import os
import struct
import tempfile
import time
import wave

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.utils.config import (
    MODELOS_VALIDOS,
    _BASE_DIR,
    get_tamanho_max,
    get_whisper_model,
    ler_config,
    salvar_config,
)
from backend.utils.startup_checks import resultado_cache

logger = logging.getLogger("academind.config")

router = APIRouter(prefix="/config", tags=["Configurações"])

_MODELOS_INFO = {
    "tiny":     {"vram_gb": 1,  "qualidade": "Baixa",  "velocidade": "Muito rápido"},
    "base":     {"vram_gb": 1,  "qualidade": "Baixa",  "velocidade": "Rápido"},
    "small":    {"vram_gb": 2,  "qualidade": "Média",  "velocidade": "Rápido"},
    "medium":   {"vram_gb": 5,  "qualidade": "Boa",    "velocidade": "Moderado"},
    "large-v3": {"vram_gb": 10, "qualidade": "Ótima",  "velocidade": "Lento (GPU recomendada)"},
}


class ConfigUpdate(BaseModel):
    whisper_model: str | None = Field(None, description="tiny | base | small | medium | large-v3")
    tamanho_max_gb: float | None = Field(None, ge=0.1, le=100, description="Tamanho máximo de upload em GB")


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------

@router.get("/")
async def obter_config():
    cfg = ler_config()
    modelo_atual = cfg.get("whisper_model", "large-v3")
    tam_bytes = cfg.get("tamanho_max_bytes", 10 * 1024 ** 3)
    return {
        "whisper_model": modelo_atual,
        "tamanho_max_bytes": tam_bytes,
        "tamanho_max_gb": round(tam_bytes / 1024 ** 3, 2),
        "storage_dir": str(_BASE_DIR / "storage"),
        "modelos_disponiveis": sorted(MODELOS_VALIDOS),
        "modelos_info": _MODELOS_INFO,
        "modelo_info_atual": _MODELOS_INFO.get(modelo_atual, {}),
    }


# ---------------------------------------------------------------------------
# PATCH /config
# ---------------------------------------------------------------------------

@router.patch("/")
async def atualizar_config(payload: ConfigUpdate):
    alteracoes: dict = {}

    if payload.whisper_model is not None:
        if payload.whisper_model not in MODELOS_VALIDOS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Modelo inválido. Opções: {sorted(MODELOS_VALIDOS)}",
            )
        alteracoes["whisper_model"] = payload.whisper_model

    if payload.tamanho_max_gb is not None:
        alteracoes["tamanho_max_bytes"] = int(payload.tamanho_max_gb * 1024 ** 3)

    if alteracoes:
        salvar_config(alteracoes)

    # Se o modelo mudou, reseta o singleton para recarregar na próxima transcrição
    if "whisper_model" in alteracoes:
        from backend.services import transcricao as _t
        _t._whisper_model = None
        _t._MODELO = alteracoes["whisper_model"]
        logger.info(f"Modelo Whisper alterado para '{alteracoes['whisper_model']}' — será recarregado na próxima transcrição.")

    return await obter_config()


# ---------------------------------------------------------------------------
# GET /config/sistema
# ---------------------------------------------------------------------------

@router.get("/sistema")
async def info_sistema():
    """Retorna informações de hardware/software detectadas na inicialização."""
    checks = resultado_cache()
    return {
        "cuda": checks.get("cuda", False),
        "cuda_info": checks.get("cuda_info", "desconhecido"),
        "ffmpeg": checks.get("ffmpeg", False),
        "libreoffice": checks.get("libreoffice", False),
        "storage_dir": str(_BASE_DIR / "storage"),
        "python_version": __import__("sys").version,
    }


# ---------------------------------------------------------------------------
# POST /config/testar-transcricao
# ---------------------------------------------------------------------------

@router.post("/testar-transcricao")
async def testar_transcricao():
    """
    Gera um WAV de 3s com tom de 440 Hz e tenta transcrever com o modelo atual.
    Retorna sucesso/falha e tempo de execução.
    """
    tmp_path = None
    try:
        # Cria WAV sintético em temp
        sample_rate = 16_000
        duration = 3
        frequency = 440
        amplitude = 8_000

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_path = tmp.name
        tmp.close()

        with wave.open(tmp_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            frames = b"".join(
                struct.pack("<h", int(amplitude * math.sin(2 * math.pi * frequency * i / sample_rate)))
                for i in range(sample_rate * duration)
            )
            wf.writeframes(frames)

        from backend.services.transcricao import _carregar_modelo

        inicio = time.monotonic()
        model = await _carregar_modelo()

        loop = asyncio.get_event_loop()

        def _testar_sync():
            segs, info = model.transcribe(tmp_path, beam_size=1)
            list(segs)  # consome o gerador inteiro
            return info.language or "und"

        idioma = await loop.run_in_executor(None, _testar_sync)
        elapsed = time.monotonic() - inicio

        return {
            "sucesso": True,
            "tempo_segundos": round(elapsed, 2),
            "idioma_detectado": idioma,
            "modelo_usado": get_whisper_model(),
            "mensagem": f"Transcrição de teste concluída em {elapsed:.1f}s.",
        }

    except Exception as exc:
        logger.error(f"Teste de transcrição falhou: {exc}")
        return {
            "sucesso": False,
            "erro": str(exc)[:500],
            "mensagem": "Falha no teste de transcrição. Verifique os logs do servidor.",
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
