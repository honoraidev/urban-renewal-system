import time

import httpx
from fastapi import APIRouter, Depends

from deps import get_current_user
from models.user import User

router = APIRouter(prefix="/weather", tags=["weather"])

# 工作看板問候橫幅的即時天氣。資料來自 Open-Meteo(免金鑰),由後端抓、快取 15 分鐘,
# 瀏覽器只呼叫自己的 API(不用直連外網,NAS 上外網通就行)。
CITIES = {
    "banqiao": {"name": "板橋", "lat": 25.0097, "lon": 121.4627},
    "taipei": {"name": "台北", "lat": 25.0330, "lon": 121.5654},
}
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = 15 * 60

# WMO weather code -> (分類, 中文說明)
def _classify(code: int) -> tuple[str, str]:
    if code == 0:
        return "clear", "晴朗"
    if code in (1, 2):
        return "partly", "多雲時晴"
    if code == 3:
        return "cloudy", "陰天"
    if code in (45, 48):
        return "fog", "有霧"
    if code in (51, 53, 55, 56, 57):
        return "rain", "毛毛雨"
    if code in (61, 63, 65, 66, 67):
        return "rain", "下雨"
    if code in (80, 81, 82):
        return "rain", "短暫陣雨"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow", "下雪"
    if code in (95, 96, 99):
        return "thunder", "雷雨"
    return "cloudy", "多雲"


@router.get("")
def get_weather(city: str = "banqiao", _: User = Depends(get_current_user)):
    c = CITIES.get(city, CITIES["banqiao"])
    key = city if city in CITIES else "banqiao"
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    try:
        r = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": c["lat"],
                "longitude": c["lon"],
                "current": "temperature_2m,weather_code,is_day",
                "daily": "precipitation_probability_max",
                "timezone": "Asia/Taipei",
                "forecast_days": 1,
            },
            timeout=6,
        )
        r.raise_for_status()
        j = r.json()
        cur = j["current"]
        kind, label = _classify(int(cur["weather_code"]))
        prob = (j.get("daily", {}).get("precipitation_probability_max") or [None])[0]
        data = {
            "ok": True,
            "city": c["name"],
            "temp": round(float(cur["temperature_2m"])),
            "kind": kind,
            "label": label,
            "is_day": bool(cur.get("is_day", 1)),
            "rain_prob": prob,
        }
    except Exception as exc:  # 外網不通 / 服務異常:回 ok=False,前端只顯示問候不顯示天氣
        if hit:
            return hit[1]
        return {"ok": False, "error": str(exc)[:120]}
    _CACHE[key] = (now, data)
    return data
