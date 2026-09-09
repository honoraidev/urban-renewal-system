"""獨立的 OCR 服務 — 跑在有 GPU / 足夠記憶體的機器上(不是 NAS)。

NAS 上的主後端(main:app)設了 OCR_REMOTE_URL / OCR_TEXT_PROVIDER=remote 之後,
會把影像 POST 到這裡,NAS 本機不跑 OCR。這支服務不碰資料庫、不驗 JWT,只用一組
共享密鑰擋外人。OCR 引擎:RapidOCR(ONNX,有 onnxruntime-gpu 就走 GPU)。

啟動(在 GPU 機器上,專案的 backend/ 目錄):

    set OCR_SERVICE_SECRET=<隨機字串,和 NAS 的 OCR_REMOTE_SECRET 一樣>
    set INVOICE_ALLOW_LOCAL_OCR=true
    uvicorn ocr_service:app --host 0.0.0.0 --port 8091

建議用 Tailscale IP 對外(--host 100.x.x.x),或至少確定 8091 只開在內網 / tailnet。
(port 選 8091 是因為 8090 這台機器上被本機 docker-compose 的 nginx 佔用,見
 docker-compose.yml 的 "8090:80" — 兩個服務都想用 8090 會互踩。)
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
    # 開機就把 RapidOCR 引擎初始化完。第一次很慢(GPU 上 onnxruntime 要建 + 快取
    # TensorRT engine,可能 2~4 分鐘),放在啟動時做,之後每頁 ~1 秒,不會卡住 NAS 逾時。
    try:
        import time as _t

        from PIL import Image

        from utils.ocr import _ocr_page_text

        buf = io.BytesIO()
        Image.new("RGB", (48, 320), "white").save(buf, format="PNG")
        _w0 = _t.time()
        _ocr_page_text(buf.getvalue())  # 觸發 RapidOCR / CUDA / TRT 建置
        print(f"[ocr_service] OCR engine warmed up in {_t.time() - _w0:.0f}s.", flush=True)
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
    """收發票影像,回傳可帶入支出表單的欄位(QR → RapidOCR → 規則)。"""
    _check(x_ocr_secret)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到影像")
    from starlette.concurrency import run_in_threadpool

    try:
        # extract_invoice_fields 是同步阻塞運算(OCR),別佔住 event loop,不然多人同
        # 時掃描時,QR 秒解那個人也要排隊等前一個 OCR 跑完。
        return await run_in_threadpool(extract_invoice_fields, content, file.content_type)
    except InvoiceOcrError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@app.post("/ocr")
async def ocr_page(
    file: UploadFile = File(...),
    high_accuracy: bool = False,
    x_ocr_secret: str | None = Header(default=None),
):
    """收一張(已 render 成圖的)謄本頁面,用本機 OCR 引擎(RapidOCR)回
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
