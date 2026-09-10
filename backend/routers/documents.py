import io
import os
import re

import pymupdf as fitz
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_project_ocr_editor, require_project_staff_viewer
from models.building_record import BuildingRecord
from models.document import Document
from models.document_folder import DocumentFolder
from models.land_record import LandRecord
from models.landowner import Landowner
from models.ocr import OcrJob
from models.ocr_job_document import OcrJobDocument
from models.project import Project
from models.user import User
from schemas.document import (
    DocumentFolderCreate,
    DocumentFolderRead,
    DocumentFolderUpdate,
    DocumentRead,
)
from utils.document_folders import folder_id_for_doc_type, seed_project_folders
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

    # DECISION: Content text / OCR takes absolute priority over filename.
    # For required document types, file content MUST contain expected keywords.
    REQUIRED_KEYWORD_DOC_TYPES = {
        "willingness_form_template",
        "willingness_form",
        "consent_form_template",
        "consent_form",
        "contract_template",
        "contract",
        "dev_letter_template",
        "cadastral_map",
        "property_register",
        "building_register",
    }

    matched = True
    final_other_label = None

    if has_content:
        if not content_target_match:
            # Content extracted, but target keywords (e.g. "意願書") are NOT present inside the content.
            # Even if filename is named "意願書.png", if inner text doesn't contain target keywords, flag mismatch.
            matched = False
            final_other_label = detected_content_other_label
        else:
            matched = True
            final_other_label = None
    else:
        # Fallback when no text content could be extracted from PDF/image
        if doc_type in REQUIRED_KEYWORD_DOC_TYPES:
            # Cannot verify inner text content for critical document type -> trigger confirmation modal
            matched = False
            final_other_label = filename_other_label or "內文無法驗證"
        elif filename_other_label:
            matched = False
            final_other_label = filename_other_label
        elif target_keywords and not filename_target_match:
            matched = False
            final_other_label = None
        else:
            matched = True
            final_other_label = None

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
    project: Project = Depends(require_project_staff_viewer),
):
    return db.scalars(
        select(Document).where(Document.project_id == project.id).order_by(Document.uploaded_at.desc())
    ).all()


# --- 案件資料 folder tree -------------------------------------------------------
# Every project is seeded with the standard 都更 case-file folder structure (see
# utils/document_folders.py). These endpoints expose that tree and let staff add / rename
# / move / remove their own sub-folders. Standard folders (code != NULL) can be renamed
# and reordered but not deleted.


def _get_folder_or_404(db: Session, project_id: int, folder_id: int) -> DocumentFolder:
    folder = db.scalar(
        select(DocumentFolder).where(
            DocumentFolder.id == folder_id, DocumentFolder.project_id == project_id
        )
    )
    if folder is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    return folder


@router.get("/folders", response_model=list[DocumentFolderRead])
def list_document_folders(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    # Seed on first read so projects created before the folder tree existed still get it
    # (the backfill in main.py also covers this, but a fresh read shouldn't depend on a
    # restart having happened). Tolerate a concurrent seeder racing us on the
    # (project_id, code) unique key - if it lost, the folders it needed now exist anyway.
    try:
        seed_project_folders(db, project.id)
        db.commit()
    except Exception:
        db.rollback()
    return db.scalars(
        select(DocumentFolder)
        .where(DocumentFolder.project_id == project.id)
        .order_by(
            func.coalesce(DocumentFolder.parent_id, 0),
            DocumentFolder.sort_order,
            DocumentFolder.id,
        )
    ).all()


@router.post("/folders", response_model=DocumentFolderRead, status_code=status.HTTP_201_CREATED)
def create_document_folder(
    payload: DocumentFolderCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_ocr_editor),
):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="資料夾名稱不可空白")

    parent_id = payload.parent_id
    if parent_id is not None:
        _get_folder_or_404(db, project.id, parent_id)

    sibling_cond = (
        DocumentFolder.parent_id == parent_id
        if parent_id is not None
        else DocumentFolder.parent_id.is_(None)
    )
    max_order = db.scalar(
        select(func.max(DocumentFolder.sort_order)).where(
            DocumentFolder.project_id == project.id, sibling_cond
        )
    )

    folder = DocumentFolder(
        project_id=project.id,
        parent_id=parent_id,
        name=name,
        code=None,
        sort_order=(max_order or 0) + 1,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.patch("/folders/{folder_id}", response_model=DocumentFolderRead)
def update_document_folder(
    folder_id: int,
    payload: DocumentFolderUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_ocr_editor),
):
    folder = _get_folder_or_404(db, project.id, folder_id)
    data = payload.model_dump(exclude_unset=True)

    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="資料夾名稱不可空白")
        folder.name = name

    if data.get("sort_order") is not None:
        folder.sort_order = data["sort_order"]

    if "parent_id" in data:
        new_parent = data["parent_id"]
        if new_parent is not None:
            if new_parent == folder.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="不能把資料夾移到自己底下"
                )
            parent = _get_folder_or_404(db, project.id, new_parent)
            # Walk up from the new parent; if we reach this folder, the move makes a cycle.
            cursor: DocumentFolder | None = parent
            hops = 0
            while cursor is not None and hops < 100:
                if cursor.id == folder.id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="不能把資料夾移到自己的子資料夾底下",
                    )
                cursor = db.get(DocumentFolder, cursor.parent_id) if cursor.parent_id else None
                hops += 1
        folder.parent_id = new_parent

    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_ocr_editor),
):
    folder = _get_folder_or_404(db, project.id, folder_id)
    if folder.code is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="標準資料夾不可刪除")

    has_children = db.scalar(
        select(func.count()).select_from(DocumentFolder).where(DocumentFolder.parent_id == folder.id)
    )
    has_docs = db.scalar(
        select(func.count()).select_from(Document).where(Document.folder_id == folder.id)
    )
    if has_children or has_docs:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="資料夾內仍有子資料夾或文件,請先清空或移出"
        )

    db.delete(folder)
    db.commit()
    return  # 204


def _resolve_upload_folder_id(
    db: Session, project_id: int, folder_id: int | None, doc_type: str
) -> int | None:
    """A caller-supplied folder_id must belong to this project; otherwise fall back to
    the standard folder that matches the (legacy) doc_type."""
    if folder_id is not None:
        _get_folder_or_404(db, project_id, folder_id)
        return folder_id
    try:
        folder_map = seed_project_folders(db, project_id)
        db.flush()
    except Exception:
        db.rollback()
        folder_map = {
            row.code: row.id
            for row in db.scalars(
                select(DocumentFolder).where(
                    DocumentFolder.project_id == project_id, DocumentFolder.code.is_not(None)
                )
            )
        }
    return folder_id_for_doc_type(folder_map, doc_type)


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
    landowner_id: int | None = Form(None),
    folder_id: int | None = Form(None),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_ocr_editor),
):
    project_id = project.id

    if doc_type not in VALID_DOC_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid doc_type")

    folder_id = _resolve_upload_folder_id(db, project_id, folder_id, doc_type)

    upload_filename = file.filename or "upload"
    content = file.file.read()

    # 同名檔案不再覆蓋原檔 — 每次上傳都存成新的一筆，保留舊版做版本紀錄
    # (前端文件清單會以檔名分組、把舊版收在 ▶ 展開列，且舊版不可下載)。
    disk_path, stored_name = build_upload_path(project.project_code, upload_filename)
    with open(disk_path, "wb") as out:
        out.write(content)

    document = Document(
        project_id=project_id,
        landowner_id=landowner_id,
        folder_id=folder_id,
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



@router.post("/from-images", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document_from_images(
    files: list[UploadFile] = File(...),
    doc_type: str = Form("property_register"),
    file_name: str | None = Form(None),
    folder_id: int | None = Form(None),
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

    folder_id = _resolve_upload_folder_id(db, project_id, folder_id, doc_type)

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
        folder_id=folder_id,
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
    project: Project = Depends(require_project_staff_viewer),
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

    # If this document was a source for OCR 謄本 import jobs, delete the 土地/建物登記
    # records those jobs produced (and jobs that end up with no source document left),
    # then clean up landowners left with no land/building record at all - so removing a
    # mistaken/duplicate 謄本 檔案 also removes the data it created.
    job_ids = [
        row[0]
        for row in db.execute(
            select(OcrJobDocument.ocr_job_id).where(OcrJobDocument.document_id == doc_id)
        )
    ]
    removed_land = removed_bldg = removed_jobs = removed_owners = 0
    if job_ids:
        # ocr_job_documents.document_id FK is ON DELETE CASCADE, so those links go with
        # the document. A job is considered fully removed only once it has no *other*
        # source document remaining.
        emptied_jobs = [
            jid
            for jid in job_ids
            if db.scalar(
                select(func.count())
                .select_from(OcrJobDocument)
                .where(OcrJobDocument.ocr_job_id == jid, OcrJobDocument.document_id != doc_id)
            )
            == 0
        ]
        if emptied_jobs:
            removed_land = (
                db.query(LandRecord)
                .filter(LandRecord.project_id == project.id, LandRecord.source_ocr_job_id.in_(emptied_jobs))
                .delete(synchronize_session=False)
            )
            removed_bldg = (
                db.query(BuildingRecord)
                .filter(BuildingRecord.project_id == project.id, BuildingRecord.source_ocr_job_id.in_(emptied_jobs))
                .delete(synchronize_session=False)
            )
            removed_jobs = (
                db.query(OcrJob)
                .filter(OcrJob.id.in_(emptied_jobs))
                .delete(synchronize_session=False)
            )

    if os.path.exists(document.file_path):
        os.remove(document.file_path)
    db.delete(document)
    db.flush()

    orphans = (
        db.query(Landowner)
        .filter(
            Landowner.project_id == project.id,
            ~Landowner.land_records.any(),
            ~Landowner.building_records.any(),
        )
        .all()
    )
    removed_owners = len(orphans)
    for o in orphans:
        db.delete(o)

    db.commit()
    return  # 204
