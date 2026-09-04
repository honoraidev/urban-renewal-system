from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

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


@router.post("/scan-invoice")
async def scan_invoice(
    file: UploadFile = File(...),
    project: Project = Depends(require_project_editor),
):
    """把一張發票照片交給 AI 辨識,回傳可帶入支出表單的欄位(不寫入資料庫)。"""
    from utils.invoice_ocr import InvoiceOcrError, extract_invoice_fields

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="沒有收到影像")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="檔案過大(上限 20MB)")
    try:
        return extract_invoice_fields(content, file.content_type)
    except InvoiceOcrError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


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
