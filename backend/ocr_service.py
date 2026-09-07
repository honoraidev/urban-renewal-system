"""獨立的 OCR 服務 — 跑在有 GPU / 足夠記憶體的機器上(不是 NAS)。

NAS 上的主後端(main:app)設了 OCR_REMOTE_URL 之後,會把發票影像 POST 到這裡,
本機完全不跑 PaddleOCR。這支服務不碰資料庫、不驗 JWT,只用一組共享密鑰擋外人。

啟動(在 GPU 機器上,專案的 backend/ 目錄):

    set OCR_SERVICE_SECRET=<隨機字串,和 NAS 的 OCR_REMOTE_SECRET 一樣>
    set INVOICE_ALLOW_LOCAL_OCR=true
    uvicorn ocr_service:app --host 0.0.0.0 --port 8090

建議用 Tailscale IP 對外(--host 100.x.x.x),或至少確定 8090 只開在內網 / tailnet。
"""

import io
import os
from contextlib import asynccontextmanager

# 這支服務就是「本機 OCR」的提供者本身,絕不能再往外轉發(否則無限迴圈)。
os.environ["OCR_FORCE_LOCAL"] = "1"

from fastapi import FastAPI, File, Header, HTTPException, UploadFile, status

from utils.invoice_ocr import InvoiceOcrError, extract_invoice_fields

_SECRET = os.environ.get("OCR_SERVICE_SECRET", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 開機就把 OCR 引擎(PaddleOCR / RapidOCR)初始化完 — 這步在有 GPU 的機器上
    # 第一次要 1~3 分鐘。放在啟動時做,之後每個請求才會是秒級,不會卡住 NAS 的逾時。
    try:
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (64, 64), "white").save(buf, format="PNG")
        try:
            extract_invoice_fields(buf.getvalue(), "image/png")
        except InvoiceOcrError:
            pass  # 空白圖必然辨識失敗 — 我們只是要觸發引擎載入
        print("[ocr_service] OCR engine warmed up.", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[ocr_service] warmup skipped: {exc!r}", flush=True)
    yield


app = FastAPI(title="Urban Renewal OCR Service", version="1.0.0", lifespan=lifespan)


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


@app.post("/ocr")
async def ocr_page(
    file: UploadFile = File(...),
    high_accuracy: bool = False,
    x_ocr_secret: str | None = Header(default=None),
):
    """收一張(已 render 成圖的)謄本頁面,用本機 OCR 引擎(GPU 上是 PaddleOCR)回
    純文字 + 平均信心。給 NAS 的 extract_title_deed 逐頁轉發用。"""
    _check(x_ocr_secret)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到影像")
    from starlette.concurrency import run_in_threadpool

    from utils.ocr import _ocr_page_text

    try:
        text, conf = await run_in_threadpool(_ocr_page_text, content, high_accuracy)
        return {"text": text or "", "confidence": conf}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"OCR 失敗:{exc}") from exc
