"""發票照片辨識,回傳要帶入支出表單的欄位。
優先順序:設了 GEMINI_API_KEY → Google Gemini(有免費額度);否則本機 PaddleOCR + 規則解析。
兩條路都不需付費(Gemini 免費額度內)。"""

import base64
import json
import re

from config import settings


class InvoiceOcrError(Exception):
    pass


# ---------------------------------------------------------------- 規則解析(PaddleOCR)

_NUM_RE = re.compile(r"[A-Z]{2}[-\s]?\d{8}")
_ROC_DATE_RE = re.compile(r"(?<!\d)(\d{2,3})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})")
_ROC_DATE_COMPACT_RE = re.compile(r"(?<!\d)(1\d{2})(\d{2})(\d{2})(?!\d)")
_AD_DATE_RE = re.compile(r"(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})")
_MONEY_RE = re.compile(r"\d{1,3}(?:,\d{3})+|\d+")
_AMOUNT_LABEL_RE = re.compile(r"(總\s*計|總計額|應\s*收|合\s*計|實\s*收|金\s*額)[^\d]{0,6}(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)")
_TAXID_LABEL_RE = re.compile(r"(賣\s*方|統一編號|統編|買\s*方)[^\d]{0,6}(\d{8})")


def _to_int(s):
    digits = re.sub(r"[^\d]", "", s or "")
    return int(digits) if digits else None


def _parse_date(text):
    m = _AD_DATE_RE.search(text)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m = _ROC_DATE_RE.search(text)
    if m:
        ry, mo, d = (int(x) for x in m.groups())
        if 1 <= mo <= 12 and 1 <= d <= 31 and 1 <= ry <= 199:
            return f"{ry + 1911:04d}-{mo:02d}-{d:02d}"
    m = _ROC_DATE_COMPACT_RE.search(text)
    if m:
        ry, mo, d = (int(x) for x in m.groups())
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{ry + 1911:04d}-{mo:02d}-{d:02d}"
    return None


def _parse_amount(text):
    m = _AMOUNT_LABEL_RE.search(text)
    if m:
        v = _to_int(m.group(2))
        if v:
            return v
    best = None
    for token in _MONEY_RE.findall(text):
        if "," in token:
            v = _to_int(token)
            if v and (best is None or v > best):
                best = v
    return best


def _extract_via_paddle(image_bytes: bytes) -> dict:
    try:
        from utils.ocr import run_ocr
    except Exception as exc:  # pragma: no cover
        raise InvoiceOcrError(f"OCR 模組載入失敗:{exc}") from exc

    text = (run_ocr(image_bytes) or {}).get("text") or ""
    if not text.strip():
        raise InvoiceOcrError("OCR 沒有讀到任何文字,請拍清楚一點、對正、光線充足再試")

    flat = text.replace(" ", "").replace("　", "")
    num_m = _NUM_RE.search(text) or _NUM_RE.search(flat)
    tm = _TAXID_LABEL_RE.search(flat)
    return {
        "invoice_number": re.sub(r"[-\s]", "", num_m.group(0)).upper() if num_m else None,
        "invoice_date": _parse_date(text) or _parse_date(flat),
        "total_amount": _parse_amount(text),
        "seller_name": None,
        "seller_tax_id": tm.group(2) if tm else None,
        "provider": "paddleocr",
        "ocr_text": text[:4000],
    }


# ---------------------------------------------------------------- Google Gemini

_GEMINI_PROMPT = (
    "這是一張台灣發票(電子發票證明聯、收銀機統一發票、二聯式或三聯式)的照片。"
    "只依照片上實際印出的文字擷取欄位,不要臆測。日期若是民國年請換算西元(民國年+1911)。"
    "金額取『含稅總計』,去掉逗號與符號回整數。讀不到的欄位回 null。"
)

_GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "invoice_number": {"type": "string", "nullable": True},
        "invoice_date": {"type": "string", "nullable": True},
        "total_amount": {"type": "integer", "nullable": True},
        "seller_name": {"type": "string", "nullable": True},
        "seller_tax_id": {"type": "string", "nullable": True},
    },
    "required": ["invoice_number", "invoice_date", "total_amount", "seller_name", "seller_tax_id"],
}


def _downscale(image_bytes: bytes, max_dim: int = 1600) -> bytes:
    try:
        import io

        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=82)
        return out.getvalue()
    except Exception:
        return image_bytes


def _extract_via_gemini(image_bytes: bytes) -> dict:
    import httpx

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    )
    b64 = base64.b64encode(_downscale(image_bytes)).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": _GEMINI_PROMPT},
                    {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": _GEMINI_SCHEMA,
        },
    }
    import time

    resp = None
    last_detail = ""
    for attempt in range(3):
        try:
            resp = httpx.post(url, json=payload, timeout=60.0)
            if resp.status_code in (429, 500, 503):
                last_detail = f"HTTP {resp.status_code}(服務忙碌)"
                time.sleep(2 * (attempt + 1))
                continue
            resp.raise_for_status()
            break
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            try:
                detail = exc.response.json().get("error", {}).get("message", detail)
            except ValueError:
                pass
            raise InvoiceOcrError(f"呼叫 Gemini 失敗:{detail}") from exc
        except httpx.HTTPError as exc:
            last_detail = str(exc)
            time.sleep(1.5)
    if resp is None or resp.status_code >= 400:
        raise InvoiceOcrError(f"Gemini 暫時無法使用,請稍後再試({last_detail})")

    try:
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise InvoiceOcrError(f"無法解析 Gemini 回傳:{exc}") from exc

    num = (parsed.get("invoice_number") or "").strip().upper().replace("-", "")
    amount = parsed.get("total_amount")
    if isinstance(amount, str):
        amount = _to_int(amount)
    return {
        "invoice_number": num or None,
        "invoice_date": (parsed.get("invoice_date") or "").strip() or None,
        "total_amount": amount if isinstance(amount, int) and amount > 0 else None,
        "seller_name": (parsed.get("seller_name") or "").strip() or None,
        "seller_tax_id": (parsed.get("seller_tax_id") or "").strip() or None,
        "provider": "gemini",
    }


def extract_invoice_fields(image_bytes: bytes) -> dict:
    if settings.GEMINI_API_KEY:
        return _extract_via_gemini(image_bytes)
    return _extract_via_paddle(image_bytes)
