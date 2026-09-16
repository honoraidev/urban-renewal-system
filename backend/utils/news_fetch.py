"""每天自動從 Google 新聞 RSS 搜尋都更/危老相關新聞,寫進「工具與資源 → 新聞」(news_items)。

用 Google 新聞的公開 RSS 搜尋端點(不需要 API key),對幾組都更相關關鍵字各查一次,只留
最近 _MAX_AGE_DAYS 天內、網址還沒存在 news_items 的項目,最多寫入 _MAX_PER_RUN 筆,分類
用標題關鍵字粗略比對 news_items.category 既有的幾個分類。

排程觸發見 main.py 的 lifespan(常駐背景 asyncio task,每天本機時間 9:00 執行一次)。也可以
透過 POST /news/fetch-now(manager 權限)手動立即觸發一次,方便部署後測試不用等到隔天。

只用 requirements.txt 已經有的套件(httpx + 標準庫的 xml.etree),不新增依賴 —— NAS 部署
是 git pull + uvicorn --reload、不 rebuild image,新套件不會自動裝進容器。
"""

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx
from sqlalchemy.orm import Session

from models.news_item import NewsItem
from models.news_sync_state import NewsSyncState

_RSS_URL = "https://news.google.com/rss/search"
_QUERIES = ["都更 OR 都市更新", "危老重建", "老宅延壽", "都更 地主 財務 OR 稅務"]
_MAX_PER_RUN = 5
_MAX_AGE_DAYS = 2
_URL_MAX_LEN = 1000  # 跟 NewsItem.url 的欄位長度一致(見 models/news_item.py)

# 標題關鍵字 -> news_items 既有分類(NEWS_DEFAULT_CATS,見 frontend/js/resources.js),
# 由上到下比對,第一個命中的就用;都沒命中歸「其他」。地主財稅放最前面,不然「都更
# 政策」規則裡的「稅」關鍵字會把地主財務/稅務新聞也吃掉,分類就不夠精確。
_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("地主財稅", ("財務", "分回", "貸款", "資產", "財稅", "找補")),
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


def _extract_source(description_html: str) -> str | None:
    """Google 新聞 RSS 的 <description> 固定格式是
    '<a href="...">標題</a>&nbsp;&nbsp;<font color="...">來源網站</font>',
    整段拿掉標籤存起來只會跟 title 重複、還帶一堆 &nbsp; 雜訊(顯示出來很醜)。
    只挑最後 <font> 裡的來源網站名稱,不留其餘內容。"""
    m = re.search(r"<font[^>]*>(.*?)</font>", description_html or "", re.DOTALL)
    if not m:
        return None
    source = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
    return source or None


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
        title = html.unescape((item.findtext("title") or "").strip())
        # 截斷要在這裡做一次就好,之後去重比對跟真正存進 DB 用的都是同一個(已截斷)值 -
        # 之前在存入時才截斷,比對時卻用截斷前的完整字串,兩篇不同文章只要截斷後前 500
        # 字剛好相同就會比對不到、被當成新資料誤植入重複列。
        link = (item.findtext("link") or "").strip()[:_URL_MAX_LEN]
        if not title or not link:
            continue
        source = _extract_source(item.findtext("description") or "")
        # Google 新聞固定在標題最後加上「 - 來源網站」,跟下面另外顯示的「來源:XXX」
        # 標籤重複,卡片上一次要看兩遍同一個來源名稱。來源名稱已經從 <font> 標籤精準
        # 抓出來了,直接拿來比對、砍掉標題尾端那段,比盲目切最後一個「-」更準。
        if source and title.endswith(f" - {source}"):
            title = title[: -(len(source) + 3)].strip()
        items.append(
            {
                "title": title,
                "link": link,
                "pub_date": _parse_pubdate(item.findtext("pubDate") or ""),
                "description": f"來源:{source}" if source else None,
            }
        )
    return items


def fetch_and_store_news(db: Session) -> list[NewsItem]:
    """抓新聞、過濾、寫入,回傳這次新增的 NewsItem。任一查詢字串失敗只印警告跳過,不中斷
    其他查詢;呼叫端(排程迴圈)另外包一層 try/except,單次執行失敗不影響下次排程。"""
    existing_urls = {u for (u,) in db.query(NewsItem.url).all()}
    # 網址之外多比對標題一次 - Google 新聞的轉址連結偶爾會在不同時間查同一篇文章給出
    # 不同 token,單靠網址去重不夠保險,標題完全相同基本可以認定是同一篇報導。
    existing_names = {n for (n,) in db.query(NewsItem.name).all()}
    cutoff = datetime.now(timezone.utc) - timedelta(days=_MAX_AGE_DAYS)

    candidates: dict[str, dict] = {}
    seen_titles: set[str] = set()
    for q in _QUERIES:
        try:
            for it in _fetch_query(q):
                if it["link"] in existing_urls or it["link"] in candidates:
                    continue
                if it["title"] in existing_names or it["title"] in seen_titles:
                    continue
                if it["pub_date"] and it["pub_date"] < cutoff:
                    continue
                candidates[it["link"]] = it
                seen_titles.add(it["title"])
        except Exception as exc:  # noqa: BLE001
            print(f"[news_fetch] query {q!r} failed (ignored): {exc}", flush=True)

    ordered = sorted(
        candidates.values(),
        key=lambda x: x["pub_date"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:_MAX_PER_RUN]

    created: list[NewsItem] = []
    for it in ordered:
        pub_date = it["pub_date"]
        item = NewsItem(
            category=_guess_category(it["title"]),
            name=it["title"][:255],
            url=it["link"],
            description=(it["description"][:1000] if it["description"] else None),
            published_at=(pub_date.astimezone(timezone.utc).replace(tzinfo=None) if pub_date else None),
        )
        db.add(item)
        created.append(item)

    # 不管這次有沒有抓到新資料都要更新「上次同步時間」- 這代表「最後一次嘗試同步」,
    # 新聞頁面右上角靠這個時間告訴使用者資料多新鮮,不是只有抓到東西才算數。
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    sync_state = db.get(NewsSyncState, 1)
    if sync_state:
        sync_state.last_synced_at = now
    else:
        db.add(NewsSyncState(id=1, last_synced_at=now))

    db.commit()
    for item in created:
        db.refresh(item)
    return created
