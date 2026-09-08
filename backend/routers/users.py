from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_manager, require_sys_admin
from models.user import User
from schemas.user import UserActiveUpdate, UserCreate, UserRead, UserUpdate
from security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _active_sys_admin_count(db: Session, exclude_user_id: int | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "sys_admin", User.is_active == True)  # noqa: E712
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return db.scalar(stmt) or 0


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    return db.scalars(select(User).order_by(User.created_at)).all()


@router.get("/directory")
def user_directory(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """輕量的「部門 → 人」名冊,任何登入者可讀(物品管制表的保管人/領用人選單用)。
    只回姓名與所屬部門,不含帳號、角色等敏感欄位。"""
    users = db.scalars(
        select(User).where(User.is_active == True).order_by(User.display_name)  # noqa: E712
    ).all()
    return [{"display_name": u.display_name, "departments": u.departments or []} for u in users]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_sys_admin),
):
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        role=payload.role,
        email=payload.email,
        phone=payload.phone,
        departments=payload.departments or None,
        titles=payload.titles or None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager)):
    return get_user_or_404(db, user_id)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_sys_admin),
):
    user = get_user_or_404(db, user_id)
    data = payload.model_dump(exclude_unset=True)

    if "role" in data and data["role"] != "sys_admin" and user.role == "sys_admin":
        if _active_sys_admin_count(db, exclude_user_id=user.id) < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change role: at least one active L0 系統管理員 must remain",
            )

    if "password" in data:
        password = data.pop("password")
        if password:
            user.password_hash = hash_password(password)

    for field, value in data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/active", response_model=UserRead)
def set_user_active(
    user_id: int,
    payload: UserActiveUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_sys_admin),
):
    user = get_user_or_404(db, user_id)

    if not payload.is_active and user.role == "sys_admin" and _active_sys_admin_count(db, exclude_user_id=user.id) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate the last active L0 系統管理員 account",
        )

    user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_sys_admin),
):
    user = get_user_or_404(db, user_id)

    if user.role == "sys_admin" and _active_sys_admin_count(db, exclude_user_id=user.id) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the last active L0 系統管理員 account",
        )

    db.delete(user)
    db.commit()
