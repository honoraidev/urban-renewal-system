"""土增稅「本月申報移轉現值」自動查詢 - 只支援臺北市案件。

背景:內政部/各縣市地政局都沒有公開、能穩定程式化查詢的「公告土地現值」API - 內政部
網站只是導覽頁,實際查詢要跳到各縣市各自的系統;臺北市的「臺北地政雲」又是地圖式互動
應用,不是簡單表單,沒辦法穩定送參數拿到結果(介面隨時可能改版,還有被擋 IP 的風險)。

唯一能穩定拿到資料的管道,是臺北市政府在「政府資料開放平臺」公開的年度 CSV 開放資料集
(https://data.gov.tw/dataset/122058,實際檔案由 data.taipei 提供下載):每年公告一次,
含全市每筆地號的公告土地現值/公告地價,採開放政府資料授權條款,本來就是設計給程式化
存取用的,不是爬別人不想被爬的頁面。

做法:整包下載當年度 CSV(約20MB、40萬筆),用「縣市/行政區/段小段/地號」建索引查表,
下載一次後快取在記憶體(24小時內重複查詢不用再下載),之後的查詢都是本地查表。只做
臺北市 - 其他縣市各自有各自的查詢系統、沒有統一的開放資料集,之後有需要再個別擴充。
"""

from __future__ import annotations

import csv
import io
import re
import threading
from datetime import datetime, timedelta, timezone

import httpx

_DATASET_API = "https://data.gov.tw/api/v2/rest/dataset/122058"
_CACHE_TTL = timedelta(hours=24)

_lock = threading.Lock()
_cache: dict[tuple[str, str, str], float] | None = None
_cache_period_label: str | None = None
_cache_loaded_at: datetime | None = None


def _fetch_resource_url(roc_year: int) -> str | None:
    resp = httpx.get(_DATASET_API, timeout=20)
    resp.raise_for_status()
    distros = resp.json()["result"]["distribution"]
    needle = f"{roc_year}年"
    for d in distros:
        if needle in (d.get("resourceDescription") or ""):
            return d.get("resourceDownloadUrl")
    return None


def _normalize_parcel(parcel_number: str) -> str:
    """把我們系統的地號格式(如「0301-0002」)轉成開放資料的 8 碼無分隔格式(「03010002」)。"""
    digits = re.sub(r"\D", "", parcel_number or "")
    return digits.zfill(8)[:8]


def _load_cache_locked() -> tuple[dict[tuple[str, str, str], float], str]:
    global _cache, _cache_period_label, _cache_loaded_at

    this_roc_year = datetime.now().year - 1911
    resource_url = None
    period_label = None
    # 公告現值每年約1月生效,但開放資料上架可能會晚幾天 - 找不到今年的就退回去年,
    # 不要整個查詢功能開天窗。
    for candidate in (this_roc_year, this_roc_year - 1):
        resource_url = _fetch_resource_url(candidate)
        if resource_url:
            period_label = f"{candidate}年"
            break
    if not resource_url:
        raise RuntimeError("在政府資料開放平臺找不到臺北市公告土地現值資料集")

    resp = httpx.get(resource_url, timeout=60)
    resp.raise_for_status()
    text = resp.content.decode("big5", errors="ignore")
    reader = csv.reader(io.StringIO(text))
    next(reader, None)  # 跳過表頭

    lookup: dict[tuple[str, str, str], float] = {}
    for row in reader:
        if len(row) < 5:
            continue
        _county, district, section_subsection, parcel, unit_price = row[:5]
        try:
            price = float(unit_price)
        except ValueError:
            continue
        key = (district.strip(), section_subsection.strip(), _normalize_parcel(parcel))
        lookup[key] = price

    _cache, _cache_period_label, _cache_loaded_at = lookup, period_label, datetime.now(timezone.utc)
    return lookup, period_label


def _load_cache() -> tuple[dict[tuple[str, str, str], float], str]:
    with _lock:
        now = datetime.now(timezone.utc)
        if _cache is not None and _cache_loaded_at and now - _cache_loaded_at < _CACHE_TTL:
            return _cache, _cache_period_label
        return _load_cache_locked()


def lookup_current_value_per_sqm(
    district: str | None, section: str | None, subsection: str | None, parcel_number: str | None
) -> tuple[float, str] | None:
    """回傳 (公告土地現值,單位元/平方公尺, 年期標籤如「115年」);查無這筆地號回傳 None。"""
    lookup, period_label = _load_cache()
    key = (
        (district or "").strip(),
        f"{(section or '').strip()}{(subsection or '').strip()}",
        _normalize_parcel(parcel_number),
    )
    price = lookup.get(key)
    if price is None:
        return None
    return price, period_label
