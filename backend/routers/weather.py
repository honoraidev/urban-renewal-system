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


def _place_name(lat: float, lon: float) -> str:
    """經緯度 → 地名(例如「板橋區」),用 BigDataCloud 免金鑰反向地理編碼;失敗就叫「目前位置」。"""
    try:
        r = httpx.get(
            "https://api.bigdatacloud.net/data/reverse-geocode-client",
            params={"latitude": lat, "longitude": lon, "localityLanguage": "zh"},
            timeout=5,
        )
        j = r.json()
        return (j.get("locality") or j.get("city") or j.get("principalSubdivision") or "目前位置")[:12]
    except Exception:
        return "目前位置"


@router.get("")
def get_weather(
    city: str = "banqiao",
    lat: float | None = None,
    lon: float | None = None,
    _: User = Depends(get_current_user),
):
    """lat/lon 有帶(瀏覽器定位到登入裝置的位置)就用該位置,否則用預設城市(板橋)。"""
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        lat, lon = round(lat, 2), round(lon, 2)  # 約 1km 格,也讓快取能共用
        key = f"{lat},{lon}"
        c = {"name": None, "lat": lat, "lon": lon}
    else:
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
            "city": c["name"] or _place_name(c["lat"], c["lon"]),
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
    if len(_CACHE) > 300:  # 避免不同位置無限累積
        for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[:100]:
            _CACHE.pop(k, None)
    return data
