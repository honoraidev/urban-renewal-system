@echo off
REM Remote OCR service for the NAS to forward invoice scans to. Runs on this GPU box.
REM SECRET must match OCR_REMOTE_SECRET in the NAS .env.nas file.
cd /d "%~dp0"
set OCR_SERVICE_SECRET=Plb4JynfLZsGmIHV5h6z9pWr
set INVOICE_ALLOW_LOCAL_OCR=true
REM PaddleOCR 3.7 on this Windows box hangs on init (PP-LCNet JIT compile); use RapidOCR.
set OCR_ENGINE=rapidocr
"%~dp0.venv_ocr_gpu\Scripts\python.exe" -m uvicorn ocr_service:app --host 0.0.0.0 --port 8091 --app-dir backend
pause
