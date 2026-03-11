@echo off
:: ============================================================
:: AcadeMind — Script de inicialização (Windows)
:: ============================================================
:: Pré-requisitos:
::   - Python 3.11+ no PATH
::   - pip install -r backend/requirements.txt (executado automaticamente na 1ª vez)
::   - CUDA Toolkit 12.x e cuDNN para faster-whisper na GPU
::   - LibreOffice instalado (para conversão de documentos Office)
:: ============================================================

title AcadeMind

echo.
echo  ============================
echo   AcadeMind - Iniciando...
echo  ============================
echo.

:: Vai para a pasta do script (raiz do projeto)
cd /d "%~dp0"

:: Verifica se Python está disponível
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    echo        Instale Python 3.11+ em https://www.python.org/
    pause
    exit /b 1
)

:: Instala dependências se necessário (detecta pela ausência do fastapi)
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Instalando dependencias pela primeira vez...
    pip install -r backend/requirements.txt
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar dependencias. Verifique a conexao com a internet.
        pause
        exit /b 1
    )
)

:: Cria pastas necessárias
if not exist "storage" mkdir storage
if not exist "logs" mkdir logs

echo [INFO] Iniciando servidor em http://localhost:8000
echo [INFO] Documentacao da API: http://localhost:8000/api/docs
echo [INFO] Pressione Ctrl+C para encerrar.
echo.

:: Inicia o servidor Uvicorn
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

pause
