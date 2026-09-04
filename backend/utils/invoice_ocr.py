"""發票照片辨識:用本機 PaddleOCR 讀出文字,再以規則解析出要帶入支出表單的欄位。
完全在本機執行,不呼叫任何外部 AI 服務、不計費。"""

import re


class InvoiceOcrError(Exception):
    pass


_NUM_RE = re.compile(r"[A-Z]{2}[-\s]?\d{8}")
# 民國日期:114年09月04日 / 114-09-04 / 114/9/4 / 1140904
_ROC_DATE_RE = re.compile(r"(?<!\d)(\d{2,3})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})")
_ROC_DATE_COMPACT_RE = re.compile(r"(?<!\d)(1\d{2})(\d{2})(\d{2})(?!\d)")
_AD_DATE_RE = re.compile(r"(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})")
_MONEY_RE = re.compile(r"\d{1,3}(?:,\d{3})+|\d+")
_AMOUNT_LABEL_RE = re.compile(r"(總\s*計|總計額|應\s*收|合\s*計|實\s*收|金\s*額)[^\d]{0,6}(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+)")
_TAXID_LABEL_RE = re.compile(r"(賣\s*方|統一編號|統編|買\s*方)[^\d]{0,6}(\d{8})")


def _to_int(s: str):
    digits = re.sub(r"[^\d]", "", s or "")
    return int(digits) if digits else None


def _parse_date(text: str) -> str | None:
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


def _parse_amount(text: str):
    m = _AMOUNT_LABEL_RE.search(text)
    if m:
        v = _to_int(m.group(2))
        if v:
            return v
    # 後援:整份文字裡最大的「有千分位逗號」數字,通常就是總計
    best = None
    for token in _MONEY_RE.findall(text):
        if "," in token:
            v = _to_int(token)
            if v and (best is None or v > best):
                best = v
    return best


def extract_invoice_fields(image_bytes: bytes) -> dict:
    try:
        from utils.ocr import run_ocr
    except Exception as exc:  # pragma: no cover
        raise InvoiceOcrError(f"OCR 模組載入失敗:{exc}") from exc

    text = (run_ocr(image_bytes) or {}).get("text") or ""
    if not text.strip():
        raise InvoiceOcrError("OCR 沒有讀到任何文字,請拍清楚一點、對正、光線充足再試")

    flat = text.replace(" ", "").replace("　", "")

    num_m = _NUM_RE.search(text) or _NUM_RE.search(flat)
    invoice_number = re.sub(r"[-\s]", "", num_m.group(0)).upper() if num_m else None

    tax_id = None
    tm = _TAXID_LABEL_RE.search(flat)
    if tm:
        tax_id = tm.group(2)

    return {
        "invoice_number": invoice_number,
        "invoice_date": _parse_date(text) or _parse_date(flat),
        "total_amount": _parse_amount(text),
        "seller_name": None,
        "seller_tax_id": tax_id,
        "ocr_text": text[:4000],
    }
