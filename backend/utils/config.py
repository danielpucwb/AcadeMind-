"""
utils/config.py — Configuração persistente do AcadeMind.

Armazenada em config.json na raiz do projeto.
Valores padrão usados quando o arquivo não existe ou há campos ausentes.
"""

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("academind.config")

_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_CONFIG_FILE = _BASE_DIR / "config.json"

_DEFAULTS: dict[str, Any] = {
    "whisper_model": "large-v3",
    "tamanho_max_bytes": 10 * 1024 ** 3,  # 10 GB
}

MODELOS_VALIDOS: set[str] = {"tiny", "base", "small", "medium", "large-v3"}


def ler_config() -> dict[str, Any]:
    """Lê config.json e mescla com os valores padrão."""
    if _CONFIG_FILE.exists():
        try:
            dados = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
            return {**_DEFAULTS, **dados}
        except Exception as exc:
            logger.warning(f"Erro ao ler config.json: {exc}. Usando defaults.")
    return dict(_DEFAULTS)


def salvar_config(dados: dict[str, Any]) -> None:
    """Persiste campos em config.json (merge com o existente)."""
    atual = ler_config()
    atual.update(dados)
    _CONFIG_FILE.write_text(
        json.dumps(atual, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_whisper_model() -> str:
    return ler_config().get("whisper_model", _DEFAULTS["whisper_model"])


def get_tamanho_max() -> int:
    return int(ler_config().get("tamanho_max_bytes", _DEFAULTS["tamanho_max_bytes"]))
