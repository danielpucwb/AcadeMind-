"""
utils/storage.py — Helpers para gestão de arquivos em ./storage/.

Estrutura de diretórios em storage/:
  storage/
    {disciplina_id}/
      originais/   — arquivos enviados pelo usuário sem alteração
      transcritos/ — TXTs gerados pela transcrição de vídeo/áudio
      convertidos/ — PDFs gerados pela conversão de documentos Office
      consolidados/— TXTs e PDFs consolidados

Nenhum arquivo é sobrescrito silenciosamente: nomes são tornado únicos com UUID.
"""

import shutil
import uuid
from pathlib import Path

# ---------------------------------------------------------------------------
# Raiz do storage
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent.parent
STORAGE_ROOT = _BASE_DIR / "storage"


# ---------------------------------------------------------------------------
# Helpers de caminho
# ---------------------------------------------------------------------------

def _disciplina_dir(disciplina_id: str) -> Path:
    return STORAGE_ROOT / disciplina_id


def originais_dir(disciplina_id: str) -> Path:
    return _disciplina_dir(disciplina_id) / "originais"


def transcritos_dir(disciplina_id: str) -> Path:
    return _disciplina_dir(disciplina_id) / "transcritos"


def convertidos_dir(disciplina_id: str) -> Path:
    return _disciplina_dir(disciplina_id) / "convertidos"


def consolidados_dir(disciplina_id: str) -> Path:
    return _disciplina_dir(disciplina_id) / "consolidados"


def garantir_diretorios(disciplina_id: str) -> None:
    """Cria todos os subdiretórios de uma disciplina se não existirem."""
    for d in [
        originais_dir(disciplina_id),
        transcritos_dir(disciplina_id),
        convertidos_dir(disciplina_id),
        consolidados_dir(disciplina_id),
    ]:
        d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Operações de arquivo
# ---------------------------------------------------------------------------

def salvar_upload(
    conteudo: bytes,
    nome_original: str,
    disciplina_id: str,
) -> tuple[str, str, Path]:
    """
    Salva bytes de upload em storage/{disciplina_id}/originais/.

    Retorna:
        (nome_armazenado, caminho_relativo_str, caminho_absoluto)

    O nome armazenado inclui um UUID para evitar colisões de nomes.
    O caminho relativo é relativo à raiz do projeto.
    """
    garantir_diretorios(disciplina_id)
    sufixo = Path(nome_original).suffix.lower()
    uid = uuid.uuid4().hex[:8]
    nome_armazenado = f"{Path(nome_original).stem}_{uid}{sufixo}"
    destino = originais_dir(disciplina_id) / nome_armazenado
    destino.write_bytes(conteudo)
    caminho_relativo = str(destino.relative_to(_BASE_DIR))
    return nome_armazenado, caminho_relativo, destino


def caminho_transcricao(disciplina_id: str, nome_armazenado: str) -> Path:
    """Retorna o Path onde o TXT de transcrição de um material será salvo."""
    garantir_diretorios(disciplina_id)
    stem = Path(nome_armazenado).stem
    return transcritos_dir(disciplina_id) / f"{stem}.txt"


def caminho_convertido(disciplina_id: str, nome_armazenado: str) -> Path:
    """Retorna o Path onde o PDF convertido de um documento Office será salvo."""
    garantir_diretorios(disciplina_id)
    stem = Path(nome_armazenado).stem
    return convertidos_dir(disciplina_id) / f"{stem}.pdf"


def caminho_consolidado(
    disciplina_id: str,
    nome_base: str,
    extensao: str,  # ".txt" ou ".pdf"
) -> Path:
    """Retorna o Path para um arquivo consolidado, com UUID para unicidade."""
    garantir_diretorios(disciplina_id)
    uid = uuid.uuid4().hex[:8]
    nome_seguro = _sanitize(nome_base)
    return consolidados_dir(disciplina_id) / f"{nome_seguro}_{uid}{extensao}"


def excluir_arquivo(caminho: str | Path) -> bool:
    """
    Remove um arquivo do storage. Retorna True se removido, False se não existia.
    Nunca lança exceção — erros são silenciados (o log deve ser feito pelo chamador).
    """
    p = Path(caminho) if isinstance(caminho, str) else caminho
    try:
        if p.exists():
            p.unlink()
            return True
        return False
    except Exception:
        return False


def tamanho_arquivo(caminho: str | Path) -> int:
    """Retorna o tamanho em bytes de um arquivo, ou 0 se não existir."""
    p = Path(caminho) if isinstance(caminho, str) else caminho
    try:
        return p.stat().st_size
    except Exception:
        return 0


def caminho_absoluto(caminho_relativo: str) -> Path:
    """Converte caminho relativo ao projeto em Path absoluto."""
    return _BASE_DIR / caminho_relativo


# ---------------------------------------------------------------------------
# Internos
# ---------------------------------------------------------------------------

def _sanitize(nome: str) -> str:
    """Remove caracteres inválidos para nomes de arquivo no Windows."""
    invalidos = r'\/:*?"<>|'
    for c in invalidos:
        nome = nome.replace(c, "_")
    return nome.strip()[:100]  # Limita o tamanho para segurança
