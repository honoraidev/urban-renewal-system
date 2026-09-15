"""每天自動從 Google 新聞 RSS 搜尋都更/危老相關新聞,寫進「工具與資源 → 新聞」(news_items)。

用 Google 新聞的公開 RSS 搜尋端點(不需要 API key),對幾組都更相關關鍵字各查一次,只留
最近 _MAX_AGE_DAYS 天內、網址還沒存在 news_items 的項目,最多寫入 _MAX_PER_RUN 筆,分類
用標題關鍵字粗略比對 news_items.category 既有的幾個分類。

排程觸發見 main.py 的 lifespan(常駐背景 asyncio task,每天本機時間 9:00 執行一次)。也可以
透過 POST /news/fetch-now(manager 權限)手動立即觸發一次,方便部署後測試不用等到隔天。

只用 requirements.txt 已經有的套件(httpx + 標準庫的 xml.etree),不新增依賴 —— NAS 部署
是 git pull + uvicorn --reload、不 rebuild image,新套件不會自動裝進容器。
"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx
from sqlalchemy.orm import Session

from models.news_item import NewsItem

_RSS_URL = "https://news.google.com/rss/search"
_QUERIES = ["都更 OR 都市更新", "危老重建", "老宅延壽"]
_MAX_PER_RUN = 5
_MAX_AGE_DAYS = 2

# 標題關鍵字 -> news_items 既有分類(NEWS_DEFAULT_CATS,見 frontend/js/resources.js),
# 由上到下比對,第一個命中的就用;都沒命中歸「其他」。
_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("法規異動", ("修法", "條例", "法案", "立法院", "草案", "子法")),
    ("都更政策", ("補助", "政策", "內政部", "獎勵", "容積", "減稅", "稅")),
    ("市場動態", ("博覽會", "投資", "產業", "市場", "報告", "展", "房價", "行情")),
    ("案件報導", ("都更會", "更新會", "基地", "動土", "都更案", "危老案", "整合")),
]


def _guess_category(title: str) -> str:
    for cat, keywords in _CATEGORY_RULES:
        if any(k in title for k in keywords):
            return cat
    return "其他"


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _parse_pubdate(text: str) -> datetime | None:
    try:
        dt = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if dt is not None and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _fetch_query(query: str) -> list[dict]:
    resp = httpx.get(
        _RSS_URL,
        params={"q": query, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"},
        timeout=15,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        items.append(
            {
                "title": title,
                "link": link,
                "pub_date": _parse_pubdate(item.findtext("pubDate") or ""),
                "description": _strip_html(item.findtext("description") or ""),
            }
        )
    return items


def fetch_and_store_news(db: Session) -> list[NewsItem]:
    """抓新聞、過濾、寫入,回傳這次新增的 NewsItem。任一查詢字串失敗只印警告跳過,不中斷
    其他查詢;呼叫端(排程迴圈)另外包一層 try/except,單次執行失敗不影響下次排程。"""
    existing_urls = {u for (u,) in db.query(NewsItem.url).all()}
    cutoff = datetime.now(timezone.utc) - timedelta(days=_MAX_AGE_DAYS)

    candidates: dict[str, dict] = {}
    for q in _QUERIES:
        try:
            for it in _fetch_query(q):
                if it["link"] in existing_urls or it["link"] in candidates:
                    continue
                if it["pub_date"] and it["pub_date"] < cutoff:
                    continue
                candidates[it["link"]] = it
        except Exception as exc:  # noqa: BLE001
            print(f"[news_fetch] query {q!r} failed (ignored): {exc}", flush=True)

    ordered = sorted(
        candidates.values(),
        key=lambda x: x["pub_date"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:_MAX_PER_RUN]

    created: list[NewsItem] = []
    for it in ordered:
        item = NewsItem(
            category=_guess_category(it["title"]),
            name=it["title"][:255],
            url=it["link"][:500],
            description=(it["description"][:1000] or None),
        )
        db.add(item)
        created.append(item)
    if created:
        db.commit()
        for item in created:
            db.refresh(item)
    return created
