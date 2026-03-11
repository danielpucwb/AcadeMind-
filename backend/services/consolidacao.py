"""
services/consolidacao.py — Concatenação de TXTs e PDFs.

Tipos de consolidação suportados:
  - TXT: concatena transcrições e conteúdos de texto de cada material,
         separados por cabeçalhos identificadores
  - PDF: concatena PDFs usando PyMuPDF (fitz), mantendo todas as páginas

Decisão de implementação:
  - Para TXT: lê os arquivos de transcrição (ou o próprio TXT original)
    e os junta em sequência. Nenhum conteúdo é omitido.
  - Para PDF: usa fitz.Document.insert_pdf() para concatenar sem recomprimir.
    Materiais sem PDF são logados e pulados (não interrompem o processo).
  - A ordem dos materiais no consolidado respeita a lista materiais_ids fornecida.
"""

import logging
from pathlib import Path

from backend.models import Material, TipoConsolidado, TipoMaterial
from backend.utils.storage import caminho_absoluto, caminho_consolidado

logger = logging.getLogger("academind.consolidacao")


async def consolidar_materiais(
    materiais: list[Material],
    disciplina_id: str,
    tipo: TipoConsolidado,
    nome_base: str,
) -> str:
    """
    Gera um arquivo consolidado (TXT ou PDF) e retorna o caminho relativo.

    Args:
        materiais:    Lista de instâncias Material (já filtradas e ordenadas).
        disciplina_id: ID da disciplina dona dos materiais.
        tipo:         TipoConsolidado.TXT ou TipoConsolidado.PDF
        nome_base:    Nome base para o arquivo gerado (sem extensão).

    Returns:
        Caminho relativo ao projeto do arquivo consolidado gerado.
    """
    if tipo == TipoConsolidado.TXT:
        return await _consolidar_txt(materiais, disciplina_id, nome_base)
    else:
        return await _consolidar_pdf(materiais, disciplina_id, nome_base)


# ---------------------------------------------------------------------------
# Consolidação TXT
# ---------------------------------------------------------------------------

async def _consolidar_txt(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> str:
    destino = caminho_consolidado(disciplina_id, nome_base, ".txt")
    partes: list[str] = []
    ignorados: list[str] = []

    for mat in materiais:
        conteudo = _extrair_texto(mat)
        if conteudo is None:
            ignorados.append(mat.nome_original)
            logger.warning(
                f"Material '{mat.nome_original}' não possui texto disponível — ignorado no consolidado TXT."
            )
            continue

        cabecalho = (
            f"{'=' * 80}\n"
            f"Material: {mat.nome_original}\n"
            f"Tipo: {mat.tipo.value}\n"
            f"{'=' * 80}\n"
        )
        partes.append(cabecalho + conteudo)

    if not partes:
        raise ValueError(
            "Nenhum material possui conteúdo de texto disponível para consolidar. "
            f"Materiais ignorados: {', '.join(ignorados)}"
        )

    texto_final = "\n\n".join(partes)
    destino.write_text(texto_final, encoding="utf-8")

    if ignorados:
        logger.info(
            f"Consolidado TXT gerado com {len(partes)} materiais. "
            f"Ignorados (sem texto): {ignorados}"
        )

    base_dir = Path(__file__).resolve().parent.parent.parent
    return str(destino.relative_to(base_dir))


def _extrair_texto(material: Material) -> str | None:
    """
    Retorna o conteúdo de texto de um material.
    Prioriza: transcricao_caminho > arquivo original (se TXT).
    Retorna None se nenhum texto estiver disponível.
    """
    # 1. Arquivo de transcrição (vídeo/áudio transcrito, documento convertido para texto)
    if material.transcricao_caminho:
        p = caminho_absoluto(material.transcricao_caminho)
        if p.exists() and p.suffix.lower() == ".txt":
            return p.read_text(encoding="utf-8", errors="replace")

    # 2. Arquivo original TXT
    if material.tipo == TipoMaterial.TXT:
        p = caminho_absoluto(material.caminho_arquivo)
        if p.exists():
            return p.read_text(encoding="utf-8", errors="replace")

    return None


# ---------------------------------------------------------------------------
# Consolidação PDF
# ---------------------------------------------------------------------------

async def _consolidar_pdf(
    materiais: list[Material],
    disciplina_id: str,
    nome_base: str,
) -> str:
    import fitz  # PyMuPDF — importado aqui para não exigir instalação em ambientes somente texto

    destino = caminho_consolidado(disciplina_id, nome_base, ".pdf")
    doc_final = fitz.open()  # Documento PDF vazio
    ignorados: list[str] = []
    incluidos = 0

    for mat in materiais:
        caminho_pdf = _obter_caminho_pdf(mat)
        if caminho_pdf is None or not caminho_pdf.exists():
            ignorados.append(mat.nome_original)
            logger.warning(
                f"Material '{mat.nome_original}' não possui PDF disponível — ignorado no consolidado PDF."
            )
            continue

        try:
            doc_src = fitz.open(str(caminho_pdf))
            doc_final.insert_pdf(doc_src)
            doc_src.close()
            incluidos += 1
        except Exception as exc:
            ignorados.append(mat.nome_original)
            logger.error(
                f"Erro ao incluir '{mat.nome_original}' no PDF consolidado: {exc}"
            )

    if incluidos == 0:
        doc_final.close()
        raise ValueError(
            "Nenhum material possui PDF disponível para consolidar. "
            f"Materiais ignorados: {', '.join(ignorados)}"
        )

    doc_final.save(str(destino), garbage=4, deflate=True)
    doc_final.close()

    if ignorados:
        logger.info(
            f"Consolidado PDF gerado com {incluidos} materiais. "
            f"Ignorados (sem PDF): {ignorados}"
        )

    base_dir = Path(__file__).resolve().parent.parent.parent
    return str(destino.relative_to(base_dir))


def _obter_caminho_pdf(material: Material) -> Path | None:
    """
    Retorna o Path do PDF associado a um material.
    Prioriza: PDF convertido (transcricao_caminho) > PDF original.
    """
    # 1. PDF gerado pela conversão (DOCUMENTO → PDF)
    if material.transcricao_caminho:
        p = caminho_absoluto(material.transcricao_caminho)
        if p.suffix.lower() == ".pdf":
            return p

    # 2. PDF original enviado pelo usuário
    if material.tipo == TipoMaterial.PDF:
        return caminho_absoluto(material.caminho_arquivo)

    return None
