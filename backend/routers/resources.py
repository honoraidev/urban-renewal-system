import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_manager
from models.company_document import CompanyDocument
from models.faq_item import FaqItem
from models.inventory_item import InventoryItem
from models.news_item import NewsItem
from models.news_sync_state import NewsSyncState
from models.regulation import Regulation
from models.user import User
from models.website import Website
from schemas.resource import (
    CompanyDocumentRead,
    FaqItemCreate,
    FaqItemRead,
    FaqItemUpdate,
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
    NewsItemCreate,
    NewsItemRead,
    NewsItemUpdate,
    NewsSyncStatusRead,
    RegulationCreate,
    RegulationRead,
    RegulationUpdate,
    WebsiteCreate,
    WebsiteRead,
    WebsiteUpdate,
)
from utils.file_storage import build_company_upload_path

router = APIRouter(tags=["resources"])


# ================= 公版文件 (company-wide document templates) =================

# ----- 公版文件分部可見度 -----
# 分部由使用者的「部門」判斷:部門名稱含「桃園」→ 桃園分部;其他任何部門 → 台北分部。同時有兩邊部門的人,
# 兩邊的文件都看得到。沒有填任何部門的人只能看「共用」文件。只有 L0 系統管理員不受限(看全部)。
BRANCHES = {"all", "taoyuan", "taipei"}


def user_branches(user: User) -> set[str]:
    out: set[str] = set()
    for d in user.departments or []:
        name = str(d or "")
        if not name.strip():
            continue
        out.add("taoyuan" if "桃園" in name else "taipei")
    return out


def _doc_visible(doc: CompanyDocument, user: User) -> bool:
    if user.role == "sys_admin":
        return True
    b = doc.branch or "all"
    return b == "all" or b in user_branches(user)


def backfill_company_doc_branches(db: Session) -> int:
    """舊文件(branch=all)依上傳者的部門自動歸分部:上傳者只屬一個分部才歸;其他維持共用。可重複執行。"""
    n = 0
    rows = db.execute(
        select(CompanyDocument, User).join(User, User.id == CompanyDocument.uploaded_by)
    ).all()
    for doc, u in rows:
        if (doc.branch or "all") != "all":
            continue
        mine = user_branches(u)
        if len(mine) == 1:
            doc.branch = next(iter(mine))
            n += 1
    if n:
        db.commit()
    return n


def _clean_branch(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    if v not in BRANCHES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="分部只能是 all / taoyuan / taipei")
    return v


@router.get("/company-documents", response_model=list[CompanyDocumentRead])
def list_company_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.execute(
        select(CompanyDocument, User.display_name)
        .join(User, User.id == CompanyDocument.uploaded_by, isouter=True)
        .order_by(CompanyDocument.uploaded_at.desc())
    ).all()
    results = []
    for doc, uploader_name in rows:
        if not _doc_visible(doc, current_user):
            continue
        item = CompanyDocumentRead.model_validate(doc)
        item.uploaded_by_name = uploader_name
        results.append(item)
    return results


@router.post("/company-documents", response_model=CompanyDocumentRead, status_code=status.HTTP_201_CREATED)
def upload_company_document(
    file: UploadFile = File(...),
    category: str | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    # 分部自動判斷:上傳者只屬於一個分部 → 文件歸那個分部;兩邊都有或沒部門(例如 L0)→ 全部共用
    mine = user_branches(current_user)
    branch = next(iter(mine)) if len(mine) == 1 else "all"
    disk_path, stored_name = build_company_upload_path(file.filename or "upload")
    content = file.file.read()
    with open(disk_path, "wb") as out:
        out.write(content)

    # 檔名自動改成「分部-分類名稱」(例如:台北-意願書範本.docx);同名已存在就加 (2)、(3)…;副檔名保留
    label = {"taoyuan": "桃園", "taipei": "台北"}.get(branch, "共用")
    cat_name = (category or "").strip() or "未分類"
    ext = os.path.splitext(file.filename or stored_name)[1]
    base = f"{label}-{cat_name}"
    taken = set(db.scalars(select(CompanyDocument.file_name).where(CompanyDocument.file_name.like(f"{base}%"))).all())
    final_name, n = f"{base}{ext}", 1
    while final_name in taken:
        n += 1
        final_name = f"{base} ({n}){ext}"

    document = CompanyDocument(
        category=category,
        file_name=final_name,
        file_path=disk_path,
        file_size_bytes=len(content),
        mime_type=file.content_type,
        uploaded_by=current_user.id,
        description=description,
        branch=branch,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    item = CompanyDocumentRead.model_validate(document)
    item.uploaded_by_name = current_user.display_name
    return item


def _get_company_document_or_404(db: Session, doc_id: int) -> CompanyDocument:
    document = db.get(CompanyDocument, doc_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


@router.get("/company-documents/{doc_id}/download")
def download_company_document(
    doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    document = _get_company_document_or_404(db, doc_id)
    if not _doc_visible(document, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")
    return FileResponse(document.file_path, filename=document.file_name, media_type=document.mime_type)


@router.get("/company-documents/{doc_id}/preview")
def preview_company_document(
    doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """預覽用:PDF/圖片/文字瀏覽器本來就看得懂,直接回原檔;Word/Excel/PowerPoint 先轉成 PDF 再回(下載仍是原檔)。"""
    from utils.office_preview import CONVERTIBLE_EXTS, convert_to_pdf

    document = _get_company_document_or_404(db, doc_id)
    if not _doc_visible(document, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")
    ext = os.path.splitext(document.file_name)[1].lower()
    if ext not in CONVERTIBLE_EXTS:
        return FileResponse(document.file_path, filename=document.file_name, media_type=document.mime_type)
    try:
        pdf_path = convert_to_pdf(document.file_path)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"文件轉PDF預覽失敗:{exc}")
    return FileResponse(pdf_path, filename=os.path.splitext(document.file_name)[0] + ".pdf", media_type="application/pdf")


@router.patch("/company-documents/{doc_id}", response_model=CompanyDocumentRead)
def update_company_document(
    doc_id: int,
    category: str | None = Form(None),
    description: str | None = Form(None),
    branch: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    document = _get_company_document_or_404(db, doc_id)
    if not _doc_visible(document, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if branch is not None:
        document.branch = _clean_branch(branch)
    if category is not None:
        document.category = category.strip() if category.strip() else None
    if description is not None:
        document.description = description.strip() if description.strip() else None
    db.commit()
    db.refresh(document)
    item = CompanyDocumentRead.model_validate(document)
    if document.uploaded_by_user:
        item.uploaded_by_name = document.uploaded_by_user.display_name
    return item


@router.delete("/company-documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company_document(
    doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    document = _get_company_document_or_404(db, doc_id)
    if not _doc_visible(document, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if os.path.exists(document.file_path):
        os.remove(document.file_path)
    db.delete(document)
    db.commit()


# ================= 相關法規 (regulations) =================

@router.get("/regulations", response_model=list[RegulationRead])
def list_regulations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(select(Regulation).order_by(Regulation.category, Regulation.created_at)).all()


@router.post("/regulations", response_model=RegulationRead, status_code=status.HTTP_201_CREATED)
def create_regulation(
    payload: RegulationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    regulation = Regulation(**payload.model_dump())
    db.add(regulation)
    db.commit()
    db.refresh(regulation)
    return regulation


@router.patch("/regulations/{regulation_id}", response_model=RegulationRead)
def update_regulation(
    regulation_id: int,
    payload: RegulationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    regulation = db.get(Regulation, regulation_id)
    if regulation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulation not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(regulation, field, value)
    db.commit()
    db.refresh(regulation)
    return regulation


@router.delete("/regulations/{regulation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_regulation(
    regulation_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    regulation = db.get(Regulation, regulation_id)
    if regulation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulation not found")
    db.delete(regulation)
    db.commit()


# ================= 新聞 (news) =================

@router.get("/news", response_model=list[NewsItemRead])
def list_news_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(select(NewsItem).order_by(NewsItem.category, NewsItem.created_at.desc())).all()


@router.post("/news", response_model=NewsItemRead, status_code=status.HTTP_201_CREATED)
def create_news_item(
    payload: NewsItemCreate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    from utils.news_fetch import fetch_page_meta

    data = payload.model_dump()
    # 手動新增的連結沒填縮圖/摘要時,自動讀原文網頁的 og:image / og:description(失敗就留空)
    if not data.get("image_url") or not data.get("summary"):
        meta = fetch_page_meta(data["url"])
        data["image_url"] = data.get("image_url") or meta.get("image_url")
        data["summary"] = data.get("summary") or meta.get("summary")
    item = NewsItem(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/news/fetch-now", response_model=list[NewsItemRead])
def fetch_news_now(db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    """手動立即跑一次每日新聞抓取(見 utils/news_fetch),不用等到隔天 9:00 的排程 -
    主要給部署後測試用。放在 /news/{news_id} 之前註冊,避免跟該參數化路由的比對順序有
    任何疑慮(雖然 Starlette 理論上會找到完整比對的路由,但字面路由放前面更保險)。"""
    from utils.news_fetch import fetch_and_store_news

    return fetch_and_store_news(db)


@router.post("/news/auto-sync")
def auto_sync_news(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """打開新聞頁時自動補抓 - 任何登入者都可觸發,但距上次同步未滿 30 分鐘就直接跳過,
    避免每個人每次點進來都去打 Google 新聞 RSS。"""
    from utils.news_fetch import fetch_and_store_news

    state = db.get(NewsSyncState, 1)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if state and now - state.last_synced_at < timedelta(minutes=30):
        return {"fetched": False, "created": 0}
    return {"fetched": True, "created": len(fetch_and_store_news(db))}


@router.get("/news/sync-status", response_model=NewsSyncStatusRead)
def get_news_sync_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """新聞頁面右上角顯示「上次同步時間」用 - 每天排程或手動按「立即抓新聞」都會更新
    這個時間,不管當次有沒有抓到新資料(代表「最後一次嘗試同步」)。"""
    state = db.get(NewsSyncState, 1)
    return NewsSyncStatusRead(last_synced_at=state.last_synced_at if state else None)


@router.patch("/news/{news_id}", response_model=NewsItemRead)
def update_news_item(
    news_id: int, payload: NewsItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    item = db.get(NewsItem, news_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/news/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_news_item(news_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    item = db.get(NewsItem, news_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="News item not found")
    db.delete(item)
    db.commit()


# ================= 相關網站 (websites) =================

DEFAULT_WEBSITES = [
    {"category": "地籍 & 地圖", "name": "地政司地籍圖資查詢", "url": "https://landmaps.land.moi.gov.tw/", "description": "查地段、地小段、地籍圖及地主資料"},
    {"category": "地籍 & 地圖", "name": "內政部全國通用電子地圖", "url": "https://maps.nlsc.gov.tw/", "description": "整合式地圖服務，含地形及航照圖層"},
    {"category": "都更 GIS", "name": "台北市都更雲地圖", "url": "https://uro.gov.taipei/", "description": "台北都更範圍、容積獎勵查詢"},
    {"category": "都更 GIS", "name": "台北市歷史都市計畫GIS", "url": "https://www.gis.udd.taipei.gov.tw/", "description": "歷史地籍及都市計畫圖查詢"},
    {"category": "都更 GIS", "name": "台北市政府都更雲地圖", "url": "https://land.gov.taipei/", "description": "台北市都更地圖查詢"},
    {"category": "都更 GIS", "name": "新北市都更GIS", "url": "https://www.ur.ntpc.gov.tw/", "description": "新北市都更範圍及申請案件地圖"},
    {"category": "建管查詢", "name": "台北市建管處", "url": "https://dba.gov.taipei/", "description": "建照、使照、違章建築查詢"},
    {"category": "建管查詢", "name": "新北市建管處", "url": "https://www.publicwork.ntpc.gov.tw/", "description": "新北市建照、使照查詢"},
    {"category": "不動產行情", "name": "591不動產實價", "url": "https://www.591.com.tw/", "description": "實登實價查詢，了解區域成交行情"},
    {"category": "不動產行情", "name": "樂居房仲資訊", "url": "https://www.leju.com.tw/", "description": "建案資訊、成交行情分析"},
    {"category": "其他工具", "name": "地下管線總查詢", "url": "https://pipeline.moi.gov.tw/", "description": "地下設施管線位置查詢"},
    {"category": "其他工具", "name": "郵遞區號查詢", "url": "https://www.post.gov.tw/", "description": "地址查詢郵遞區號"},
    {"category": "其他工具", "name": "民航局航高管制查詢", "url": "https://www.caa.gov.tw/", "description": "地區及航行管制及建物高度限制"},
    {"category": "謄本 & 產權", "name": "電子謄本申請系統", "url": "https://hn.land.moi.gov.tw/", "description": "線上申請第一類、第二類謄本"},
]


@router.get("/websites", response_model=list[WebsiteRead])
def list_websites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.execute(
        update(Website).where(Website.category == "謄本 & 謄本").values(category="謄本 & 產權")
    )
    db.commit()
    sites = db.scalars(select(Website).order_by(Website.id)).all()
    if not sites or len(sites) < len(DEFAULT_WEBSITES):
        db.query(Website).delete()
        for w in DEFAULT_WEBSITES:
            db.add(Website(**w))
        db.commit()
        sites = db.scalars(select(Website).order_by(Website.id)).all()
    return sites


@router.post("/websites", response_model=WebsiteRead, status_code=status.HTTP_201_CREATED)
def create_website(
    payload: WebsiteCreate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    website = Website(**payload.model_dump())
    db.add(website)
    db.commit()
    db.refresh(website)
    return website


@router.patch("/websites/{website_id}", response_model=WebsiteRead)
def update_website(
    website_id: int,
    payload: WebsiteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    website = db.get(Website, website_id)
    if website is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(website, field, value)
    db.commit()
    db.refresh(website)
    return website


@router.delete("/websites/{website_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_website(website_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    website = db.get(Website, website_id)
    if website is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website not found")
    db.delete(website)
    db.commit()


# ================= 知識庫 (FAQ) =================

@router.get("/faq", response_model=list[FaqItemRead])
def list_faq_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(select(FaqItem).order_by(FaqItem.category, FaqItem.created_at)).all()


class FaqAskMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class FaqAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[FaqAskMessage] = Field(default_factory=list, max_length=12)


_FAQ_ASK_SYSTEM = (
    "你是「都更管理系統」知識庫的 AI 助理,協助同仁回答都市更新相關問題。請一律使用繁體中文,語氣專業、簡潔、好讀。\n"
    "回答原則:\n"
    "1. 優先根據下方【知識庫條目】回答,不要與條目內容矛盾;用到哪幾條,就在答案最後一行寫「參考:Q1、Q3」(編號對應條目編號);如果沒有用到任何條目,就完全不要寫「參考」那一行,也不要寫「暫無適用條目」之類的字。\n"
    "2. 條目沒有涵蓋時,先明說「知識庫目前沒有直接相關的條目」,再以一般都更常識簡要說明,並提醒需向主管或專業人員確認;不確定的內容不要編造數字、法條條號或日期。\n"
    "3. 涉及稅額、持分、權利價值等試算或法律效力的問題,提醒以主管機關或專業人員核定為準。\n"
    "4. 與都市更新或本系統無關的問題,禮貌說明你只協助都更相關問題。\n"
    "5. 回答務必精簡:先用一句話給結論,再視需要列 2 到 4 個重點,全文控制在 200 字以內,不要重複題目、不要客套開場、不要自我介紹;一律用純文字,不要使用 Markdown 符號(例如 ** 粗體、# 標題),條列請用「1. 2. 3.」或「・」。"
)


def _faq_bigrams(text: str) -> set[str]:
    t = "".join(ch for ch in (text or "").lower() if not ch.isspace())
    if len(t) < 2:
        return {t} if t else set()
    return {t[i : i + 2] for i in range(len(t) - 1)}


def _pick_faq_context(question: str, items: list, limit: int = 8) -> list:
    """用字元二元組重疊做簡易檢索:知識庫不大,不需要向量資料庫;條目很少時全部帶入。"""
    if len(items) <= limit:
        return list(items)
    q = _faq_bigrams(question)
    scored = []
    for it in items:
        hay = _faq_bigrams(f"{it.category or ''}{it.question}{it.answer}")
        overlap = len(q & hay)
        # 問題欄命中的權重加倍
        overlap += len(q & _faq_bigrams(it.question))
        if overlap:
            scored.append((overlap, it))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [it for _, it in scored[:limit]]


def _faq_ask_prepare(payload: FaqAskRequest, db: Session):
    """共用:檢查 AI 有沒有設定、挑出相關條目、組 system prompt 與對話。"""
    from utils import qa_llm

    if not qa_llm.available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI 問答尚未啟用(缺少 AI 服務設定)")
    items = db.scalars(select(FaqItem).order_by(FaqItem.created_at)).all()
    picked = _pick_faq_context(payload.question, items, limit=3)
    if picked:
        # 每條答案截斷,提示字數壓小,自架模型回得比較快
        block = "\n\n".join(
            f"Q{i}.【{it.category or '一般'}】{it.question}\nA:{(it.answer or '')[:350]}" for i, it in enumerate(picked, 1)
        )
    else:
        block = "(知識庫目前沒有任何條目)"
    system = f"{_FAQ_ASK_SYSTEM}\n\n【知識庫條目】\n{block}"
    messages = [{"role": m.role, "content": m.content} for m in payload.history[-6:]]
    messages.append({"role": "user", "content": payload.question.strip()})
    sources = [{"index": i, "id": it.id, "question": it.question} for i, it in enumerate(picked, 1)]
    return system, messages, sources


@router.post("/faq/ask")
def ask_faq(
    payload: FaqAskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """知識庫 AI 問答(一次回完整答案版)。"""
    from utils import qa_llm

    system, messages, sources = _faq_ask_prepare(payload, db)
    try:
        answer = qa_llm.chat_complete(system, messages)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    if not answer:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI 沒有產生回覆,請換個問法再試一次")
    return {"answer": answer, "sources": sources}


# ---- 輪詢版 AI 問答:不長時間佔著一條串流連線(Synology 反向代理走 HTTP/2 時,長串流會被切斷、
# 瀏覽器出現 ERR_HTTP2_PROTOCOL_ERROR)。送出問題後立刻拿到 job_id,之後每隔一下用短請求來取「目前累積的文字」。
# 工作記在這個程式的記憶體裡(單一 process),10 分鐘後清掉。
import threading as _threading
import time as _time
import uuid as _uuid

_FAQ_JOBS: dict = {}
_FAQ_JOBS_LOCK = _threading.Lock()
_FAQ_JOB_TTL = 600


def _faq_jobs_gc() -> None:
    now = _time.time()
    for k in [k for k, v in _FAQ_JOBS.items() if now - v["ts"] > _FAQ_JOB_TTL]:
        _FAQ_JOBS.pop(k, None)


@router.post("/faq/ask-start")
def ask_faq_start(
    payload: FaqAskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from utils import qa_llm

    system, messages, sources = _faq_ask_prepare(payload, db)
    job_id = _uuid.uuid4().hex
    job = {"user_id": current_user.id, "text": "", "done": False, "error": None, "sources": sources, "ts": _time.time()}
    with _FAQ_JOBS_LOCK:
        _faq_jobs_gc()
        _FAQ_JOBS[job_id] = job

    def worker():
        try:
            for piece in qa_llm.chat_stream(system, messages):
                if piece:
                    job["text"] += piece
                    job["ts"] = _time.time()
            if not job["text"]:
                job["error"] = "AI 沒有產生回覆,請換個問法再試一次"
        except RuntimeError as exc:
            job["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            import traceback

            print(f"[faq_ask] unexpected error: {exc!r}\n{traceback.format_exc()}", flush=True)
            job["error"] = f"AI 發生未預期的錯誤({exc.__class__.__name__}:{str(exc)[:120]})"
        finally:
            job["done"] = True
            job["ts"] = _time.time()

    _threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "sources": sources}


@router.get("/faq/ask-poll/{job_id}")
def ask_faq_poll(job_id: str, offset: int = 0, current_user: User = Depends(get_current_user)):
    job = _FAQ_JOBS.get(job_id)
    if job is None or job["user_id"] != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="這次提問已過期,請重新送出")
    text = job["text"]
    offset = max(0, min(offset, len(text)))
    return {"delta": text[offset:], "length": len(text), "done": job["done"], "error": job["error"]}


@router.post("/faq/ask-stream")
def ask_faq_stream(
    payload: FaqAskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """知識庫 AI 問答(串流版,NDJSON):先送 sources,接著一段一段 chunk,最後 done / error。"""
    import json as _json

    from fastapi.responses import StreamingResponse

    from utils import qa_llm

    system, messages, sources = _faq_ask_prepare(payload, db)

    def gen():
        # 真正呼叫 AI 的部分放到背景執行緒,這裡每 8 秒沒東西就送一個心跳(ping):
        # AI 要想很久才吐第一個字時,中間的反向代理(NAS 的 nginx 預設 60 秒沒資料就斷線)才不會把連線切掉。
        import queue
        import threading

        q: "queue.Queue" = queue.Queue()

        def worker():
            try:
                for piece in qa_llm.chat_stream(system, messages):
                    if piece:
                        q.put(("chunk", piece))
                q.put(("end", None))
            except RuntimeError as exc:
                q.put(("error", str(exc)))
            except Exception:  # noqa: BLE001
                q.put(("error", "AI 發生未預期的錯誤,請稍後再試"))

        threading.Thread(target=worker, daemon=True).start()
        yield _json.dumps({"type": "sources", "sources": sources}, ensure_ascii=False) + "\n"
        sent = False
        while True:
            try:
                kind, val = q.get(timeout=8)
            except queue.Empty:
                yield _json.dumps({"type": "ping"}) + "\n"
                continue
            if kind == "chunk":
                sent = True
                yield _json.dumps({"type": "chunk", "text": val}, ensure_ascii=False) + "\n"
            elif kind == "error":
                yield _json.dumps({"type": "error", "error": val}, ensure_ascii=False) + "\n"
                return
            else:
                if sent:
                    yield _json.dumps({"type": "done"}) + "\n"
                else:
                    yield _json.dumps({"type": "error", "error": "AI 沒有產生回覆,請換個問法再試一次"}, ensure_ascii=False) + "\n"
                return

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/faq", response_model=FaqItemRead, status_code=status.HTTP_201_CREATED)
def create_faq_item(
    payload: FaqItemCreate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    item = FaqItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/faq/{faq_id}", response_model=FaqItemRead)
def update_faq_item(
    faq_id: int, payload: FaqItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    item = db.get(FaqItem, faq_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/faq/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_faq_item(faq_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    item = db.get(FaqItem, faq_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ item not found")
    db.delete(item)
    db.commit()


# ================= 部門物品管制表 (inventory) =================

@router.get("/inventory-items", response_model=list[InventoryItemRead])
def list_inventory_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(
        select(InventoryItem).order_by(InventoryItem.department, InventoryItem.category, InventoryItem.id)
    ).all()


@router.post("/inventory-items", response_model=InventoryItemRead, status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    payload: InventoryItemCreate, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    item = InventoryItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/inventory-items/{item_id}", response_model=InventoryItemRead)
def update_inventory_item(
    item_id: int,
    payload: InventoryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/inventory-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)
):
    item = db.get(InventoryItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found")
    db.delete(item)
    db.commit()
