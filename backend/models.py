"""
models.py — Modelos ORM do AcadeMind.

Tabelas:
  - Disciplina       : Disciplinas de pós-graduação
  - Material         : Arquivos/materiais associados a uma disciplina
  - ConsolidadoArquivo: Arquivos consolidados (TXT ou PDF) gerados a partir de materiais
  - AuditLog         : Registro de auditoria de todas as operações
"""

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


def _utcnow() -> datetime:
    """Retorna o datetime atual em UTC (timezone-aware)."""
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    """Gera um UUID v4 como string."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TipoMaterial(str, PyEnum):
    VIDEO = "VIDEO"
    AUDIO = "AUDIO"
    PDF = "PDF"
    DOCUMENTO = "DOCUMENTO"  # .docx, .pptx, .xlsx
    TXT = "TXT"


class StatusMaterial(str, PyEnum):
    PENDENTE = "PENDENTE"
    PROCESSANDO = "PROCESSANDO"
    CONCLUIDO = "CONCLUIDO"
    ERRO = "ERRO"


class TipoConsolidado(str, PyEnum):
    TXT = "TXT"
    PDF = "PDF"


class StatusAudit(str, PyEnum):
    OK = "OK"
    ERRO = "ERRO"
    INFO = "INFO"


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class Disciplina(Base):
    """Representa uma disciplina de pós-graduação."""

    __tablename__ = "disciplinas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    nome: Mapped[str] = mapped_column(String(255), nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    codigo: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    # Relacionamentos
    materiais: Mapped[list["Material"]] = relationship(
        "Material", back_populates="disciplina", cascade="all, delete-orphan"
    )
    consolidados: Mapped[list["ConsolidadoArquivo"]] = relationship(
        "ConsolidadoArquivo", back_populates="disciplina", cascade="all, delete-orphan"
    )


class Material(Base):
    """Arquivo/material associado a uma disciplina."""

    __tablename__ = "materiais"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    disciplina_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("disciplinas.id", ondelete="CASCADE"), nullable=False
    )
    tipo: Mapped[TipoMaterial] = mapped_column(
        Enum(TipoMaterial), nullable=False
    )
    nome_original: Mapped[str] = mapped_column(String(512), nullable=False)
    nome_armazenado: Mapped[str] = mapped_column(String(512), nullable=False)
    caminho_arquivo: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Caminho do arquivo TXT gerado pela transcrição ou conversão (nullable)
    transcricao_caminho: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    status: Mapped[StatusMaterial] = mapped_column(
        Enum(StatusMaterial), nullable=False, default=StatusMaterial.PENDENTE
    )
    erro_mensagem: Mapped[str | None] = mapped_column(Text, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    # Ordem de exibição/processamento dentro da disciplina
    ordem: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relacionamentos
    disciplina: Mapped["Disciplina"] = relationship("Disciplina", back_populates="materiais")


class ConsolidadoArquivo(Base):
    """Arquivo consolidado (TXT ou PDF) gerado a partir de múltiplos materiais."""

    __tablename__ = "consolidados"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    disciplina_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("disciplinas.id", ondelete="CASCADE"), nullable=False
    )
    nome: Mapped[str] = mapped_column(String(512), nullable=False)
    tipo: Mapped[TipoConsolidado] = mapped_column(
        Enum(TipoConsolidado), nullable=False
    )
    caminho_arquivo: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Lista dos IDs de Material incluídos neste consolidado, armazenada como JSON array
    materiais_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    # Relacionamentos
    disciplina: Mapped["Disciplina"] = relationship("Disciplina", back_populates="consolidados")

    @property
    def tamanho_bytes(self) -> int:
        """Tamanho do arquivo consolidado em bytes (0 se não encontrado)."""
        from backend.utils.storage import caminho_absoluto, tamanho_arquivo
        return tamanho_arquivo(caminho_absoluto(self.caminho_arquivo))


class AuditLog(Base):
    """Registro imutável de auditoria de operações do sistema."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entidade: Mapped[str] = mapped_column(String(100), nullable=False)   # Ex: "Material", "Disciplina"
    entidade_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    acao: Mapped[str] = mapped_column(String(100), nullable=False)        # Ex: "upload", "transcricao"
    detalhes: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # Dados extras em JSON
    status: Mapped[StatusAudit] = mapped_column(
        Enum(StatusAudit), nullable=False, default=StatusAudit.INFO
    )
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
