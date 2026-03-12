"""
utils/startup_checks.py — Verificações de ambiente na inicialização do AcadeMind.

Verifica:
  - FFmpeg      → necessário para que o Whisper processe vídeo/áudio
  - LibreOffice → necessário para converter documentos Office para PDF
  - CUDA        → aceleração GPU para o Whisper (opcional, fallback para CPU)

Os resultados ficam em memória para serem consultados por GET /config/sistema.
"""

import logging
import shutil
import subprocess

logger = logging.getLogger("academind.startup")

# Cache dos resultados (populado em executar_todas())
_resultado: dict = {}


def checar_ffmpeg() -> bool:
    """Verifica se FFmpeg está instalado e acessível no PATH."""
    if shutil.which("ffmpeg") is None:
        logger.error(
            "⚠️  FFmpeg NÃO encontrado no PATH. "
            "O Whisper não conseguirá decodificar vídeo/áudio. "
            "Instale: https://ffmpeg.org/download.html"
        )
        return False
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True, timeout=5,
        )
        versao = result.stdout.splitlines()[0] if result.stdout else "?"
        logger.info(f"✅ FFmpeg disponível: {versao}")
        return True
    except Exception as exc:
        logger.warning(f"FFmpeg encontrado mas falhou ao verificar versão: {exc}")
        return True  # encontrado no PATH, assume OK


def checar_libreoffice() -> bool:
    """Verifica se LibreOffice está instalado e acessível no PATH."""
    for cmd in ("libreoffice", "soffice"):
        if shutil.which(cmd):
            logger.info(f"✅ LibreOffice disponível: {cmd}")
            return True
    logger.warning(
        "⚠️  LibreOffice NÃO encontrado no PATH. "
        "Documentos Office (.docx/.pptx/.xlsx) não poderão ser convertidos para PDF. "
        "Instale: https://www.libreoffice.org/download/"
    )
    return False


def checar_cuda() -> tuple[bool, str]:
    """Verifica se CUDA está disponível via PyTorch."""
    try:
        import torch

        if torch.cuda.is_available():
            nome = torch.cuda.get_device_name(0)
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
            info = f"{nome} ({vram_gb:.1f} GB VRAM)"
            logger.info(f"✅ CUDA disponível: {info}")
            return True, info
        else:
            logger.info("ℹ️  CUDA não disponível — transcrição usará CPU (mais lento).")
            return False, "CPU"
    except ImportError:
        logger.info("ℹ️  PyTorch não instalado — não é possível verificar CUDA.")
        return False, "desconhecido"
    except Exception as exc:
        logger.warning(f"Erro ao verificar CUDA: {exc}")
        return False, "erro na verificação"


def executar_todas() -> dict:
    """
    Executa todas as verificações de ambiente.
    Armazena o resultado em cache e o retorna.
    """
    global _resultado
    ffmpeg = checar_ffmpeg()
    libreoffice = checar_libreoffice()
    cuda_ok, cuda_info = checar_cuda()

    _resultado = {
        "ffmpeg": ffmpeg,
        "libreoffice": libreoffice,
        "cuda": cuda_ok,
        "cuda_info": cuda_info,
    }
    return _resultado


def resultado_cache() -> dict:
    """Retorna o último resultado de executar_todas() (sem re-executar)."""
    return _resultado or executar_todas()
