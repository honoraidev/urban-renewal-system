"""把案件異動推給 company-sso 的 /api/notify（它負責算收件人、發 LINE）。

best-effort：任何錯誤都吞掉，絕不影響本系統的請求。SSO_NOTIFY_ENABLED=false 時完全不動作。
"""
import logging

import httpx

from config import settings

log = logging.getLogger(__name__)

_SYSTEM = "urban_renewal"


def enabled() -> bool:
    return bool(settings.SSO_NOTIFY_ENABLED and settings.SSO_ISSUER and settings.SSO_INTERNAL_API_KEY)


def send(payload: dict) -> None:
    if not enabled():
        return
    try:
        httpx.post(
            f"{settings.SSO_ISSUER.rstrip('/')}/api/notify",
            headers={"X-Api-Key": settings.SSO_INTERNAL_API_KEY},
            json={"system": _SYSTEM, **payload},
            timeout=4,
        )
    except Exception:  # noqa: BLE001
        log.warning("sso_notify 送出失敗（不影響主流程）", exc_info=True)
