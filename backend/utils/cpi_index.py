"""土增稅「物價指數調整比例」自動查詢 - 全國通用,不分縣市。

背景:土地增值稅漲價總數額 = 申報現值 − 前次移轉現值(或原規定地價)× 消費者物價總指數
調整比例。這個調整比例過去只能靠承辦人自己查國稅局/地方稅務局公告的「分算表」手動輸入,
但行政院主計總處本來就有直接公告一份「已經算好」的官方換算矩陣:

    民國OOO年OO月 以各年月為基期之消費者物價總指數－稅務專用
    https://www.stat.gov.tw/cp.aspx?n=2665
    下載檔:https://ws.dgbas.gov.tw/001/Upload/463/relfile/10315/2686/cpispleym.xls

這份表逐月更新、涵蓋民國48年至今,內容是「以某年某月為基期100時,最新公告月份的指數是
多少」的矩陣 - 這剛好就是 ltt_cpi_index 欄位要的數字,不用自己拿原始CPI去換算比例。全國
地政/稅務機關(臺北市地政局、桃園市地政等)公告的查詢方式也都是直接連到這同一份官方檔案,
不是各縣市各自一套,所以不分縣市都能用。

限制:這份表只到「目前最新公告的月份」為止(通常是上個月),所以只適用於「本次移轉」是
現在/最近的情況 - 跟系統目前土增稅試算本來就是抓當期公告土地現值去算「現在申報」的情境
一致。檔案只有 .xls(舊版 BIFF 格式)沒有 CSV/API,用 xlrd 解析。
"""

from __future__ import annotations

import logging
import os
import re
import threading
from datetime import datetime, timedelta, timezone

import httpx
import xlrd

from config import settings

logger = logging.getLogger(__name__)

_XLS_URL = "https://ws.dgbas.gov.tw/001/Upload/463/relfile/10315/2686/cpispleym.xls"
_CACHE_TTL = timedelta(hours=24)
# 最近一次成功下載的原始檔落地一份 - 主計總處連不上/憑證鏈驗證失敗時還能用舊檔算(這份表逐月才更新
# 一次,上個月的檔案拿來算前次移轉現值的物價調整,誤差可以忽略),超過 60 天才當作太舊不用。
_DISK_CACHE_MAX_AGE = timedelta(days=60)

_lock = threading.Lock()
_cache: dict[tuple[int, int | None], float] | None = None
_cache_asof_label: str | None = None
_cache_loaded_at: datetime | None = None


def _disk_cache_path() -> str:
    return os.path.join(settings.UPLOAD_DIR, "cpispleym_cache.xls")


def _download_xls() -> bytes:
    """下載官方 xls。ws.dgbas.gov.tw 的憑證鏈不完整(伺服器沒附中繼憑證,瀏覽器/Windows 會靠 AIA
    自己補抓所以看起來正常,但 Python certifi 驗不過 -> CERTIFICATE_VERIFY_FAILED),NAS 上就
    因此一直查不到、物價指數永遠當 100%。先照正常驗證,SSL 驗證失敗才退回不驗證(公開統計檔、
    唯讀、不帶任何憑證資料,且下載後 xlrd 還會檢查表頭格式,風險可接受)。"""
    try:
        resp = httpx.get(_XLS_URL, timeout=30)
    except httpx.ConnectError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        logger.warning("cpi_index: ws.dgbas.gov.tw SSL chain verify failed, retry without verification")
        resp = httpx.get(_XLS_URL, timeout=30, verify=False)
    resp.raise_for_status()
    return resp.content


def _read_xls_bytes() -> bytes:
    try:
        content = _download_xls()
    except Exception:
        path = _disk_cache_path()
        if os.path.exists(path) and datetime.now() - datetime.fromtimestamp(os.path.getmtime(path)) < _DISK_CACHE_MAX_AGE:
            logger.warning("cpi_index: download failed, using on-disk cache %s", path)
            with open(path, "rb") as f:
                return f.read()
        raise
    try:
        os.makedirs(os.path.dirname(_disk_cache_path()), exist_ok=True)
        with open(_disk_cache_path(), "wb") as f:
            f.write(content)
    except OSError:
        pass
    return content


def _load_cache_locked() -> tuple[dict[tuple[int, int | None], float], str]:
    global _cache, _cache_asof_label, _cache_loaded_at

    wb = xlrd.open_workbook(file_contents=_read_xls_bytes())
    sheet = wb.sheet_by_index(0)

    # 第一列標題是「民國OOO年OO月 以各年月為基期之消費者物價總指數－稅務專用」,取出
    # 「OOO年OO月」當作這份表的「最新公告月份」標籤(=每一個換算比例對應到的目標月份)。
    title = str(sheet.cell_value(0, 0))
    m = re.search(r"民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月", title)
    asof_label = f"{m.group(1)}年{m.group(2)}月" if m else "最新月份"

    lookup: dict[tuple[int, int | None], float] = {}
    for row in range(sheet.nrows):
        year_cell = sheet.cell_value(row, 0)
        if not isinstance(year_cell, (int, float)):
            continue
        year = int(year_cell)
        # 欄位順序固定:年、1月...12月、累計平均(共14欄)。
        for month in range(1, 13):
            col = month
            if col >= sheet.ncols:
                break
            value = sheet.cell_value(row, col)
            if isinstance(value, (int, float)) and value > 0:
                lookup[(year, month)] = float(value)
        if sheet.ncols > 13:
            avg = sheet.cell_value(row, 13)
            if isinstance(avg, (int, float)) and avg > 0:
                lookup[(year, None)] = float(avg)

    _cache, _cache_asof_label, _cache_loaded_at = lookup, asof_label, datetime.now(timezone.utc)
    return lookup, asof_label


def _load_cache() -> tuple[dict[tuple[int, int | None], float], str]:
    with _lock:
        now = datetime.now(timezone.utc)
        if _cache is not None and _cache_loaded_at and now - _cache_loaded_at < _CACHE_TTL:
            return _cache, _cache_asof_label
        return _load_cache_locked()


def parse_minguo_period(text: str | None) -> tuple[int, int | None] | None:
    """解析「79年06月」「115年」這類民國年月字串,回傳 (年, 月或None)。"""
    if not text:
        return None
    m = re.search(r"(\d{1,3})\s*年(?:\s*(\d{1,2})\s*月)?", str(text))
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2)) if m.group(2) else None
    return year, month


def lookup_cpi_ratio(original_period: str | None) -> tuple[float, str] | None:
    """回傳 (物價指數調整比例, 對應的最新公告月份標籤);解析不出年月或查無資料回傳 None。

    月份查得到就用月份的精確值,查不到(例如只有年份、或該年月超出表格範圍)就退回該年度
    的「累計平均」欄位當近似值。
    """
    parsed = parse_minguo_period(original_period)
    if parsed is None:
        return None
    year, month = parsed
    lookup, asof_label = _load_cache()
    if month is not None and (year, month) in lookup:
        return lookup[(year, month)], asof_label
    if (year, None) in lookup:
        return lookup[(year, None)], asof_label
    return None
