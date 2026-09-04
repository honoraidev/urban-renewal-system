"""發票辨識管線:① 先試 QR(電子發票證明聯,最準)→ ② 讀不到再 PaddleOCR
→ ③ 規則校正。回傳可帶入支出表單並存進 expenses 的欄位。完全本機執行、零費用。
(GEMINI 那條路預設關閉,見 settings.INVOICE_USE_GEMINI。)"""

import base64
import io
import json
import re

from config import settings


class InvoiceOcrError(Exception):
    pass


# ============================================================ 共用

def _to_int(s):
    digits = re.sub(r"[^\d]", "", str(s or ""))
    return int(digits) if digits else None


def _roc_to_ad(y, m, d):
    y, m, d = int(y), int(m), int(d)
    if y < 1000:
        y += 1911
    if 2000 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31:
        return f"{y:04d}-{m:02d}-{d:02d}"
    return None


def _pdf_first_page_png(pdf_bytes: bytes) -> bytes | None:
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if doc.page_count == 0:
            return None
        pix = doc.load_page(0).get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72))
        return pix.tobytes("png")
    except Exception:
        return None


# ============================================================ ① QR

def _decode_qr_strings(image_bytes: bytes) -> list[str]:
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    arr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        return []
    out: list[str] = []
    det = cv2.QRCodeDetector()
    try:
        ok, infos, points, _ = det.detectAndDecodeMulti(arr)
        if ok:
            out.extend([s for s in infos if s])
    except Exception:
        pass
    if not out:  # 單碼後援
        try:
            s, _pts, _ = det.detectAndDecode(arr)
            if s:
                out.append(s)
        except Exception:
            pass
    return out


def _parse_einvoice_left_qr(s: str) -> dict | None:
    # 左 QR 固定欄位:0-9 號碼 / 10-16 民國日期 / 17-20 隨機碼 /
    # 21-28 銷售額(hex) / 29-36 總計(hex) / 37-44 買方統編 / 45-52 賣方統編
    if not re.match(r"^[A-Z]{2}\d{8}", s or "") or len(s) < 53:
        return None
    date = _roc_to_ad(s[10:13], s[13:15], s[15:17])
    try:
        untaxed = int(s[21:29], 16)
        total = int(s[29:37], 16)
    except ValueError:
        return None
    buyer = s[37:45].strip()
    seller = s[45:53].strip()
    return {
        "invoice_number": s[0:10],
        "invoice_date": date,
        "total_amount": total if total > 0 else None,
        "untaxed_amount": untaxed if untaxed > 0 else None,
        "tax_amount": (total - untaxed) if total and untaxed and total >= untaxed else None,
        "seller_tax_id": seller if seller.isdigit() and len(seller) == 8 else None,
        "buyer_tax_id": buyer if buyer.isdigit() and len(buyer) == 8 else None,
        "seller_name": None,
        "source": "qr",
    }


def _try_qr(image_bytes: bytes) -> dict | None:
    for s in _decode_qr_strings(image_bytes):
        parsed = _parse_einvoice_left_qr(s.strip())
        if parsed:
            return parsed
    return None


# ============================================================ ② + ③ PaddleOCR + 規則

_NUM_RE = re.compile(r"[A-Z]{2}[-\s]?\d{8}")
_ROC_DATE_RE = re.compile(r"(?<!\d)(\d{2,3})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})")
_ROC_DATE_COMPACT_RE = re.compile(r"(?<!\d)(1\d{2})(\d{2})(\d{2})(?!\d)")
_AD_DATE_RE = re.compile(r"(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})")
_MONEY = r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)"
_TOTAL_RE = re.compile(r"(總\s*計|總計額|應\s*收|實\s*收|含稅總額|合\s*計)\D{0,6}" + _MONEY)
_UNTAX_RE = re.compile(r"(銷\s*售\s*額|課稅銷售額|未稅金額|未稅)\D{0,6}" + _MONEY)
_TAX_RE = re.compile(r"(營\s*業\s*稅|稅\s*額)\D{0,6}" + _MONEY)
_SELLER_TAXID_RE = re.compile(r"(賣\s*方|營業人統編|統一編號|統編)\D{0,6}(\d{8})")
_BUYER_TAXID_RE = re.compile(r"(買\s*方|買受人統編)\D{0,6}(\d{8})")
_ANY_MONEY_RE = re.compile(r"\d{1,3}(?:,\d{3})+")


def _parse_date(text):
    m = _AD_DATE_RE.search(text)
    if m:
        return _roc_to_ad(*m.groups())
    m = _ROC_DATE_RE.search(text)
    if m:
        return _roc_to_ad(*m.groups())
    m = _ROC_DATE_COMPACT_RE.search(text)
    if m:
        return _roc_to_ad(*m.groups())
    return None


def _rule_extract(text: str) -> dict:
    flat = text.replace(" ", "").replace("　", "")

    num_m = _NUM_RE.search(text) or _NUM_RE.search(flat)
    invoice_number = re.sub(r"[-\s]", "", num_m.group(0)).upper() if num_m else None

    total = _to_int(_TOTAL_RE.search(text).group(2)) if _TOTAL_RE.search(text) else None
    untaxed = _to_int(_UNTAX_RE.search(text).group(2)) if _UNTAX_RE.search(text) else None
    tax = _to_int(_TAX_RE.search(text).group(2)) if _TAX_RE.search(text) else None

    if total is None:
        cands = sorted({_to_int(x) for x in _ANY_MONEY_RE.findall(text)} - {None})
        if cands:
            total = cands[-1]

    # ③ 規則校正:互補推算(營業稅 5%)
    if total and untaxed is None and tax is None:
        untaxed = round(total / 1.05)
        tax = total - untaxed
    elif total and untaxed and tax is None:
        tax = total - untaxed
    elif untaxed and tax and total is None:
        total = untaxed + tax
    elif total and tax and untaxed is None:
        untaxed = total - tax

    sm = _SELLER_TAXID_RE.search(flat)
    bm = _BUYER_TAXID_RE.search(flat)
    return {
        "invoice_number": invoice_number,
        "invoice_date": _parse_date(text) or _parse_date(flat),
        "total_amount": total,
        "untaxed_amount": untaxed,
        "tax_amount": tax,
        "seller_tax_id": sm.group(2) if sm else None,
        "buyer_tax_id": bm.group(2) if bm else None,
        "seller_name": None,
        "source": "ocr",
    }


def _paddle_text(image_bytes: bytes) -> str:
    try:
        from utils.ocr import run_ocr
    except Exception as exc:  # pragma: no cover
        raise InvoiceOcrError(f"OCR 模組載入失敗:{exc}") from exc
    return (run_ocr(image_bytes) or {}).get("text") or ""


# ============================================================ Gemini(預設關閉)

def _extract_via_gemini(image_bytes: bytes) -> dict:  # pragma: no cover - opt-in only
    import time

    import httpx

    prompt = (
        "台灣發票照片。只依實際印出的文字擷取:發票號碼、開立日期(民國換西元 YYYY-MM-DD)、"
        "未稅金額、營業稅額、含稅總計、賣方統編、買方統編。讀不到填 null。金額回整數。"
    )
    schema = {
        "type": "object",
        "properties": {
            "invoice_number": {"type": "string", "nullable": True},
            "invoice_date": {"type": "string", "nullable": True},
            "untaxed_amount": {"type": "integer", "nullable": True},
            "tax_amount": {"type": "integer", "nullable": True},
            "total_amount": {"type": "integer", "nullable": True},
            "seller_tax_id": {"type": "string", "nullable": True},
            "buyer_tax_id": {"type": "string", "nullable": True},
        },
        "required": [
            "invoice_number", "invoice_date", "untaxed_amount", "tax_amount",
            "total_amount", "seller_tax_id", "buyer_tax_id",
        ],
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    )
    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": schema},
    }
    resp = None
    for attempt in range(3):
        resp = httpx.post(url, json=payload, timeout=60.0)
        if resp.status_code in (429, 500, 503):
            time.sleep(2 * (attempt + 1))
            continue
        break
    if resp is None or resp.status_code >= 400:
        raise InvoiceOcrError("Gemini 暫時無法使用")
    try:
        parsed = json.loads(resp.json()["candidates"][0]["content"]["parts"][0]["text"])
    except Exception as exc:
        raise InvoiceOcrError(f"無法解析 Gemini 回傳:{exc}") from exc
    parsed["invoice_number"] = (parsed.get("invoice_number") or "").upper().replace("-", "") or None
    parsed["source"] = "gemini"
    parsed["seller_name"] = None
    return parsed


# ============================================================ 進入點

def extract_invoice_fields(file_bytes: bytes, content_type: str | None = None) -> dict:
    is_pdf = (content_type or "").lower().endswith("pdf") or file_bytes[:5] == b"%PDF-"
    image_bytes = file_bytes
    if is_pdf:
        png = _pdf_first_page_png(file_bytes)
        if png is None:
            raise InvoiceOcrError("PDF 無法轉圖,請改上傳照片")
        image_bytes = png

    # ① QR
    qr = _try_qr(image_bytes)
    if qr:
        qr["ocr_text"] = ""
        return qr

    # ② OCR
    text = _paddle_text(image_bytes)
    if not text.strip():
        raise InvoiceOcrError("讀不到 QR,OCR 也沒讀到文字。請拍清楚一點、對正、光線充足再試")

    # ③ 校正
    if settings.INVOICE_USE_GEMINI and settings.GEMINI_API_KEY:
        try:
            result = _extract_via_gemini(image_bytes)
            result.setdefault("untaxed_amount", None)
            result["ocr_text"] = text[:4000]
            return result
        except InvoiceOcrError:
            pass  # 退回規則
    result = _rule_extract(text)
    result["ocr_text"] = text[:4000]
    return result
