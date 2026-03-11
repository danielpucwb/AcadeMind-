"""
services/conversao.py — Conversão de documentos Office para PDF via LibreOffice headless.

Suporta: .docx, .pptx, .xlsx, .doc, .ppt, .xls

Decisão de implementação:
  - LibreOffice headless é invocado via subprocess assíncrono (asyncio.create_subprocess_exec)
  - O PDF gerado vai para storage/{disciplina_id}/convertidos/
  - O arquivo original NÃO é removido (mantido em originais/)
  - Timeout configurável: padrão 120s (arquivos grandes podem demorar)

Pré-requisito: LibreOffice instalado e disponível no PATH, ou
  em C:/Program Files/LibreOffice/program/soffice.exe (Windows)
"""

import asyncio
import logging
import shutil
from pathlib import Path

logger = logging.getLogger("academind.conversao")

# Timeout para a conversão em segundos — ajuste para arquivos muito grandes
_TIMEOUT_SEGUNDOS = 120

# Localiza o executável do LibreOffice
def _encontrar_soffice() -> str:
    """Retorna o caminho do executável soffice ou lança RuntimeError."""
    # Tenta primeiro o PATH
    caminho_path = shutil.which("soffice") or shutil.which("soffice.exe")
    if caminho_path:
        return caminho_path

    # Fallback: localização padrão no Windows
    candidatos = [
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    ]
    for c in candidatos:
        if c.exists():
            return str(c)

    raise RuntimeError(
        "LibreOffice não encontrado. Instale-o em https://www.libreoffice.org/ "
        "e certifique-se de que 'soffice' está no PATH ou na pasta padrão do Windows."
    )


async def converter_para_pdf(material) -> Path:
    """
    Converte um documento Office para PDF usando LibreOffice headless.

    Args:
        material: instância de Material com caminho_arquivo e nome_armazenado.

    Returns:
        Path absoluto do PDF gerado.

    Raises:
        RuntimeError: se LibreOffice não for encontrado ou a conversão falhar.
    """
    from backend.utils.storage import caminho_absoluto, caminho_convertido

    caminho_original = caminho_absoluto(material.caminho_arquivo)
    destino_pdf = caminho_convertido(material.disciplina_id, material.nome_armazenado)
    outdir = destino_pdf.parent

    soffice = _encontrar_soffice()

    logger.info(f"Convertendo '{caminho_original.name}' para PDF...")

    cmd = [
        soffice,
        "--headless",
        "--norestore",
        "--convert-to", "pdf",
        "--outdir", str(outdir),
        str(caminho_original),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=_TIMEOUT_SEGUNDOS
        )
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(
            f"Timeout de {_TIMEOUT_SEGUNDOS}s excedido ao converter '{caminho_original.name}'."
        )

    if proc.returncode != 0:
        erro = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"LibreOffice retornou código {proc.returncode} ao converter "
            f"'{caminho_original.name}': {erro}"
        )

    # O LibreOffice gera o PDF com o mesmo stem do arquivo original, em outdir
    pdf_gerado = outdir / f"{caminho_original.stem}.pdf"
    if not pdf_gerado.exists():
        raise RuntimeError(
            f"LibreOffice concluiu sem erro, mas o PDF esperado não foi encontrado: {pdf_gerado}"
        )

    # Renomeia para o nome padronizado (com UUID, conforme storage.py)
    if pdf_gerado != destino_pdf:
        pdf_gerado.rename(destino_pdf)

    logger.info(f"Conversão concluída: {destino_pdf.name}")
    return destino_pdf
