import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
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

@router.get("/company-documents", response_model=list[CompanyDocumentRead])
def list_company_documents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.execute(
        select(CompanyDocument, User.display_name)
        .join(User, User.id == CompanyDocument.uploaded_by, isouter=True)
        .order_by(CompanyDocument.uploaded_at.desc())
    ).all()
    results = []
    for doc, uploader_name in rows:
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
    disk_path, stored_name = build_company_upload_path(file.filename or "upload")
    content = file.file.read()
    with open(disk_path, "wb") as out:
        out.write(content)

    document = CompanyDocument(
        category=category,
        file_name=file.filename or stored_name,
        file_path=disk_path,
        file_size_bytes=len(content),
        mime_type=file.content_type,
        uploaded_by=current_user.id,
        description=description,
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
    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")
    return FileResponse(document.file_path, filename=document.file_name, media_type=document.mime_type)


@router.patch("/company-documents/{doc_id}", response_model=CompanyDocumentRead)
def update_company_document(
    doc_id: int,
    category: str | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    document = _get_company_document_or_404(db, doc_id)
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
