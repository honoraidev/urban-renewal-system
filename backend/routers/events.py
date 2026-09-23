import asyncio
import json

import jwt
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from database import SessionLocal
from models.user import User
from security import decode_access_token
from utils.live_events import subscribe, unsubscribe

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/stream")
async def stream_events(token: str = Query(...)):
    """全站即時同步用的 SSE 推播(見 utils/live_events.py)。EventSource 瀏覽器 API
    沒辦法自訂 Authorization header,認證只能靠 query string 帶 token,驗證邏輯跟其他
    端點的 Bearer token 完全一樣,只是換個地方拿。"""
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return StreamingResponse(iter(()), status_code=401)

    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            return StreamingResponse(iter(()), status_code=401)

    async def event_stream():
        q = subscribe()
        try:
            while True:
                try:
                    project_id = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps({'project_id': project_id})}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # 保持連線,避免中間的 proxy 因為太久沒資料就斷開
        finally:
            unsubscribe(q)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 告訴 nginx 不要緩衝這個回應,不然事件會延遲到緩衝區滿才送達
            "Connection": "keep-alive",
        },
    )
