"""知識庫「AI 問答」用的簡易 LLM 呼叫:HONORAI_URL + HONORAI_API_KEY 都有填就走自家 HonorAI,
否則 OPENAI_API_KEY,再來 GEMINI_API_KEY。

只做純文字對話(不需要結構化輸出),錯誤統一丟 RuntimeError 讓路由層轉成友善訊息。
"""
import json

import httpx

from config import settings

_TIMEOUT = 45.0


def _honorai_on() -> bool:
    return bool(settings.HONORAI_URL and settings.HONORAI_API_KEY)


def available() -> bool:
    return bool(_honorai_on() or settings.OPENAI_API_KEY or settings.GEMINI_API_KEY)


def chat_complete(system: str, messages: list[dict]) -> str:
    """messages: [{"role": "user"|"assistant", "content": str}, ...](最後一筆是使用者這次的提問)"""
    if _honorai_on():
        return _honorai(system, messages)
    if settings.OPENAI_API_KEY:
        return _openai(system, messages)
    if settings.GEMINI_API_KEY:
        return _gemini(system, messages)
    raise RuntimeError("尚未設定 AI 服務(HONORAI_URL / OPENAI_API_KEY / GEMINI_API_KEY)")


def _openai(system: str, messages: list[dict]) -> str:
    model = settings.OPENAI_MODEL or "gpt-4o-mini"
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        "temperature": 0.2,
    }
    try:
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            json=payload,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"AI 服務連線失敗:{exc.__class__.__name__}") from exc
    if r.status_code != 200:
        raise RuntimeError(f"AI 服務回應錯誤({r.status_code})")
    try:
        return (r.json()["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, ValueError) as exc:
        raise RuntimeError("AI 服務回應格式異常") from exc


def _gemini(system: str, messages: list[dict]) -> str:
    model = settings.GEMINI_MODEL or "gemini-2.0-flash"
    contents = [
        {"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]} for m in messages
    ]
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.2},
    }
    try:
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": settings.GEMINI_API_KEY},
            json=payload,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"AI 服務連線失敗:{exc.__class__.__name__}") from exc
    if r.status_code != 200:
        raise RuntimeError(f"AI 服務回應錯誤({r.status_code})")
    try:
        parts = r.json()["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError, ValueError) as exc:
        raise RuntimeError("AI 服務回應格式異常") from exc


def chat_stream(system: str, messages: list[dict]):
    """逐段產出文字(generator)。HonorAI 是真的串流;OpenAI / Gemini 目前整段回來後一次吐出。"""
    if _honorai_on():
        yield from _honorai_events(system, messages)
        return
    yield chat_complete(system, messages)


def _honorai(system: str, messages: list[dict]) -> str:
    return "".join(_honorai_events(system, messages)).strip()


def _honorai_events(system: str, messages: list[dict]):
    """自家 HonorAI:POST /api/chat(Bearer sk-...),回傳 NDJSON 串流 {type: chunk|sources|done|error}。
    它自己會記對話(conversation_id),但我們這邊每次都是獨立提問(上下文自己組進 message),
    所以問完就把那段對話刪掉,不要在它的對話清單裡堆一堆。"""
    base = settings.HONORAI_URL.rstrip("/")
    headers = {"Authorization": f"Bearer {settings.HONORAI_API_KEY}"}
    *history, last = messages
    parts = [system]
    if history:
        parts.append("【先前對話】\n" + "\n".join(("使用者:" if m["role"] == "user" else "助理:") + m["content"] for m in history))
    parts.append("【使用者現在的問題】\n" + last["content"])
    message = "\n\n".join(parts)

    got_chunk = False
    conv_id = None
    try:
        with httpx.stream(
            "POST", f"{base}/api/chat", headers=headers, json={"message": message}, timeout=httpx.Timeout(180.0, connect=15.0)
        ) as r:
            if r.status_code != 200:
                detail = ""
                try:
                    detail = json.loads(r.read().decode("utf-8", "ignore")).get("error", "")
                except Exception:  # noqa: BLE001
                    pass
                raise RuntimeError(f"HonorAI 回應錯誤({r.status_code}){':' + detail if detail else ''}")
            for line in r.iter_lines():
                if not line.strip():
                    continue
                try:
                    evt = json.loads(line)
                except ValueError:
                    continue
                kind = evt.get("type")
                if kind == "chunk":
                    got_chunk = True
                    yield evt.get("text", "")
                elif kind == "done":
                    conv_id = evt.get("conversation_id") or conv_id
                    # 串流途中都沒收到 chunk(對方一次給完整答案)就把 answer 補出去
                    if not got_chunk and evt.get("answer"):
                        yield evt["answer"]
                elif kind == "error":
                    raise RuntimeError(f"HonorAI 目前無法回答:{evt.get('error', '未知錯誤')[:160]}")
    except httpx.HTTPError as exc:
        raise RuntimeError(f"HonorAI 連線失敗:{exc.__class__.__name__}") from exc
    finally:
        if conv_id:
            try:
                httpx.delete(f"{base}/api/conversations/{conv_id}", headers=headers, timeout=10.0)
            except httpx.HTTPError:
                pass
