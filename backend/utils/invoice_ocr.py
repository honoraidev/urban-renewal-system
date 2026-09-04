"""發票照片辨識:把一張發票影像丟給 OpenAI 視覺模型,回傳結構化欄位。
只解析要帶入支出表單的欄位,個資(買方統編等)僅供顯示、不儲存。"""

import base64
import json

import httpx

from config import settings

OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
_TIMEOUT = 60.0

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "invoice_number": {
            "type": ["string", "null"],
            "description": "發票號碼,格式為 2 個大寫英文字母加 8 位數字,例如 AB12345678。找不到填 null。",
        },
        "invoice_date": {
            "type": ["string", "null"],
            "description": "發票開立日期,西元 YYYY-MM-DD。發票上多為民國年,請換算成西元。找不到填 null。",
        },
        "total_amount": {
            "type": ["integer", "null"],
            "description": "含稅總計金額(新臺幣,整數)。就是發票上的『總計』。找不到填 null。",
        },
        "seller_name": {"type": ["string", "null"], "description": "賣方(開立發票的營業人)名稱。找不到填 null。"},
        "seller_tax_id": {"type": ["string", "null"], "description": "賣方統一編號(8 碼)。找不到填 null。"},
    },
    "required": ["invoice_number", "invoice_date", "total_amount", "seller_name", "seller_tax_id"],
}

_PROMPT = (
    "你是台灣發票辨識助手。這是一張發票(可能是電子發票證明聯、收銀機統一發票、二聯式或三聯式)的照片。"
    "請只依照片上實際印出的文字擷取欄位,不要臆測。日期若是民國年請換算西元(民國年+1911)。"
    "金額請取『含稅總計』的數字,去掉逗號與『NT$』等符號,回整數。"
)


class InvoiceOcrError(Exception):
    pass


def _downscale(image_bytes: bytes, max_dim: int = 1600) -> bytes:
    try:
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=82)
        return out.getvalue()
    except Exception:
        return image_bytes


def extract_invoice_fields(image_bytes: bytes) -> dict:
    if not settings.OPENAI_API_KEY:
        raise InvoiceOcrError("尚未設定 OpenAI API 金鑰,無法使用 AI 發票辨識")

    b64 = base64.b64encode(_downscale(image_bytes)).decode("ascii")
    payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0,
        "max_tokens": 500,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
                    },
                ],
            }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "invoice_fields", "strict": True, "schema": _SCHEMA},
        },
    }
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
    try:
        resp = httpx.post(OPENAI_ENDPOINT, headers=headers, json=payload, timeout=_TIMEOUT)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        try:
            detail = exc.response.json().get("error", {}).get("message", detail)
        except ValueError:
            pass
        raise InvoiceOcrError(f"呼叫 OpenAI 失敗:{detail}") from exc
    except httpx.HTTPError as exc:
        raise InvoiceOcrError(f"呼叫 OpenAI 失敗:{exc}") from exc

    choices = resp.json().get("choices") or []
    if not choices:
        raise InvoiceOcrError("OpenAI 未回傳結果")
    text = (choices[0].get("message") or {}).get("content") or ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvoiceOcrError(f"無法解析回傳 JSON:{exc}") from exc

    # 正規化
    num = (parsed.get("invoice_number") or "").strip().upper().replace("-", "")
    date = (parsed.get("invoice_date") or "").strip()
    amount = parsed.get("total_amount")
    if isinstance(amount, str):
        digits = "".join(ch for ch in amount if ch.isdigit())
        amount = int(digits) if digits else None
    return {
        "invoice_number": num or None,
        "invoice_date": date or None,
        "total_amount": amount if isinstance(amount, int) and amount > 0 else None,
        "seller_name": (parsed.get("seller_name") or "").strip() or None,
        "seller_tax_id": (parsed.get("seller_tax_id") or "").strip() or None,
    }
