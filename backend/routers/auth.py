from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_sys_admin
from models.login_log import LoginLog
from models.user import User
from schemas.auth import LoginLogRead, LoginRequest, ProfileUpdate, TokenResponse, UserInfo
from security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _record_login_event(db: Session, user_id: int, action: str, ip_address: str | None) -> None:
    db.add(LoginLog(user_id=user_id, action=action, ip_address=ip_address))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="wrong_password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account_deactivated")

    user.last_login_at = datetime.now(timezone.utc)
    _record_login_event(db, user.id, "login", _client_ip(request))
    db.commit()

    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _record_login_event(db, current_user.id, "logout", _client_ip(request))
    db.commit()


@router.get("/me", response_model=UserInfo)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserInfo)
def update_me(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """使用者自行編輯個人資料(顯示名稱 / Email / 電話 / 變更密碼)。變更密碼時必須先提供
    正確的目前密碼。username 與 role 不可自行修改。"""
    data = payload.model_dump(exclude_unset=True)

    if data.get("new_password"):
        if not verify_password(data.get("current_password") or "", current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="目前密碼不正確")
        current_user.password_hash = hash_password(data["new_password"])

    if "display_name" in data and data["display_name"]:
        current_user.display_name = data["display_name"].strip()
    if "email" in data:
        current_user.email = (data["email"] or "").strip() or None
    if "phone" in data:
        current_user.phone = (data["phone"] or "").strip() or None
    if "avatar" in data:
        av = (data["avatar"] or "").strip()
        if av and not av.startswith("data:image/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="頭像格式不正確")
        current_user.avatar = av or None

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/login-logs", response_model=list[LoginLogRead])
def list_login_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_sys_admin),
):
    rows = db.execute(
        select(LoginLog, User)
        .join(User, User.id == LoginLog.user_id)
        .order_by(LoginLog.occurred_at.desc())
    ).all()
    return [
        LoginLogRead(
            id=log.id,
            user_id=log.user_id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            action=log.action,
            occurred_at=log.occurred_at,
            ip_address=log.ip_address,
        )
        for log, user in rows
    ]
