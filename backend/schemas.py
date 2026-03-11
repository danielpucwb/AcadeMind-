"""
schemas.py — Pydantic schemas para validação de request/response da API.

Segue o padrão:
  - *Base    : campos comuns
  - *Create  : campos para criação (POST)
  - *Update  : campos para atualização (PATCH), todos opcionais
  - *Out     : campos retornados ao cliente
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from backend.models import StatusAudit, StatusMaterial, TipoConsolidado, TipoMaterial


# ---------------------------------------------------------------------------
# Configuração base compartilhada
# ---------------------------------------------------------------------------

class _BaseOut(BaseModel):
    """Schema base para respostas — habilita orm_mode (from_attributes)."""
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Disciplina
# ---------------------------------------------------------------------------

class DisciplinaCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=255)
    descricao: str | None = None
    codigo: str | None = Field(None, max_length=50)


class DisciplinaUpdate(BaseModel):
    nome: str | None = Field(None, min_length=1, max_length=255)
    descricao: str | None = None
    codigo: str | None = Field(None, max_length=50)


class DisciplinaOut(_BaseOut):
    id: str
    nome: str
    descricao: str | None
    codigo: str | None
    criado_em: datetime
    atualizado_em: datetime


class DisciplinaComMateriais(DisciplinaOut):
    materiais: list[MaterialOut] = []
    consolidados: list[ConsolidadoOut] = []


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------

class MaterialCreate(BaseModel):
    """Usado internamente após upload — a maioria dos campos vem do arquivo."""
    disciplina_id: str
    tipo: TipoMaterial
    nome_original: str
    nome_armazenado: str
    caminho_arquivo: str
    ordem: int = 0


class MaterialUpdate(BaseModel):
    status: StatusMaterial | None = None
    erro_mensagem: str | None = None
    transcricao_caminho: str | None = None
    ordem: int | None = None


class MaterialOut(_BaseOut):
    id: str
    disciplina_id: str
    tipo: TipoMaterial
    nome_original: str
    nome_armazenado: str
    caminho_arquivo: str
    transcricao_caminho: str | None
    status: StatusMaterial
    erro_mensagem: str | None
    criado_em: datetime
    ordem: int


# ---------------------------------------------------------------------------
# ConsolidadoArquivo
# ---------------------------------------------------------------------------

class ConsolidadoCreate(BaseModel):
    disciplina_id: str
    nome: str = Field(..., min_length=1, max_length=512)
    tipo: TipoConsolidado
    materiais_ids: list[str] = Field(..., min_length=1)


class ConsolidadoOut(_BaseOut):
    id: str
    disciplina_id: str
    nome: str
    tipo: TipoConsolidado
    caminho_arquivo: str
    materiais_ids: list[str]
    criado_em: datetime


# ---------------------------------------------------------------------------
# AuditLog
# ---------------------------------------------------------------------------

class AuditLogOut(_BaseOut):
    id: int
    entidade: str
    entidade_id: str | None
    acao: str
    detalhes: dict[str, Any] | None
    status: StatusAudit
    criado_em: datetime


# ---------------------------------------------------------------------------
# Respostas genéricas
# ---------------------------------------------------------------------------

class MensagemOut(BaseModel):
    """Resposta simples de confirmação."""
    mensagem: str
    detalhe: str | None = None


class ErroOut(BaseModel):
    """Resposta de erro padronizada."""
    erro: str
    detalhe: str | None = None


# Resolve forward references (DisciplinaComMateriais referencia MaterialOut/ConsolidadoOut)
DisciplinaComMateriais.model_rebuild()
