"""線上狀態:有 SSE 連線(登入後前端會連 /events/stream)的使用者 = 目前「已登入」。
單一 uvicorn process,用記憶體計數就夠(同一個人可能開多個分頁,所以是計數)。登出 / 關閉所有分頁後
連線結束就不算線上。LINE 推播(待主管審核)只推給線上的人,離線的等他登入後再推。"""

_online: dict[int, int] = {}


def mark_online(user_id: int) -> None:
    _online[user_id] = _online.get(user_id, 0) + 1


def mark_offline(user_id: int) -> None:
    n = _online.get(user_id, 0) - 1
    if n <= 0:
        _online.pop(user_id, None)
    else:
        _online[user_id] = n


def is_online(user_id: int) -> bool:
    return _online.get(user_id, 0) > 0


def online_ids() -> set[int]:
    return set(_online)
