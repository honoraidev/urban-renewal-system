"""每天自動搜尋都更/危老相關新聞,寫進「工具與資源 → 新聞」(news_items)。

主要來源是 Bing 新聞的公開 RSS 搜尋端點(不需要 API key):每則新聞都附「原文真實網址、
摘要、來源網站、縮圖」,新聞頁的縮圖跟摘要就是從這裡來的。Bing 抓不到(連線失敗/沒結果)
才退回 Google 新聞 RSS —— Google 只給標題跟來源,轉址連結也沒辦法直接取圖,那種項目就沒有
縮圖跟摘要(前端會用色塊代替)。對幾組都更相關關鍵字各查一次,只留最近 _MAX_AGE_DAYS 天內、
網址/標題還沒存在 news_items 的項目;每組關鍵字各自最多選 _MAX_PER_QUERY 筆(不是全部混在
一起比日期取全域前幾筆,不然新聞量大的關鍵字會把量少的擠光),分類用標題關鍵字粗略比對
news_items.category 既有的幾個分類。

另外 enrich_news_items() 會幫「以前抓的、還沒有縮圖/摘要」的舊項目補資料(用標題回 Bing 搜尋比對,
比對不到再試著直接讀原文網頁的 og:image / og:description)。每次抓新聞時順便跑一輪。

排程觸發見 main.py 的 lifespan(常駐背景 asyncio task,每天本機時間 9:00 執行一次)。也可以
透過 POST /news/fetch-now(manager 權限)手動立即觸發一次,方便部署後測試不用等到隔天。

只用 requirements.txt 已經有的套件(httpx + 標準庫的 xml.etree),不新增依賴 —— NAS 部署
是 git pull + 重啟 api 容器、不 rebuild image,新套件不會自動裝進容器。
"""

import difflib
import html
import ipaddress
import re
import socket
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx
from sqlalchemy.orm import Session

from models.news_item import NewsItem
from models.news_sync_state import NewsSyncState

_RSS_URL = "https://news.google.com/rss/search"
_BING_RSS_URL = "https://www.bing.com/news/search"
_QUERIES = ["都更 OR 都市更新", "危老重建", "老宅延壽", "都更 地主 財務 OR 稅務"]
_MAX_PER_QUERY = 2  # 每組關鍵字各自最多選這麼多筆,保證每個主題都有機會露出
_MAX_AGE_DAYS = 2
_URL_MAX_LEN = 1000  # 跟 NewsItem.url 的欄位長度一致(見 models/news_item.py)
_SUMMARY_MAX_LEN = 400
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
# 縮圖尺寸(新聞頁縮圖最大顯示約 250x150,抓 2 倍給高解析螢幕)
_THUMB_W, _THUMB_H = 560, 336

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


def _clean_summary(text: str | None) -> str | None:
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text or ""))).strip()
    if not text:
        return None
    return text if len(text) <= _SUMMARY_MAX_LEN else text[: _SUMMARY_MAX_LEN - 1].rstrip() + "…"


def _child_text(item: ET.Element, local_name: str) -> str:
    """Bing RSS 的自訂欄位(News:Source / News:Image)命名空間網址裡帶著查詢字串、每次都不一樣,
    只比對標籤最後 } 後面的名稱。"""
    for child in item:
        if child.tag.rsplit("}", 1)[-1] == local_name:
            return (child.text or "").strip()
    return ""


def _bing_thumb(url: str) -> str | None:
    """Bing 給的縮圖網址是 http://www.bing.com/th?id=...&pid=News,尺寸要自己帶(RSS 的
    ImageSize 欄位寫的範本是 w={0}&h={1}&c=14,c=14 = 裁切成指定比例)。"""
    if not url:
        return None
    url = re.sub(r"^http://", "https://", url)
    return f"{url}{'&' if '?' in url else '?'}w={_THUMB_W}&h={_THUMB_H}&c=14"


def _fetch_query_bing(query: str) -> list[dict]:
    # Bing RSS 不支援 Google 那種「A OR B」語法(整串當成一個搜尋詞,會搜不到東西),
    # 拆成各自查一次再合併去重。
    if " OR " in query:
        merged: list[dict] = []
        seen: set[str] = set()
        for part in (p.strip() for p in query.split(" OR ")):
            for it in _fetch_query_bing(part):
                if it["link"] not in seen:
                    seen.add(it["link"])
                    merged.append(it)
        return merged
    resp = httpx.get(
        _BING_RSS_URL,
        params={"q": query, "format": "rss", "cc": "TW", "setlang": "zh-Hant"},
        timeout=15,
        headers=_UA,
        follow_redirects=True,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    items = []
    for item in root.findall(".//item"):
        title = html.unescape((item.findtext("title") or "").strip())
        # <link> 是 bing.com/news/apiclick.aspx?...&url=<原文網址>,取出真正的原文網址
        raw_link = (item.findtext("link") or "").strip()
        real = parse_qs(urlparse(raw_link).query).get("url")
        link = unquote(real[0]) if real else raw_link
        link = link.strip()[:_URL_MAX_LEN]
        if not title or not link:
            continue
        source = _child_text(item, "Source")
        items.append(
            {
                "title": title,
                "link": link,
                "pub_date": _parse_pubdate(item.findtext("pubDate") or ""),
                "description": f"來源:{source}" if source else None,
                "summary": _clean_summary(item.findtext("description")),
                "image_url": _bing_thumb(_child_text(item, "Image")),
            }
        )
    return items


def _fetch_query_google(query: str) -> list[dict]:
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
                "summary": None,
                "image_url": None,
            }
        )
    return items


def _fetch_query(query: str) -> list[dict]:
    try:
        items = _fetch_query_bing(query)
        if items:
            return items
        print(f"[news_fetch] bing returned nothing for {query!r}, falling back to google", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[news_fetch] bing query {query!r} failed, falling back to google: {exc}", flush=True)
    return _fetch_query_google(query)


# ---------------------------------------------------------------- 補舊資料 / 手動連結的縮圖與摘要

def _is_public_http_url(url: str) -> bool:
    """只允許連到公開網路 —— 手動新增連結時後端會去讀該網址的網頁,不能讓它被拿來探測
    內網/本機服務(SSRF)。"""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        for info in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except (OSError, ValueError):
        return False


def _meta_content(page: str, prop: str) -> str | None:
    for pattern in (
        rf'<meta[^>]+(?:property|name)\s*=\s*["\']{prop}["\'][^>]*?content\s*=\s*["\']([^"\']*)["\']',
        rf'<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]*?(?:property|name)\s*=\s*["\']{prop}["\']',
    ):
        m = re.search(pattern, page, re.IGNORECASE)
        if m and m.group(1).strip():
            return html.unescape(m.group(1).strip())
    return None


def fetch_page_meta(url: str) -> dict:
    """讀原文網頁,取 og:image / og:description(沒有就退回 <meta name=description>)。
    失敗一律回空 dict,呼叫端不需要處理例外。Google 新聞的轉址連結讀不到真正的網頁,
    直接略過。"""
    try:
        if "news.google.com" in (urlparse(url).hostname or ""):
            return {}
        current = url
        resp = None
        for _ in range(4):  # 手動跟轉址,每一跳都重新檢查是不是公開網址
            if not _is_public_http_url(current):
                return {}
            resp = httpx.get(current, timeout=8, headers=_UA, follow_redirects=False)
            if resp.is_redirect and resp.headers.get("location"):
                current = urljoin(current, resp.headers["location"])
                continue
            break
        if resp is None or resp.status_code != 200 or "html" not in resp.headers.get("content-type", "").lower():
            return {}
        page = resp.text[:400_000]
        image = _meta_content(page, "og:image") or _meta_content(page, "twitter:image")
        summary = _meta_content(page, "og:description") or _meta_content(page, "description")
        return {
            "image_url": urljoin(current, image)[:_URL_MAX_LEN] if image else None,
            "summary": _clean_summary(summary),
        }
    except Exception:  # noqa: BLE001
        return {}


def _norm_title(t: str) -> str:
    return re.sub(r"[\s\-—–:：!！?？「」『』\"'’‘,，。、\(\)（）]", "", t or "")


def _match_bing(item_name: str) -> dict | None:
    """用標題回 Bing 新聞搜尋,找同一篇報導(標題相同或非常相近)。"""
    try:
        results = _fetch_query_bing(item_name)
    except Exception:  # noqa: BLE001
        return None
    want = _norm_title(item_name)
    best, best_score = None, 0.0
    for r in results:
        got = _norm_title(r["title"])
        score = 1.0 if got == want else difflib.SequenceMatcher(None, want, got).ratio()
        if score > best_score:
            best, best_score = r, score
    return best if best and best_score >= 0.85 else None


def _enrich_one(item_id: int, name: str, url: str) -> tuple[int, dict]:
    found = _match_bing(name)
    if found and (found["summary"] or found["image_url"]):
        return item_id, {"summary": found["summary"], "image_url": found["image_url"]}
    return item_id, fetch_page_meta(url)


def enrich_news_items(db: Session, limit: int = 150) -> int:
    """幫還沒有縮圖/摘要的舊項目補資料,回傳實際補到資料的筆數。試過但什麼都沒找到的項目
    把 summary 存成空字串當「已試過」記號,以後不再重試(不然每次抓新聞都會對同一批
    找不到的舊項目重跑一輪搜尋)。"""
    todo = (
        db.query(NewsItem)
        .filter(NewsItem.summary.is_(None), NewsItem.image_url.is_(None))
        .order_by(NewsItem.created_at.desc())
        .limit(limit)
        .all()
    )
    if not todo:
        return 0
    by_id = {n.id: n for n in todo}
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda n: _enrich_one(n.id, n.name, n.url), todo))
    enriched = 0
    for item_id, data in results:
        n = by_id[item_id]
        n.summary = data.get("summary") or ""
        n.image_url = data.get("image_url") or None
        if n.summary or n.image_url:
            enriched += 1
    db.commit()
    return enriched


def fetch_and_store_news(db: Session) -> list[NewsItem]:
    """抓新聞、過濾、寫入,回傳這次新增的 NewsItem。任一查詢字串失敗只印警告跳過,不中斷
    其他查詢;呼叫端(排程迴圈)另外包一層 try/except,單次執行失敗不影響下次排程。"""
    existing_urls = {u for (u,) in db.query(NewsItem.url).all()}
    # 網址之外多比對標題一次 - 不同來源(Google/Bing)或不同時間查到同一篇文章,網址可能
    # 不一樣,單靠網址去重不夠保險,標題完全相同基本可以認定是同一篇報導。
    existing_names = {n for (n,) in db.query(NewsItem.name).all()}
    cutoff = datetime.now(timezone.utc) - timedelta(days=_MAX_AGE_DAYS)

    # 每組關鍵字各自選出最新的 _MAX_PER_QUERY 筆,不是把全部關鍵字的候選混在一起、只取
    # 全域最新的 _MAX_PER_RUN 筆 - 選舉季這種時候,「都更 OR 都市更新」這組會被大量政治
    # 造勢新聞灌爆,單純比日期排序,其他關鍵字(如地主財稅)幾乎永遠選不進來,新加的
    # 關鍵字等於形同虛設。分開選才能保證每個主題都有機會露出。
    seen_links: set[str] = set()
    seen_titles: set[str] = set()
    ordered: list[dict] = []
    for q in _QUERIES:
        try:
            per_query = []
            for it in _fetch_query(q):
                if it["link"] in existing_urls or it["link"] in seen_links:
                    continue
                if it["title"] in existing_names or it["title"] in seen_titles:
                    continue
                if it["pub_date"] and it["pub_date"] < cutoff:
                    continue
                per_query.append(it)
            # 有縮圖的優先(新聞頁是圖文卡片),同樣有沒有縮圖的再比日期新舊
            per_query.sort(
                key=lambda x: (bool(x.get("image_url")), x["pub_date"] or datetime.min.replace(tzinfo=timezone.utc)),
                reverse=True,
            )
            for it in per_query[:_MAX_PER_QUERY]:
                seen_links.add(it["link"])
                seen_titles.add(it["title"])
                ordered.append(it)
        except Exception as exc:  # noqa: BLE001
            print(f"[news_fetch] query {q!r} failed (ignored): {exc}", flush=True)

    created: list[NewsItem] = []
    for it in ordered:
        pub_date = it["pub_date"]
        item = NewsItem(
            category=_guess_category(it["title"]),
            name=it["title"][:255],
            url=it["link"],
            description=(it["description"][:1000] if it["description"] else None),
            summary=it.get("summary"),
            image_url=it.get("image_url"),
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

    try:
        enriched = enrich_news_items(db)
        if enriched:
            print(f"[news_fetch] enriched {enriched} old news items with image/summary", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[news_fetch] enrich failed (ignored): {exc}", flush=True)
    return created
