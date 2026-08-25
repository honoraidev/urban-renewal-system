import io
import os
import re

import fitz
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
    "dev_letter_template",
    "willingness_form_template",
    "consent_form_template",
    "contract_template",
    "cadastral_map",
    "consultant_document",
}

DOC_TYPE_LABELS_MAP = {
    "dev_letter_template": "開發信",
    "willingness_form_template": "意願書",
    "consent_form_template": "同意書",
    "consent_form": "同意書",
    "contract_template": "合約",
    "contract": "合約",
    "property_register": "土地登記謄本",
    "building_register": "建物登記謄本",
    "cadastral_map": "地籍圖",
    "consultant_document": "顧問文件",
    "briefing_material": "說明會資料",
    "photo": "照片",
    "other": "其他",
}

DOC_TYPE_CONTENT_KEYWORDS = {
    "dev_letter_template": ["開發信", "致住戶", "致住戶信", "說明信", "開發說明", "都更開發", "開發信函"],
    "willingness_form_template": ["意願書", "參與意願", "意願調查", "都更意願", "意願調查表", "參與意願書"],
    "consent_form_template": ["同意書", "事業計畫同意書", "都市更新同意書", "權利變換同意書", "更新單元同意書"],
    "consent_form": ["同意書", "事業計畫同意書", "都市更新同意書", "權利變換同意書", "更新單元同意書"],
    "contract_template": ["合約", "契約", "合約書", "契約書", "協議書", "合作意向書", "都更合約"],
    "contract": ["合約", "契約", "合約書", "契約書", "協議書", "合作意向書", "都更合約"],
    "property_register": ["土地登記謄本", "土地謄本", "土地第一類謄本", "土地第二類謄本", "土地第三類謄本", "土地標示部", "土地所有權部", "土地標示"],
    "building_register": ["建物登記謄本", "建物謄本", "建物第一類謄本", "建物第二類謄本", "建物第三類謄本", "建物標示部", "建物所有權部", "主要用途", "建號"],
    "cadastral_map": ["地籍圖", "地籍圖謄本", "地籍圖資", "土地地籍圖", "地籍圖專用章", "宗地界線", "測量日期"],
    "consultant_document": ["顧問文件", "估價報告", "建築規劃", "都更評估", "財務試算", "建築師報告", "估價師報告"],
    "briefing_material": ["說明會", "說明會簡報", "說明會資料", "座談會", "簡報"],
}


def extract_file_content_text(content: bytes, filename: str, content_type: str | None) -> str:
    extracted = ""
    filename_lower = (filename or "").lower()

    if filename_lower.endswith(".pdf") or (content_type and "pdf" in content_type.lower()):
        try:
            doc = fitz.open(stream=content, filetype="pdf")
            pages_text = []
            for i in range(min(len(doc), 3)):
                txt = doc[i].get_text("text").strip()
                if txt:
                    pages_text.append(txt)
                else:
                    # Page has no vector text (scanned PDF page) -> render to image and run OCR
                    try:
                        from utils.ocr import run_ocr
                        pix = doc[i].get_pixmap(dpi=150)
                        img_bytes = pix.tobytes("png")
                        res = run_ocr(img_bytes)
                        if isinstance(res, dict) and "text" in res:
                            pages_text.append(res["text"])
                        elif isinstance(res, list):
                            pages_text.append("\n".join([item.get("text", "") for item in res if isinstance(item, dict)]))
                    except Exception:
                        pass
            extracted = "\n".join(pages_text)
        except Exception:
            pass
    elif filename_lower.endswith((".txt", ".json", ".csv", ".md", ".html")) or (content_type and "text/" in content_type.lower()):
        try:
            extracted = content.decode("utf-8", errors="ignore")
        except Exception:
            pass
    elif filename_lower.endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")) or (content_type and "image/" in content_type.lower()):
        try:
            from utils.ocr import run_ocr
            res = run_ocr(content)
            if isinstance(res, dict) and "text" in res:
                extracted = res["text"]
            elif isinstance(res, list):
                extracted = "\n".join([item.get("text", "") for item in res if isinstance(item, dict)])
        except Exception:
            pass

    return extracted.strip()


@router.post("/inspect")
async def inspect_document_content(
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
):
    content = await file.read()
    filename = file.filename or "file"
    extracted_text = extract_file_content_text(content, filename, file.content_type)

    raw_lines = [line.strip() for line in re.split(r"[\r\n]+", extracted_text) if line.strip()]
    cleaned_lines = []
    for line in raw_lines:
        compressed = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", line)
        cleaned_lines.append(compressed)

    detected_title = ""
    for line in cleaned_lines[:6]:
        if len(line) >= 2 and not line.startswith("中華民國") and not line.startswith("第") and not line.startswith("頁"):
            detected_title = line
            break
    if not detected_title and cleaned_lines:
        detected_title = cleaned_lines[0]

    has_content = bool(extracted_text.strip())
    content_raw = extracted_text.lower()
    content_normalized = re.sub(r"\s+", "", content_raw)

    filename_raw = filename.lower()
    filename_normalized = re.sub(r"\s+", "", filename_raw)

    target_keywords = DOC_TYPE_CONTENT_KEYWORDS.get(doc_type, [])
    target_label = DOC_TYPE_LABELS_MAP.get(doc_type, doc_type)

    # 1. Content-based target match
    content_target_match = False
    if has_content and target_keywords:
        content_target_match = any(
            (kw.lower() in content_raw) or (re.sub(r"\s+", "", kw.lower()) in content_normalized)
            for kw in target_keywords
        )

    # 2. Content-based other type detection
    detected_content_other_label = None
    if has_content:
        for type_key, keywords in DOC_TYPE_CONTENT_KEYWORDS.items():
            if type_key == doc_type:
                continue
            for kw in keywords:
                kw_norm = re.sub(r"\s+", "", kw.lower())
                if (kw.lower() in content_raw) or (kw_norm in content_normalized):
                    detected_content_other_label = DOC_TYPE_LABELS_MAP.get(type_key, type_key)
                    break
            if detected_content_other_label:
                break

    # 3. Filename-based matching (fallback)
    filename_target_match = False
    if target_keywords:
        filename_target_match = any(
            (kw.lower() in filename_raw) or (re.sub(r"\s+", "", kw.lower()) in filename_normalized)
            for kw in target_keywords
        )

    filename_other_label = None
    for type_key, keywords in DOC_TYPE_CONTENT_KEYWORDS.items():
        if type_key == doc_type:
            continue
        for kw in keywords:
            kw_norm = re.sub(r"\s+", "", kw.lower())
            if (kw.lower() in filename_raw) or (kw_norm in filename_normalized):
                filename_other_label = DOC_TYPE_LABELS_MAP.get(type_key, type_key)
                break
        if filename_other_label:
            break

    # DECISION: Content text / OCR takes absolute priority over filename
    matched = True
    final_other_label = None

    if has_content:
        if not content_target_match:
            # Content extracted, but target keywords (e.g. "意願書") are NOT present inside the content
            matched = False
            final_other_label = detected_content_other_label
        else:
            matched = True
            final_other_label = None
    else:
        # Fallback to filename ONLY when no text content could be extracted from PDF/image
        if filename_other_label and (not filename_target_match):
            matched = False
            final_other_label = filename_other_label

    return {
        "filename": filename,
        "target_doc_type": doc_type,
        "target_label": target_label,
        "matched": matched,
        "detected_title": detected_title[:100],
        "detected_other_label": final_other_label,
        "has_content_text": has_content,
        "snippet": extracted_text[:200],
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

    upload_filename = file.filename or "upload"
    content = file.file.read()

    # Deduplication check: if a document with exact same doc_type and file_name exists, overwrite/update it
    existing = db.scalar(
        select(Document)
        .where(
            Document.project_id == project_id,
            Document.doc_type == doc_type,
            Document.file_name == upload_filename,
        )
        .order_by(Document.uploaded_at.desc())
    )

    if existing:
        disk_path = existing.file_path
        if not os.path.exists(disk_path):
            disk_path, _ = build_upload_path(project.project_code, upload_filename)
            existing.file_path = disk_path

        with open(disk_path, "wb") as out:
            out.write(content)

        existing.file_size_bytes = len(content)
        existing.mime_type = file.content_type
        existing.uploaded_by = current_user.id
        if description:
            existing.description = description
        if landowner_id:
            existing.landowner_id = landowner_id

        db.commit()
        db.refresh(existing)
        return existing

    disk_path, stored_name = build_upload_path(project.project_code, upload_filename)
    with open(disk_path, "wb") as out:
        out.write(content)

    document = Document(
        project_id=project_id,
        landowner_id=landowner_id,
        doc_type=doc_type,
        file_name=upload_filename,
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


@router.post("/cleanup-duplicates")
def cleanup_duplicate_documents(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_ocr_editor),
):
    all_docs = db.scalars(
        select(Document)
        .where(Document.project_id == project.id)
        .order_by(Document.doc_type, Document.file_name, Document.uploaded_at.desc())
    ).all()

    seen_keys = set()
    to_delete = []

    for doc in all_docs:
        key = (doc.doc_type, doc.file_name)
        if key in seen_keys:
            to_delete.append(doc)
        else:
            seen_keys.add(key)

    deleted_count = len(to_delete)
    for doc in to_delete:
        if doc.file_path and os.path.exists(doc.file_path):
            other_ref = db.scalar(
                select(Document.id).where(Document.file_path == doc.file_path, Document.id != doc.id)
            )
            if not other_ref:
                try:
                    os.remove(doc.file_path)
                except Exception:
                    pass
        db.delete(doc)

    if deleted_count > 0:
        db.commit()

    return {"deleted_count": deleted_count}


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
