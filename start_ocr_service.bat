@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ── 遠端 OCR 服務(給 NAS 轉發用)。跑在這台有 GPU 的機器上。 ─────────────
REM SECRET 要和 NAS 的 .env.nas 裡 OCR_REMOTE_SECRET 一模一樣。
set OCR_SERVICE_SECRET=Plb4JynfLZsGmIHV5h6z9pWr
set INVOICE_ALLOW_LOCAL_OCR=true

REM 一定要用 .venv_ocr_gpu 這個 venv 的 python(裡面才有 paddleocr / paddlepaddle-gpu)。
REM 用完整路徑,不要靠 PATH,免得跑到系統的 python。
"%~dp0.venv_ocr_gpu\Scripts\python.exe" -m uvicorn ocr_service:app --host 0.0.0.0 --port 8090 --app-dir backend

pause
