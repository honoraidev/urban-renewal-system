import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_manager
from models.company_document import CompanyDocument
from models.faq_item import FaqItem
from models.regulation import Regulation
from models.user import User
from models.website import Website
from schemas.resource import (
    CompanyDocumentRead,
    FaqItemCreate,
    FaqItemRead,
    FaqItemUpdate,
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
    return document


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


# ================= 相關網站 (websites) =================

@router.get("/websites", response_model=list[WebsiteRead])
def list_websites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.scalars(select(Website).order_by(Website.category, Website.created_at)).all()


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
