"""全站即時同步用的極簡 in-process pub/sub - 讓「兩個帳號兩個分頁都不用重整就同步」
成立。單一 uvicorn worker(見 backend/Dockerfile,沒有 --workers)所以一個 process 內
的記憶體佇列就夠,不用另外接 Redis 之類的訊息佇列。

設計刻意簡單:只廣播「project X 有異動」這個信號本身,不帶異動內容 - 前端收到後自己
用既有的 API 重新抓一次目前畫面在看的東西(見 frontend/js/live.js)。這樣不用每個
會改資料的端點都自己組一份要推播的內容,新端點也不用額外接線就自動涵蓋在內
(見 main.py ActivityLogMiddleware 統一在這裡呼叫 broadcast)。

Best-effort:所有函式都不能因為佇列滿了或沒人訂閱就出錯 - 通知遺漏了,使用者最多退
回到各頁面原本就有的輪詢(鈴鐺 60 秒、工作看板 30 秒),不是唯一的更新來源。
"""

import asyncio

_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def broadcast(project_id: int | None) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(project_id)
        except asyncio.QueueFull:
            pass  # 這個訂閱者(分頁)積太多沒消化,寧可漏推播也不要卡住廣播端
