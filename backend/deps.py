import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models.project import Project, ProjectMember
from models.user import User
from security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)

# L1/L2 - full access to every project, no ProjectMember row needed.
MANAGE_ROLES = {"sys_admin", "manager"}
# L1-L4 - can edit a project's general case data, but L3/L4 only for projects they're
# assigned to via ProjectMember.
EDIT_ROLES = MANAGE_ROLES | {"case_owner", "case_staff"}
# L1-L5 - can additionally use OCR/document-upload endpoints for their assigned projects.
OCR_ROLES = EDIT_ROLES | {"ocr_staff"}


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = payload.get("sub")
    user = db.get(User, int(user_id)) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


def require_sys_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "sys_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="L1 (sys_admin) role required")
    return user


def require_manager(user: User = Depends(get_current_user)) -> User:
    if user.role not in MANAGE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="L1/L2 (sys_admin/manager) role required")
    return user


def require_ocr_role(user: User = Depends(get_current_user)) -> User:
    """Role-only check (no project context) for the pre-project batch-import detection
    endpoints in ocr_intake.py, which run before the user has picked which project(s) a
    scanned batch even belongs to."""
    if user.role not in OCR_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OCR/editor role required")
    return user


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _is_project_member(db: Session, project_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
            )
        )
        is not None
    )


def require_project_viewer(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Project:
    """L1/L2 see every project; L3-L6 must be a ProjectMember of this one."""
    project = _get_project_or_404(db, project_id)
    if user.role in MANAGE_ROLES:
        return project
    if not _is_project_member(db, project_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this project")
    return project


def require_project_editor(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Project:
    """L1-L4 can edit a project's general case data; L3/L4 only if assigned to it."""
    project = _get_project_or_404(db, project_id)
    if user.role not in EDIT_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor role required")
    if user.role in MANAGE_ROLES:
        return project
    if not _is_project_member(db, project_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this project")
    return project


def require_project_ocr_editor(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Project:
    """L1-L5 can use OCR/document-upload endpoints; L3/L4/L5 only if assigned to it."""
    project = _get_project_or_404(db, project_id)
    if user.role not in OCR_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OCR/editor role required")
    if user.role in MANAGE_ROLES:
        return project
    if not _is_project_member(db, project_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this project")
    return project


def require_project_manager(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Project:
    """L1/L2-only project actions (force-complete, force-close, etc.) that still need a real project."""
    project = _get_project_or_404(db, project_id)
    if user.role not in MANAGE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="L1/L2 (sys_admin/manager) role required")
    return project
