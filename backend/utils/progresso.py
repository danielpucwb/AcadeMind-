"""
utils/progresso.py — Gerenciador de WebSocket para progresso de processamento.

Cada material em processamento pode ter N clientes WebSocket conectados.
O serviço de transcrição chama `manager.broadcast()` para notificar todos.

Payload enviado ao cliente:
  {
    "status":       "PROCESSANDO" | "CONCLUIDO" | "ERRO",
    "progresso_pct": 0–100,
    "mensagem":     "texto descritivo da etapa atual"
  }
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("academind.progresso")


class ProgressoManager:
    """Mantém conexões WebSocket ativas por material_id."""

    def __init__(self) -> None:
        # material_id -> conjunto de WebSockets ativos
        self._conexoes: dict[str, set[WebSocket]] = {}

    async def connect(self, material_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._conexoes.setdefault(material_id, set()).add(ws)
        logger.debug(f"WS conectado: material={material_id}, total={len(self._conexoes[material_id])}")

    def disconnect(self, material_id: str, ws: WebSocket) -> None:
        conj = self._conexoes.get(material_id, set())
        conj.discard(ws)
        if not conj:
            self._conexoes.pop(material_id, None)
        logger.debug(f"WS desconectado: material={material_id}")

    async def broadcast(self, material_id: str, payload: dict[str, Any]) -> None:
        """Envia payload JSON para todos os clientes conectados ao material."""
        conj = self._conexoes.get(material_id, set())
        if not conj:
            return
        msg = json.dumps(payload, ensure_ascii=False, default=str)
        mortos: list[WebSocket] = []
        for ws in list(conj):
            try:
                await ws.send_text(msg)
            except Exception:
                mortos.append(ws)
        for ws in mortos:
            self.disconnect(material_id, ws)

    def tem_conexoes(self, material_id: str) -> bool:
        return bool(self._conexoes.get(material_id))


# Instância global — importada pelo service e pelo router WS
manager = ProgressoManager()
