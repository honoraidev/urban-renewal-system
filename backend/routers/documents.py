import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_project_ocr_editor, require_project_viewer
from models.document import Document
from models.project import Project
from models.user import User
from schemas.document import DocumentRead
from utils.file_storage import build_upload_path
from utils.ocr import merge_pages_to_pdf

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])

VALID_DOC_TYPES = {
    "property_register",
    "building_register",
    "consent_form",
    "briefing_material",
    "contract",
    "photo",
    "other",
    # Project-level master templates (distinct from consent_form/contract, which are
    # per-landowner signed instances) - the SOP tab's 第0關 checklist checks for these
    # specifically so uploading one signed 同意書 doesn't get mistaken for "the blank
    # 同意書範本 was uploaded" (see routers/sop.py's stage-0 checklist).
    "dev_letter_template",
    "willingness_form_template",
    "consent_form_template",
    "contract_template",
    # 地籍圖 (cadastral map) - distinct from property_register (the title deed itself),
    # checked by the SOP tab's 第1關 checklist.
    "cadastral_map",
    # 顧問文件 (consultant/advisor documents - 建築師/估價師/顧問公司 deliverables), checked
    # by the SOP tab's 第5關 checklist. briefing_material already covers 說明會簡報
    # (stages 3/6/7) so isn't reused here - a consultant deliverable isn't a briefing.
    "consultant_document",
}


@router.get("", response_model=list[DocumentRead])
def list_documents(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    return db.scalars(
        select(Document).where(Document.project_id == project.id).order_by(Document.uploaded_at.desc())
    ).all()


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    landowner_id: int | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_ocr_editor),
):
    project_id = project.id

    if doc_type not in VALID_DOC_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid doc_type")

    disk_path, stored_name = build_upload_path(project.project_code, file.filename or "upload")
    content = file.file.read()
    with open(disk_path, "wb") as out:
        out.write(content)

    document = Document(
        project_id=project_id,
        landowner_id=landowner_id,
        doc_type=doc_type,
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


@router.post("/from-images", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document_from_images(
    files: list[UploadFile] = File(...),
    doc_type: str = Form("property_register"),
    file_name: str | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_ocr_editor),
):
    """Merges 1+ uploaded page images into a single PDF and saves it as one document.
    Used right after batch-import case-splitting so each case's source scan pages get a
    durable, findable home in the project's own 文件 tab immediately - see
    merge_pages_to_pdf() for why that matters."""
    project_id = project.id
    if doc_type not in VALID_DOC_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid doc_type")

    file_payload = [(upload.file.read(), upload.content_type) for upload in files]
    if not file_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有可合併的圖片")
    pdf_bytes = merge_pages_to_pdf(file_payload)

    display_name = file_name or "批次匯入掃描檔.pdf"
    if not display_name.lower().endswith(".pdf"):
        display_name += ".pdf"
    disk_path, stored_name = build_upload_path(project.project_code, display_name)
    with open(disk_path, "wb") as out:
        out.write(pdf_bytes)

    document = Document(
        project_id=project_id,
        doc_type=doc_type,
        file_name=display_name,
        file_path=disk_path,
        file_size_bytes=len(pdf_bytes),
        mime_type="application/pdf",
        uploaded_by=current_user.id,
        description=description or "批次匯入原始掃描檔",
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def get_document_or_404(db: Session, project_id: int, doc_id: int) -> Document:
    document = db.scalar(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


@router.get("/{doc_id}/download")
def download_document(
    doc_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    document = get_document_or_404(db, project.id, doc_id)

    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")

    return FileResponse(document.file_path, filename=document.file_name, media_type=document.mime_type)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_ocr_editor),
):
    document = get_document_or_404(db, project.id, doc_id)

    if os.path.exists(document.file_path):
        os.remove(document.file_path)

    db.delete(document)
    db.commit()
