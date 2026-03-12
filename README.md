# AcadeMind 🎓

> **Orientador acadêmico local para pós-graduação**

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![SQLite](https://img.shields.io/badge/SQLite-aiosqlite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-green)](LICENSE)
[![Plataforma](https://img.shields.io/badge/Plataforma-Windows%2011-0078D4?logo=windows&logoColor=white)](https://www.microsoft.com/windows)

---

## Índice

1. [Sobre o Projeto](#sobre-o-projeto)
2. [Stack Tecnológica](#stack-tecnológica)
3. [Pré-requisitos](#pré-requisitos)
4. [Instalação](#instalação)
5. [Como Usar](#como-usar)
6. [Estrutura do Projeto](#estrutura-do-projeto)
7. [Variáveis de Ambiente](#variáveis-de-ambiente)
8. [Docker](#docker)
9. [Solução de Problemas](#solução-de-problemas)
10. [Contribuindo](#contribuindo)
11. [Licença](#licença)

---

## Sobre o Projeto

O **AcadeMind** é uma aplicação web local desenvolvida para auxiliar estudantes de pós-graduação a organizar, transcrever e consolidar materiais de estudo. Roda inteiramente na sua máquina — nenhum dado é enviado para servidores externos.

### Principais recursos

- 📁 **Organização por disciplina** — cadastre e gerencie suas disciplinas com materiais separados por pasta
- 🎙 **Transcrição automática** — transcreve vídeos e áudios via [faster-whisper](https://github.com/SYSTRAN/faster-whisper) com suporte a GPU NVIDIA (CUDA) e fallback automático para CPU
- 📄 **Conversão de documentos** — converte arquivos Office (`.docx`, `.pptx`, `.xlsx`) para PDF via LibreOffice headless
- 🗂 **Consolidação de materiais** — gera um único arquivo TXT ou PDF contendo todos os materiais selecionados de uma disciplina
- 📊 **Log de auditoria** — todas as operações são registradas em banco de dados e arquivo de log, com filtros e exportação
- ⚙️ **Configurações via interface** — troque o modelo Whisper, ajuste o limite de upload e teste a transcrição sem editar arquivos
- 🔄 **Progresso em tempo real** — acompanhe a transcrição via WebSocket com barra de progresso por segmento

### Interface

> 📸 **[Inserir screenshot da tela de disciplinas]**
> 📸 **[Inserir screenshot da tela de material com barra de progresso]**
> 📸 **[Inserir screenshot da tela de logs de auditoria]**

---

## Stack Tecnológica

| Tecnologia | Versão recomendada | Finalidade |
|---|---|---|
| [Python](https://www.python.org/) | 3.11+ | Linguagem principal do backend |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.111+ | Framework web assíncrono (API REST + WebSocket) |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | ORM async com SQLite via aiosqlite |
| [SQLite](https://www.sqlite.org/) | (embutido) | Banco de dados local sem configuração |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 1.0+ | Transcrição de vídeo/áudio (CTranslate2 + Whisper) |
| [PyMuPDF](https://pymupdf.readthedocs.io/) | 1.24+ | Concatenação de PDFs |
| [LibreOffice](https://www.libreoffice.org/) | 7.x+ | Conversão de Office → PDF (headless) |
| [FFmpeg](https://ffmpeg.org/) | 6.x+ | Decodificação de áudio/vídeo para o Whisper |
| [Uvicorn](https://www.uvicorn.org/) | 0.29+ | Servidor ASGI de produção |

---

## Pré-requisitos

### Python 3.11+

```bat
python --version
:: Python 3.11.x ou superior
```

Download: [python.org/downloads](https://www.python.org/downloads/)

> ⚠️ Marque **"Add Python to PATH"** durante a instalação.

---

### NVIDIA GPU com CUDA (recomendado)

O AcadeMind usa CUDA para acelerar a transcrição com faster-whisper. Uma GPU com ≥ 8 GB de VRAM (ex.: RTX 3060, RTX 4080) é ideal para o modelo `large-v3`.

```bat
nvidia-smi
:: Verifique a versão do driver e se CUDA está disponível
```

- Driver NVIDIA: [nvidia.com/drivers](https://www.nvidia.com/Download/index.aspx)
- CUDA Toolkit 12.x: [developer.nvidia.com/cuda-downloads](https://developer.nvidia.com/cuda-downloads)

> 💡 **CPU funciona**, porém a transcrição será significativamente mais lenta. Nesse caso, use `WHISPER_MODEL=small` ou `WHISPER_MODEL=medium`.

---

### FFmpeg

Necessário para decodificação de vídeo e áudio antes da transcrição.

```bat
ffmpeg -version
:: ffmpeg version 6.x ...
```

Download: [ffmpeg.org/download.html](https://ffmpeg.org/download.html) → Windows builds → **BtbN** ou **gyan.dev**

Após baixar, extraia e adicione a pasta `bin/` ao PATH do sistema.

---

### LibreOffice

Necessário para converter documentos Office (`.docx`, `.pptx`, `.xlsx`) em PDF.

```bat
libreoffice --version
:: LibreOffice 7.x.x ...
```

Download: [libreoffice.org/download](https://www.libreoffice.org/download/libreoffice-fresh/)

---

### Git

```bat
git --version
:: git version 2.x.x
```

Download: [git-scm.com](https://git-scm.com/download/win)

---

## Instalação

### 1. Clone o repositório

```bat
git clone https://github.com/danielpucwb/AcadeMind-.git
cd AcadeMind-
```

### 2. Crie e ative o ambiente virtual

```bat
python -m venv venv
venv\Scripts\activate
```

Você verá `(venv)` no início do prompt quando o ambiente estiver ativo.

### 3. Instale as dependências

```bat
pip install -r backend/requirements.txt
```

> ⏱ Na primeira execução pode demorar alguns minutos — faster-whisper e PyMuPDF são pacotes grandes.

### 4. (Opcional) Configure o modelo Whisper

Por padrão o AcadeMind usa `large-v3`, que oferece a melhor qualidade mas requer ~10 GB de VRAM. Para GPUs menores ou CPU:

```bat
:: Para GPU com 4-8 GB de VRAM:
set WHISPER_MODEL=medium

:: Para CPU ou GPU com < 4 GB:
set WHISPER_MODEL=small
```

Você também pode alterar o modelo pela **tela de Configurações** dentro da interface, sem editar variáveis de ambiente.

### 5. Inicie a aplicação

**Opção A — Script automatizado (recomendado no Windows):**

```bat
start.bat
```

**Opção B — Comando manual:**

```bat
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 6. Acesse no navegador

```
http://localhost:8000
```

A documentação interativa da API (Swagger) fica em:

```
http://localhost:8000/api/docs
```

---

## Como Usar

### Fluxo típico

```
Criar disciplina → Adicionar materiais → Aguardar processamento → Consolidar → Exportar
```

#### 1. Criar uma disciplina

Na tela inicial, clique em **+ Nova Disciplina** (ou pressione `Ctrl+N`) e preencha o nome e, opcionalmente, código e descrição.

#### 2. Adicionar materiais

Dentro de uma disciplina, arraste arquivos para a zona de upload ou clique para selecionar. São aceitos:

| Tipo | Extensões |
|---|---|
| Vídeo | `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v` |
| Áudio | `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.aac` |
| Documento Office | `.docx`, `.pptx`, `.xlsx`, `.doc`, `.ppt`, `.xls`, `.odt`, `.odp`, `.ods` |
| PDF | `.pdf` |
| Texto | `.txt`, `.md` |

#### 3. Acompanhar o processamento

Vídeos e áudios são transcritos automaticamente. A barra de progresso em tempo real mostra cada segmento sendo transcrito. Documentos Office são convertidos para PDF via LibreOffice.

Quando concluído, os botões **⬇ Original** e **📄 Transcrição** ficam disponíveis para download.

#### 4. Consolidar materiais

Clique em **🗂 Consolidar Arquivos** e escolha a aba:

- **Consolidar TXT** — concatena as transcrições de vídeos/áudios e arquivos TXT em um único `.txt` com separadores
- **Consolidar PDF** — une PDFs originais e documentos convertidos em um único `.pdf`

Selecione os materiais desejados, dê um nome ao arquivo e clique em **Gerar**. Uma prévia dos primeiros 500 caracteres é exibida imediatamente.

#### 5. Logs de auditoria

Acesse **Logs & Auditoria** no menu para consultar o histórico completo de operações com filtros por entidade, status e período. Exporte como `.json` ou `.txt` para análise externa.

#### 6. Configurações

Em **Configurações** é possível:

- Trocar o modelo Whisper (tiny / base / small / medium / large-v3)
- Ajustar o limite de tamanho de upload por arquivo
- Verificar se GPU, FFmpeg e LibreOffice foram detectados
- Executar um teste rápido de transcrição para validar o ambiente

---

## Estrutura do Projeto

```
AcadeMind-/
├── backend/
│   ├── main.py                  # Ponto de entrada FastAPI + WebSocket + startup checks
│   ├── models.py                # Modelos ORM (Disciplina, Material, ConsolidadoArquivo, AuditLog)
│   ├── schemas.py               # Schemas Pydantic de request/response
│   ├── database.py              # Configuração SQLAlchemy async (SQLite + aiosqlite)
│   ├── requirements.txt         # Dependências Python
│   ├── routers/
│   │   ├── disciplinas.py       # CRUD de disciplinas
│   │   ├── materiais.py         # Upload, download, reprocessamento e exclusão de materiais
│   │   ├── consolidados.py      # Geração e gestão de arquivos consolidados (TXT e PDF)
│   │   ├── logs.py              # Consulta e exportação de logs de auditoria
│   │   └── config.py            # Configurações do servidor (modelo Whisper, limites, testes)
│   ├── services/
│   │   ├── transcricao.py       # faster-whisper (CUDA/CPU), conversão Office→PDF via LibreOffice
│   │   ├── consolidacao.py      # Concatenação TXT e PDF (PyMuPDF)
│   │   └── conversao.py         # LibreOffice headless → PDF
│   └── utils/
│       ├── audit.py             # Logger dual (banco + arquivo)
│       ├── config.py            # Leitura/escrita de config.json
│       ├── progresso.py         # Gerenciador de conexões WebSocket por material
│       ├── startup_checks.py    # Verificação de FFmpeg, LibreOffice e CUDA
│       └── storage.py           # Helpers de caminho e operações de arquivo
├── frontend/
│   ├── index.html               # Shell HTML da SPA
│   ├── app.js                   # SPA vanilla JS (~1 750 linhas): roteamento, views, WebSocket
│   └── style.css                # Tema claro, componentes, animações (~1 000 linhas)
├── storage/                     # Criado automaticamente: arquivos por disciplina
│   └── {disciplina_id}/
│       ├── originais/           # Uploads do usuário
│       ├── transcricoes/        # TXTs gerados pelo Whisper
│       ├── convertidos/         # PDFs gerados pelo LibreOffice
│       └── consolidados/        # Arquivos consolidados gerados
├── logs/
│   └── audit.log                # Log de auditoria em texto plano
├── academind.db                 # Banco SQLite (criado na primeira execução)
├── config.json                  # Configurações persistidas via interface (criado na primeira execução)
├── start.bat                    # Script de inicialização para Windows
├── Dockerfile                   # Imagem Docker (sem GPU; use docker-compose para GPU)
├── docker-compose.yml           # Compose com suporte a NVIDIA runtime
└── README.md                    # Este arquivo
```

---

## Variáveis de Ambiente

Estas variáveis são lidas na inicialização do servidor. Valores persistidos em `config.json` (via tela de Configurações) têm **prioridade** sobre as variáveis de ambiente para modelo e tamanho máximo.

| Variável | Padrão | Descrição |
|---|---|---|
| `WHISPER_MODEL` | `large-v3` | Modelo Whisper: `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_DEVICE` | `cuda` | Dispositivo de inferência. Fallback automático para `cpu` se CUDA não disponível |
| `WHISPER_COMPUTE` | `float16` | Tipo de computação: `float16` (CUDA) ou `int8` (CPU) |

### Exemplo de configuração via `.env` (carregado manualmente no `start.bat`)

```bat
set WHISPER_MODEL=medium
set WHISPER_DEVICE=cuda
set WHISPER_COMPUTE=float16
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

---

## Docker

O AcadeMind pode ser executado via Docker. O `Dockerfile` usa uma imagem Python slim sem suporte a GPU — ideal para uso com CPU ou em servidores sem placa NVIDIA.

Para **aceleração GPU dentro do Docker**, use o `docker-compose.yml` com o NVIDIA Container Toolkit.

### Sem GPU (CPU only)

```bash
docker build -t academind .
docker run -p 8000:8000 \
  -v $(pwd)/storage:/app/storage \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/academind.db:/app/academind.db \
  academind
```

### Com GPU (NVIDIA)

> Requer: [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) instalado no host.

```bash
docker compose up
```

Acesse: `http://localhost:8000`

> ⚠️ **LibreOffice e FFmpeg** estão incluídos na imagem Docker. O modelo Whisper é baixado automaticamente na primeira transcrição e cacheado no volume `whisper-cache`.

---

## Solução de Problemas

| Problema | Causa provável | Solução |
|---|---|---|
| `CUDA not available` nos logs | Driver NVIDIA desatualizado ou CUDA Toolkit não instalado | Instale o [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) e o driver mais recente. O app usará CPU automaticamente. |
| `ffmpeg: command not found` | FFmpeg não está no PATH | Baixe em [ffmpeg.org](https://ffmpeg.org/download.html), extraia e adicione a pasta `bin/` ao PATH do sistema (`Configurações do Windows → Variáveis de Ambiente`). |
| Documentos Office não convertem | LibreOffice não encontrado no PATH | Instale o [LibreOffice](https://www.libreoffice.org/download/) e verifique com `libreoffice --version`. No Windows, o instalador adiciona ao PATH automaticamente. |
| `Porta 8000 já em uso` | Outro processo usando a porta | Troque a porta: `python -m uvicorn backend.main:app --port 8001` ou encerre o processo: `netstat -ano \| findstr :8000` → `taskkill /PID <pid> /F` |
| Transcrição muito lenta | Modelo `large-v3` na CPU | Acesse **Configurações → Modelo Whisper** e troque para `small` ou `medium`. A velocidade de transcrição aumenta ~4-10x. |
| `CUDA out of memory` | VRAM insuficiente para o modelo | Troque para `medium` (5 GB) ou `small` (2 GB) em **Configurações**. |
| Arquivo não aceito no upload | Extensão não suportada | O app aceita: `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.aac`, `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.doc`, `.ppt`, `.xls`, `.odt`, `.odp`, `.ods`, `.txt`, `.md` |
| `python-multipart` não encontrado | Dependência ausente | Execute `pip install -r backend/requirements.txt` novamente dentro do venv. |
| Banco de dados corrompido | Encerramento abrupto do servidor | Delete `academind.db` — o banco será recriado na próxima inicialização. **Atenção: todos os registros serão perdidos.** |

---

## Contribuindo

Contribuições são bem-vindas! Siga o fluxo padrão do GitHub:

```bash
# 1. Faça um fork do repositório
# 2. Crie uma branch com a feature ou correção
git checkout -b feat/nome-da-feature

# 3. Implemente as mudanças e escreva testes se aplicável
# 4. Commit seguindo Conventional Commits
git commit -m "feat(materiais): adicionar suporte a formato .opus"

# 5. Push e abra um Pull Request
git push origin feat/nome-da-feature
```

### Padrão de commits (Conventional Commits)

| Tipo | Uso |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Refatoração sem mudança de comportamento |
| `docs` | Documentação |
| `chore` | Tarefas de manutenção (deps, configs) |
| `test` | Adição ou correção de testes |

---

## Licença

Distribuído sob a licença **MIT**. Veja [`LICENSE`](LICENSE) para mais detalhes.

```
MIT License

Copyright (c) 2024 Daniel — AcadeMind

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">
  Feito com ☕ e Python · <a href="http://localhost:8000">localhost:8000</a>
</div>
