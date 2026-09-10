"""The standard 案件資料 folder tree that every project is seeded with.

Layout (top level → sub-folders):

    1. 謄本            → 地籍圖 / 土地 / 建物 / 第三類謄本
    2. 基地調查        → 基本調查 / 投報表
    3. 同意書          → 事業計畫同意書 / 代刻印章同意書 / 拆除同意書 / 選屋調查表
    4. 相關合作廠商    → 建築師 / 估價師 / 顧問公司
    5. 說明會
    其他

Seeding happens on project creation (routers/projects.py::create_project) and, for
projects that predate this tree, in main.py::_auto_migrate's backfill. Seeded folders
carry a stable ``code``; user-created folders have ``code = None``.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.document_folder import DocumentFolder

# (code, 中文名, [children]) - list position is the display order (sort_order).
FOLDER_TREE: list[tuple[str, str, list]] = [
    ("transcripts", "謄本", [
        ("transcripts.cadastral_map", "地籍圖", []),
        ("transcripts.land", "土地", []),
        ("transcripts.building", "建物", []),
        ("transcripts.type3", "第三類謄本", []),
    ]),
    ("site_survey", "基地調查", [
        ("site_survey.basic", "基本調查", []),
        ("site_survey.roi", "投報表", []),
    ]),
    ("consent", "同意書", [
        ("consent.business_plan", "事業計畫同意書", []),
        ("consent.seal_carving", "代刻印章同意書", []),
        ("consent.demolition", "拆除同意書", []),
        ("consent.house_selection", "選屋調查表", []),
    ]),
    ("partners", "相關合作廠商", [
        ("partners.architect", "建築師", []),
        ("partners.appraiser", "估價師", []),
        ("partners.consultant", "顧問公司", []),
    ]),
    ("briefing", "說明會", []),
    ("others", "其他", []),
]

DEFAULT_FOLDER_CODE = "others"

# Best-effort placement for documents uploaded before the folder tree existed, and for
# uploads that still only specify the legacy ``doc_type``. Anything unmapped -> "其他".
DOC_TYPE_TO_FOLDER_CODE: dict[str, str] = {
    "property_register": "transcripts.land",
    "building_register": "transcripts.building",
    "cadastral_map": "transcripts.cadastral_map",
    "consent_form": "consent.business_plan",
    "consent_form_template": "consent.business_plan",
    "briefing_material": "briefing",
    "consultant_document": "partners.consultant",
    "contract": DEFAULT_FOLDER_CODE,
    "contract_template": DEFAULT_FOLDER_CODE,
    "dev_letter_template": DEFAULT_FOLDER_CODE,
    "willingness_form_template": DEFAULT_FOLDER_CODE,
    "photo": DEFAULT_FOLDER_CODE,
    "other": DEFAULT_FOLDER_CODE,
}


def seed_project_folders(db: Session, project_id: int) -> dict[str, int]:
    """Idempotently ensure the standard folder tree exists for a project. Returns a
    ``{code: folder_id}`` map covering every seeded folder. Safe to call repeatedly -
    only folders missing (by code) are inserted; existing ones are left untouched, so a
    folder a user renamed keeps its new name."""
    existing: dict[str, int] = {
        row.code: row.id
        for row in db.scalars(
            select(DocumentFolder).where(
                DocumentFolder.project_id == project_id,
                DocumentFolder.code.is_not(None),
            )
        )
    }

    def _walk(nodes: list, parent_id: int | None) -> None:
        for sort_order, (code, name, children) in enumerate(nodes):
            fid = existing.get(code)
            if fid is None:
                folder = DocumentFolder(
                    project_id=project_id,
                    parent_id=parent_id,
                    name=name,
                    code=code,
                    sort_order=sort_order,
                )
                db.add(folder)
                db.flush()
                fid = folder.id
                existing[code] = fid
            _walk(children, fid)

    _walk(FOLDER_TREE, None)
    return existing


def folder_id_for_doc_type(folder_map: dict[str, int], doc_type: str | None) -> int | None:
    """Pick a folder id for a legacy ``doc_type`` from a ``{code: id}`` map (as returned
    by :func:`seed_project_folders`), falling back to 其他."""
    code = DOC_TYPE_TO_FOLDER_CODE.get(doc_type or "", DEFAULT_FOLDER_CODE)
    return folder_map.get(code) or folder_map.get(DEFAULT_FOLDER_CODE)
