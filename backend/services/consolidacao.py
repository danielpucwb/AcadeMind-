"""
services/consolidacao.py — Concatenação de TXTs e PDFs com relatório de falhas.

Tipos de consolidação:
  - TXT: concatena transcrições e conteúdos de texto (TXT originais + transcrições
         geradas de vídeo/áudio), separados por cabeçalhos ════ com nome e data.
  - PDF: concatena PDFs (originais + documentos Office já convertidos via LibreOffice).

Comportamento em caso de falha:
  - Nunca interrompe a geração por causa de um único arquivo problemático.
  - Registra cada falha no log e na lista 'falhas' do resultado.
  - Lança ValueError apenas se NENHUM arquivo pôde ser incluído.

Retorna ResultadoConsolidacao com:
  - caminho_relativo : caminho do arquivo gerado
  - incluidos        : nomes dos materiais incluídos com sucesso
  - falhas           : lista de {"material": str, "erro": str}
  - preview_txt      : primeiros 500 chars do TXT gerado (apenas para TXT)
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from backend.models import Material, TipoMaterial
from backend.utils.storage import caminho_absoluto, caminho_consolidado

logger = logging.getLogger("academind.consolidacao")

# Separador visual para o TXT consolidado
_SEP = "═" * 60


# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------

@dataclass
class ResultadoConsolidacao:
    caminho_relativo: str
    incluidos: list[str] = field(default_factory=list)   # nomes dos materiais incluídos
    falhas: list[dict]   = field(default_factory=list)   # [{"material": str, "erro": str}]
    preview_txt: str | None = None                        # 500 primeiros chars (TXT apenas)


# ---------------------------------------------------------------------------
# Ponto de entrada público
# ---------------------------------------------------------------------------

async def consolidar_txt(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> ResultadoConsolidacao:
    """
    Concatena transcrições e arquivos TXT.
    Materiais elegíveis: TXT originais e VIDEO/AUDIO/DOCUMENTO com transcricao_caminho .txt.
    """
    return await _consolidar_txt(materiais, disciplina_id, nome_base)


async def consolidar_pdf(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> ResultadoConsolidacao:
    """
    Concatena PDFs.
    Materiais elegíveis: PDF originais e DOCUMENTO com transcricao_caminho .pdf.
    """
    return await _consolidar_pdf(materiais, disciplina_id, nome_base)


# ---------------------------------------------------------------------------
# TXT
# ---------------------------------------------------------------------------

async def _consolidar_txt(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> ResultadoConsolidacao:
    destino = caminho_consolidado(disciplina_id, nome_base, ".txt")
    partes: list[str] = []
    resultado = ResultadoConsolidacao(caminho_relativo="")

    for mat in materiais:
        try:
            conteudo = _extrair_texto(mat)
            if conteudo is None:
                raise ValueError("Nenhum texto disponível (sem transcrição ou arquivo TXT).")
            data_fmt = _fmt_data(mat.criado_em)
            cabecalho = (
                f"{_SEP}\n"
                f"{mat.nome_original} — {data_fmt}\n"
                f"{_SEP}\n"
            )
            partes.append(cabecalho + conteudo)
            resultado.incluidos.append(mat.nome_original)
        except Exception as exc:
            resultado.falhas.append({"material": mat.nome_original, "erro": str(exc)})
            logger.warning(f"TXT: '{mat.nome_original}' ignorado — {exc}")

    if not partes:
        raise ValueError(
            "Nenhum material possui conteúdo de texto disponível. "
            f"Falhas: {[f['material'] for f in resultado.falhas]}"
        )

    texto_final = "\n\n".join(partes)
    destino.write_text(texto_final, encoding="utf-8")

    base_dir = Path(__file__).resolve().parent.parent.parent
    resultado.caminho_relativo = str(destino.relative_to(base_dir))
    resultado.preview_txt = texto_final[:500]

    logger.info(
        f"TXT consolidado: '{destino.name}' — "
        f"{len(partes)} incluídos, {len(resultado.falhas)} falhas"
    )
    return resultado


def _extrair_texto(material: Material) -> str | None:
    """
    Retorna o conteúdo de texto de um material.
    Prioriza transcricao_caminho (TXT) → arquivo original (se TXT).
    """
    if material.transcricao_caminho:
        p = caminho_absoluto(material.transcricao_caminho)
        if p.exists() and p.suffix.lower() == ".txt":
            return p.read_text(encoding="utf-8", errors="replace")

    if material.tipo == TipoMaterial.TXT:
        p = caminho_absoluto(material.caminho_arquivo)
        if p.exists():
            return p.read_text(encoding="utf-8", errors="replace")

    return None


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

async def _consolidar_pdf(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> ResultadoConsolidacao:
    import fitz  # PyMuPDF

    destino = caminho_consolidado(disciplina_id, nome_base, ".pdf")
    doc_final = fitz.open()
    resultado = ResultadoConsolidacao(caminho_relativo="")

    for mat in materiais:
        try:
            caminho_pdf = _obter_caminho_pdf(mat)
            if caminho_pdf is None:
                raise ValueError("Nenhum PDF disponível para este material.")
            if not caminho_pdf.exists():
                raise FileNotFoundError(f"Arquivo PDF não encontrado: {caminho_pdf.name}")

            doc_src = fitz.open(str(caminho_pdf))
            doc_final.insert_pdf(doc_src)
            doc_src.close()
            resultado.incluidos.append(mat.nome_original)
        except Exception as exc:
            resultado.falhas.append({"material": mat.nome_original, "erro": str(exc)})
            logger.error(f"PDF: '{mat.nome_original}' ignorado — {exc}")

    if not resultado.incluidos:
        doc_final.close()
        raise ValueError(
            "Nenhum material possui PDF disponível para consolidar. "
            f"Falhas: {[f['material'] for f in resultado.falhas]}"
        )

    doc_final.save(str(destino), garbage=4, deflate=True)
    doc_final.close()

    base_dir = Path(__file__).resolve().parent.parent.parent
    resultado.caminho_relativo = str(destino.relative_to(base_dir))

    logger.info(
        f"PDF consolidado: '{destino.name}' — "
        f"{len(resultado.incluidos)} incluídos, {len(resultado.falhas)} falhas"
    )
    return resultado


def _obter_caminho_pdf(material: Material) -> Path | None:
    """
    Retorna o Path do PDF associado a um material.
    Prioriza PDF convertido (transcricao_caminho .pdf) > PDF original.
    """
    if material.transcricao_caminho:
        p = caminho_absoluto(material.transcricao_caminho)
        if p.suffix.lower() == ".pdf":
            return p

    if material.tipo == TipoMaterial.PDF:
        return caminho_absoluto(material.caminho_arquivo)

    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_data(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%d/%m/%Y %H:%M")
