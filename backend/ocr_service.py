"""獨立的 OCR 服務 — 跑在有 GPU / 足夠記憶體的機器上(不是 NAS)。

NAS 上的主後端(main:app)設了 OCR_REMOTE_URL 之後,會把發票影像 POST 到這裡,
本機完全不跑 PaddleOCR。這支服務不碰資料庫、不驗 JWT,只用一組共享密鑰擋外人。

啟動(在 GPU 機器上,專案的 backend/ 目錄):

    set OCR_SERVICE_SECRET=<隨機字串,和 NAS 的 OCR_REMOTE_SECRET 一樣>
    set INVOICE_ALLOW_LOCAL_OCR=true
    uvicorn ocr_service:app --host 0.0.0.0 --port 8090

建議用 Tailscale IP 對外(--host 100.x.x.x),或至少確定 8090 只開在內網 / tailnet。
"""

import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile, status

from utils.invoice_ocr import InvoiceOcrError, extract_invoice_fields

_SECRET = os.environ.get("OCR_SERVICE_SECRET", "")

app = FastAPI(title="Urban Renewal OCR Service", version="1.0.0")


def _check(secret: str | None) -> None:
    if not _SECRET or secret != _SECRET:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad ocr secret")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/invoice")
async def invoice(
    file: UploadFile = File(...),
    x_ocr_secret: str | None = Header(default=None),
):
    """收發票影像,回傳可帶入支出表單的欄位(QR → PaddleOCR → 規則)。"""
    _check(x_ocr_secret)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到影像")
    try:
        return extract_invoice_fields(content, file.content_type)
    except InvoiceOcrError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
