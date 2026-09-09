"""發票辨識管線,支援電子發票證明聯 / 統一發票三聯式 / 二聯式:
  ① 先找 QR code(電子發票證明聯左 QR,最準)→ 解碼直接取得發票資訊,invoice_type="electronic"
  ② QR 讀不到(通常是紙本統一發票沒有 QR,或 QR 模糊)→ 再用 RapidOCR 整張辨識文字
  ③ OCR 文字出來後,用規則判斷是三聯式還是二聯式(_classify_invoice_type):
       看到「統一發票」+ 讀到買受人統編 → triplicate 三聯式
       看到「二聯式」或沒有買受人統編    → duplicate 二聯式
       兩者都判斷不出來                  → unknown
回傳可帶入支出表單並存進 expenses 的欄位,含 invoice_type。完全本機執行、零費用。
(GEMINI 那條路預設關閉,見 settings.INVOICE_USE_GEMINI;開啟時一樣只在沒有 QR 才會用到,
且會請 Gemini 一併回傳 invoice_type。)"""

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


def _pdf_all_pages_png(pdf_bytes: bytes, max_pages: int = 30) -> list[bytes]:
    """批次匯入用:掃描機常把好幾張發票掃成一份多頁 PDF,每一頁各當一張影像處理。"""
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        return [
            doc.load_page(i).get_pixmap(matrix=fitz.Matrix(200 / 72, 200 / 72)).tobytes("png")
            for i in range(min(doc.page_count, max_pages))
        ]
    except Exception:
        return []


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


def _try_qr_all(image_bytes: bytes) -> list[dict]:
    """跟 _try_qr 一樣,但一次回傳影像裡讀到的『所有』電子發票 QR —— 一張照片裡拍了
    好幾張電子發票證明聯(或收據上印了好幾張)時,每個 QR 都會變成一筆發票。"""
    out = []
    for s in _decode_qr_strings(image_bytes):
        parsed = _parse_einvoice_left_qr(s.strip())
        if parsed:
            parsed["invoice_type"] = "electronic"
            out.append(parsed)
    return out


def _try_qr(image_bytes: bytes) -> dict | None:
    qrs = _try_qr_all(image_bytes)
    return qrs[0] if qrs else None


# ============================================================ 發票類型分類(③ OCR 之後)

INVOICE_TYPE_LABEL = {
    "electronic": "電子發票",
    "triplicate": "統一發票(三聯式)",
    "duplicate": "統一發票(二聯式)",
    "unknown": "無法判斷",
}


def _classify_invoice_type(text: str, has_buyer_tax_id: bool) -> str:
    """③ OCR 之後用文字內容判斷紙本發票是三聯式還是二聯式(電子發票在有 QR 時
    已於 ① 直接判定,不會走到這裡)。規則:
      - 文字含「二聯式」→ 二聯式
      - 文字含「三聯式」→ 三聯式
      - 文字含「統一發票」但沒有明確聯式字樣 → 看有沒有讀到買受人統編來判斷
        (三聯式一定要開買方統編,二聯式通常不用)
      - 都沒讀到就回 unknown,不強行猜。"""
    flat = text.replace(" ", "").replace("　", "")
    if "二聯式" in flat:
        return "duplicate"
    if "三聯式" in flat:
        return "triplicate"
    if "統一發票" in flat:
        return "triplicate" if has_buyer_tax_id else "duplicate"
    return "unknown"


# ============================================================ ② + ③ RapidOCR + 規則

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
    buyer_tax_id = bm.group(2) if bm else None
    return {
        "invoice_number": invoice_number,
        "invoice_date": _parse_date(text) or _parse_date(flat),
        "total_amount": total,
        "untaxed_amount": untaxed,
        "tax_amount": tax,
        "seller_tax_id": sm.group(2) if sm else None,
        "buyer_tax_id": buyer_tax_id,
        "seller_name": None,
        "source": "ocr",
        "invoice_type": _classify_invoice_type(text, bool(buyer_tax_id)),
    }


def _local_ocr_text(image_bytes: bytes) -> str:
    try:
        from utils.ocr import run_ocr
    except Exception as exc:  # pragma: no cover
        raise InvoiceOcrError(f"OCR 模組載入失敗:{exc}") from exc
    return (run_ocr(image_bytes) or {}).get("text") or ""


# ============================================================ Gemini(預設關閉)

def _downscale_for_upload(image_bytes: bytes, max_edge: int = 1600) -> bytes:
    """縮圖 + 轉正(EXIF)再送 Gemini:單張發票長邊 1600px 已足夠辨識統編/號碼,
    但能把圖片 token 從 ~1500 砍到 ~500、上傳也更快。失敗就原圖照送。"""
    try:
        from PIL import Image, ImageOps

        img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
        img = img.convert("RGB")
        if max(img.size) > max_edge:
            ratio = max_edge / max(img.size)
            img = img.resize((round(img.width * ratio), round(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return image_bytes


def _extract_via_gemini(image_bytes: bytes) -> dict:  # pragma: no cover - opt-in only
    import time

    import httpx

    image_bytes = _downscale_for_upload(image_bytes)

    prompt = (
        "台灣發票照片(此照片沒有可解碼的 QR code,是紙本統一發票或 QR 已模糊)。只依實際印出的文字擷取:"
        "發票號碼、開立日期(民國換西元 YYYY-MM-DD)、未稅金額、營業稅額、含稅總計、賣方統編、買方統編。"
        "讀不到填 null。金額回整數。另外判斷 invoice_type:看到「二聯式」或沒有買方統編填 duplicate;"
        "看到「三聯式」或「統一發票」且有買方統編填 triplicate;都判斷不出來填 unknown。"
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
            "invoice_type": {"type": "string", "enum": ["triplicate", "duplicate", "unknown"]},
        },
        "required": [
            "invoice_number", "invoice_date", "untaxed_amount", "tax_amount",
            "total_amount", "seller_tax_id", "buyer_tax_id", "invoice_type",
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
    parsed["invoice_type"] = parsed.get("invoice_type") or "unknown"
    return parsed


# ============================================================ 進入點

def _extract_single_image(image_bytes: bytes) -> dict:
    """已知這張影像上沒有(或不用管)QR 的情況下,走 Gemini / 本機 OCR + 規則辨識
    一張發票。extract_invoice_fields 跟 extract_invoices_multi 都靠這個做重活。"""
    use_gemini = bool(settings.INVOICE_USE_GEMINI and settings.GEMINI_API_KEY)

    # ② 沒 QR:走 Gemini。
    if use_gemini:
        try:
            result = _extract_via_gemini(image_bytes)
            result.setdefault("untaxed_amount", None)
            result["ocr_text"] = ""
            return result
        except InvoiceOcrError:
            pass  # 落到下面:允許本機 OCR 就退回,否則直接報錯

    # ③ 本機 OCR(RapidOCR / ONNX CPU)+ 規則。可用 INVOICE_ALLOW_LOCAL_OCR=false
    # 完全關掉(此時沒 QR 就直接報錯)。
    if not settings.INVOICE_ALLOW_LOCAL_OCR:
        raise InvoiceOcrError(
            "讀不到發票 QR code。請對準電子發票證明聯上的 QR code 再拍一次,"
            "或掃紙本發票下方的 QR;若沒有 QR,請手動輸入。"
            if not use_gemini
            else "讀不到 QR,Gemini 也暫時無法辨識,請稍後再試或手動輸入。"
        )

    # 手機鏡頭吐出來的原圖常是 1920x1080 以上,整張丟給 RapidOCR 偵測+辨識的時間
    # 跟像素數成正比。發票上的字夠大,縮到長邊 1600px(跟 Gemini 那條路一樣的門檻,
    # 已驗證統編/號碼還讀得到)可以明顯縮短這一步,且不影響下面的規則抽取。
    text = _local_ocr_text(_downscale_for_upload(image_bytes))
    if not text.strip():
        hint = "(Gemini 也讀不到)" if use_gemini else ""
        raise InvoiceOcrError(f"讀不到 QR{hint},OCR 也沒讀到文字。請拍清楚一點、對正、光線充足再試")
    result = _rule_extract(text)
    result["ocr_text"] = text[:4000]
    return result


def extract_invoice_fields(file_bytes: bytes, content_type: str | None = None) -> dict:
    """單張發票(一張照片/一份單頁 PDF = 一張發票)。記錄支出表單裡「掃描發票」用這個。"""
    is_pdf = (content_type or "").lower().endswith("pdf") or file_bytes[:5] == b"%PDF-"
    image_bytes = file_bytes
    if is_pdf:
        png = _pdf_first_page_png(file_bytes)
        if png is None:
            raise InvoiceOcrError("PDF 無法轉圖,請改上傳照片")
        image_bytes = png

    # ① QR(最準、零成本)
    qr = _try_qr(image_bytes)
    if qr:
        qr["ocr_text"] = ""
        return qr

    return _extract_single_image(image_bytes)


def extract_invoices_multi(file_bytes: bytes, content_type: str | None = None) -> list[dict]:
    """批次匯入用:一個檔案可能包含不只一張發票,回傳一張發票一筆:
      - PDF:每一頁各自處理(掃描機常把好幾張發票掃成一份多頁 PDF)。
      - 圖片:先找有沒有多個電子發票 QR(一張照片拍了好幾張證明聯) —— 有就每個
        QR 各算一筆;沒有 QR 才落回原本的單張 OCR/AI 辨識(每張影像最多算一筆;
        沒有 QR 的紙本發票疊在一起拍暫不支援自動切開,請每張分開拍或分開上傳)。
      每筆額外附上 "page"(第幾頁/第幾張,從 1 起算),讀不到的頁面直接跳過、
      不會讓整批失敗;整份都讀不到才丟例外。"""
    is_pdf = (content_type or "").lower().endswith("pdf") or file_bytes[:5] == b"%PDF-"

    def _one_image(image_bytes: bytes, page: int) -> list[dict]:
        qrs = _try_qr_all(image_bytes)
        if qrs:
            for q in qrs:
                q["ocr_text"] = ""
                q["page"] = page
            return qrs
        try:
            single = _extract_single_image(image_bytes)
            single["page"] = page
            return [single]
        except InvoiceOcrError:
            return []

    if is_pdf:
        pages = _pdf_all_pages_png(file_bytes)
        if not pages:
            raise InvoiceOcrError("PDF 無法轉圖,請改上傳照片")
        results = []
        for i, png in enumerate(pages, start=1):
            results.extend(_one_image(png, i))
        if not results:
            raise InvoiceOcrError("這份 PDF 每一頁都讀不到發票內容")
        return results

    results = _one_image(file_bytes, 1)
    if not results:
        raise InvoiceOcrError("讀不到發票內容,請拍清楚一點、對正、光線充足再試")
    return results
