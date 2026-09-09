import anyio
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import get_current_user, require_manager, require_project_editor, require_project_staff_viewer
from models.expense import Expense, ExpenseCategory
from models.project import Project
from models.user import User
from schemas.expense import (
    ExpenseCategoryCreate,
    ExpenseCategoryRead,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseRead,
    ExpenseSummary,
    ExpenseSummaryItem,
    ExpenseUpdate,
)

router = APIRouter(prefix="/projects/{project_id}/expenses", tags=["expenses"])
category_router = APIRouter(prefix="/expense-categories", tags=["expense-categories"])


# 發票辨識是重運算(本機 PaddleOCR)或外呼(Gemini),都可能慢或整個卡死。限制同時
# 只跑 2 個、單次上限 90 秒,免得使用者連點把 threadpool 佔滿,連登入都排不到 worker
# (實際發生過:PaddleOCR 在無 GPU 的 NAS 卡住,整站無回應直到 restart)。
_SCAN_INVOICE_LIMITER = anyio.CapacityLimiter(2)
_SCAN_INVOICE_TIMEOUT_S = 90


@router.post("/scan-invoice")
async def scan_invoice(
    file: UploadFile = File(...),
    project: Project = Depends(require_project_editor),
):
    """把一張發票照片交給 AI 辨識,回傳可帶入支出表單的欄位(不寫入資料庫)。"""
    import traceback

    from utils.invoice_ocr import InvoiceOcrError, extract_invoice_fields

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到影像")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="檔案過大(上限 20MB)")
    try:
        async with _SCAN_INVOICE_LIMITER:
            with anyio.fail_after(_SCAN_INVOICE_TIMEOUT_S):
                if settings.OCR_REMOTE_URL:
                    # 轉發到遠端 OCR 服務(ocr_service.py,跑在有 GPU 的機器上)。NAS
                    # 本機完全不跑 PaddleOCR。httpx 是 async,不佔 threadpool。
                    async with httpx.AsyncClient(timeout=_SCAN_INVOICE_TIMEOUT_S) as client:
                        resp = await client.post(
                            settings.OCR_REMOTE_URL.rstrip("/") + "/invoice",
                            files={"file": (
                                file.filename or "invoice",
                                content,
                                file.content_type or "application/octet-stream",
                            )},
                            headers={"X-OCR-Secret": settings.OCR_REMOTE_SECRET},
                        )
                    if resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
                        raise InvoiceOcrError(resp.json().get("detail") or "辨識失敗")
                    resp.raise_for_status()
                    return resp.json()
                # 沒設遠端:本機跑(受 INVOICE_ALLOW_LOCAL_OCR 保護)。阻塞運算丟
                # threadpool;外層 limiter 已限制併發,這裡不再另外傳 limiter。
                return await anyio.to_thread.run_sync(
                    extract_invoice_fields, content, file.content_type,
                    abandon_on_cancel=True,
                )
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="辨識逾時,請稍後再試,或改掃電子發票證明聯上的 QR code",
        ) from exc
    except InvoiceOcrError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        print(f"[scan-invoice] 遠端 OCR 服務錯誤:{exc!r}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="遠端辨識服務暫時無法使用,請稍後再試或手動輸入",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - 回一個看得懂的訊息,別讓前端只看到 "Error"
        print("[scan-invoice] 未預期錯誤:\n" + traceback.format_exc(), flush=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"辨識時發生錯誤:{type(exc).__name__}: {exc}",
        ) from exc


@router.post("/scan-invoice-batch")
async def scan_invoice_batch(
    files: list[UploadFile] = File(...),
    project: Project = Depends(require_project_editor),
):
    """批次匯入用:一次辨識多個檔案(多張照片,或內含多頁/多張發票的一份 PDF),
    每個檔案可能展開成不只一張發票(多頁 PDF 逐頁算、一張照片裡的多個電子發票 QR
    也各算一筆)。不寫入資料庫 —— 前端把結果列成審核清單,使用者確認過才逐筆
    呼叫 POST 建立支出。單一檔案/單頁讀失敗不中斷整批,錯誤會附在該筆結果裡。"""
    import traceback

    from utils.invoice_ocr import InvoiceOcrError, extract_invoices_multi

    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到檔案")
    if len(files) > 20:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="一次最多 20 個檔案,請分批上傳")

    payload = []
    total_bytes = 0
    for f in files:
        content = await f.read()
        total_bytes += len(content)
        if total_bytes > 60 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="檔案總大小過大(上限 60MB)")
        payload.append((f.filename or "invoice", content, f.content_type))

    # 檔案數愈多要跑的辨識愈多,逾時上限跟著放寬(但總量還是有上限,別讓一批卡死 worker)。
    timeout_s = min(600, 30 + 20 * len(payload))
    results: list[dict] = []
    try:
        async with _SCAN_INVOICE_LIMITER:
            with anyio.fail_after(timeout_s):
                if settings.OCR_REMOTE_URL:
                    async with httpx.AsyncClient(timeout=timeout_s) as client:
                        resp = await client.post(
                            settings.OCR_REMOTE_URL.rstrip("/") + "/invoice-batch",
                            files=[
                                ("files", (name, content, ctype or "application/octet-stream"))
                                for name, content, ctype in payload
                            ],
                            headers={"X-OCR-Secret": settings.OCR_REMOTE_SECRET},
                        )
                    resp.raise_for_status()
                    results = resp.json().get("results", [])
                else:
                    # 沒設遠端:本機逐檔跑(受 INVOICE_ALLOW_LOCAL_OCR 保護)。
                    for name, content, ctype in payload:
                        try:
                            invoices = await anyio.to_thread.run_sync(
                                extract_invoices_multi, content, ctype, abandon_on_cancel=True,
                            )
                            for inv in invoices:
                                inv["source_filename"] = name
                                results.append(inv)
                        except InvoiceOcrError as exc:
                            results.append({"source_filename": name, "page": 1, "error": str(exc)})
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="批次辨識逾時,請減少張數或分批上傳",
        ) from exc
    except httpx.HTTPError as exc:
        print(f"[scan-invoice-batch] 遠端 OCR 服務錯誤:{exc!r}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="遠端辨識服務暫時無法使用,請稍後再試或手動輸入",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        print("[scan-invoice-batch] 未預期錯誤:\n" + traceback.format_exc(), flush=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"辨識時發生錯誤:{type(exc).__name__}: {exc}",
        ) from exc

    return {"results": results}


def get_expense_or_404(db: Session, project_id: int, expense_id: int) -> Expense:
    expense = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.project_id == project_id))
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return expense


@router.get("", response_model=list[ExpenseRead])
def list_expenses(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    expenses = db.scalars(
        select(Expense).where(Expense.project_id == project.id).order_by(Expense.expense_date.desc())
    ).all()
    users = db.scalars(select(User)).all()
    user_names = {u.id: u.display_name or u.username for u in users}
    res = []
    for ex in expenses:
        item = ExpenseRead.model_validate(ex)
        item.creator_name = user_names.get(ex.created_by, "陳建宏") if ex.created_by else "陳建宏"
        res.append(item)
    return res


@router.post("", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    expense = Expense(project_id=project.id, created_by=current_user.id, **payload.model_dump())
    db.add(expense)
    db.commit()
    db.refresh(expense)
    res = ExpenseRead.model_validate(expense)
    res.creator_name = current_user.display_name or current_user.username
    return res


@router.get("/summary", response_model=ExpenseSummary)
def expense_summary(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    project_id = project.id
    total = float(
        db.scalar(select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.project_id == project_id)) or 0
    )

    rows = db.execute(
        select(
            ExpenseCategory.id, ExpenseCategory.name, func.coalesce(func.sum(Expense.amount), 0)
        )
        .select_from(Expense)
        .join(ExpenseCategory, Expense.category_id == ExpenseCategory.id, isouter=True)
        .where(Expense.project_id == project_id)
        .group_by(ExpenseCategory.id, ExpenseCategory.name)
    ).all()

    by_category = [
        ExpenseSummaryItem(category_id=row[0], category_name=row[1], total_amount=float(row[2]))
        for row in rows
    ]

    return ExpenseSummary(total_amount=total, by_category=by_category)


@router.patch("/{expense_id}", response_model=ExpenseRead)
def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    expense = get_expense_or_404(db, project.id, expense_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(expense, field, value)
    db.commit()
    db.refresh(expense)
    res = ExpenseRead.model_validate(expense)
    user = db.get(User, expense.created_by) if expense.created_by else None
    res.creator_name = (user.display_name or user.username) if user else "-"
    return res


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    expense = get_expense_or_404(db, project.id, expense_id)
    db.delete(expense)
    db.commit()


DEFAULT_CATEGORIES = ["說明會費用", "估價師", "建築師", "顧問公司", "調閱謄本", "應酬費", "代書", "鑑界費"]


@category_router.get("", response_model=list[ExpenseCategoryRead])
def list_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cats = db.scalars(select(ExpenseCategory).order_by(ExpenseCategory.id)).all()
    if not cats:
        for name in DEFAULT_CATEGORIES:
            db.add(ExpenseCategory(name=name, is_active=True))
        db.commit()
        cats = db.scalars(select(ExpenseCategory).order_by(ExpenseCategory.id)).all()
    return cats


@category_router.post("", response_model=ExpenseCategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: ExpenseCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    existing = db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category name already exists")
    category = ExpenseCategory(**payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@category_router.patch("/{category_id}", response_model=ExpenseCategoryRead)
def update_category(
    category_id: int,
    payload: ExpenseCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    category = db.get(ExpenseCategory, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


@category_router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    category = db.get(ExpenseCategory, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    db.delete(category)
    db.commit()
