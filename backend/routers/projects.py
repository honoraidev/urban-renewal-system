import os
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import (
    MANAGE_ROLES,
    get_current_user,
    require_manager,
    require_project_editor,
    require_project_manager,
    require_project_viewer,
)
from models.building_record import BuildingRecord
from models.land_record import LandRecord
from models.ocr import OcrJob
from models.project import Project, ProjectMember
from models.sop import SopStage
from models.user import User
from routers.contacts import _contactable_landowners_with_last_contact
from schemas.project import (
    BatchDeleteRequest,
    BatchDeleteResult,
    ConsentRatio,
    DashboardProjectItem,
    DashboardSummary,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectRead,
    ProjectUpdate,
)
from security import verify_password
from utils.consent_ratio import calculate_consent_ratio

router = APIRouter(prefix="/projects", tags=["projects"])


def get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def assert_project_visible(db: Session, project: Project, user: User) -> None:
    """Kept for other routers that already fetch `project` themselves and just need the
    check inline - logic mirrors deps.require_project_viewer, which new/updated
    endpoints should prefer instead since it also handles the 404."""
    if user.role in MANAGE_ROLES:
        return
    is_member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    )
    if is_member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this project")


def _alert_tier_counts(db: Session, project_id: int) -> dict[str, int]:
    """Buckets each contactable landowner into a follow-up urgency tier by days since
    last contact - not_contacted (never reached at all) counts as urgent regardless of
    elapsed time, same as the "always overdue" rule in contacts.py's _is_overdue."""
    landowners, last_contact_by_landowner = _contactable_landowners_with_last_contact(db, project_id)
    now = datetime.now(timezone.utc)
    counts = {"reminder": 0, "warning": 0, "urgent": 0}
    for owner in landowners:
        last_contact = last_contact_by_landowner.get(owner.id)
        if owner.contact_status == "not_contacted":
            counts["urgent"] += 1
            continue
        if last_contact is None:
            continue
        days = (now - last_contact).days
        if days >= 30:
            counts["urgent"] += 1
        elif days >= 14:
            counts["warning"] += 1
        elif days >= 7:
            counts["reminder"] += 1
    return counts


def _case_handler_names(db: Session, project_id: int) -> tuple[str | None, str | None]:
    """First case_staff/case_owner and first manager/sys_admin assigned to the project
    (by assigned_at) - display-only "who's on this case" for the dashboard card, not an
    access-control list (see MANAGE_ROLES/EDIT_ROLES in deps.py for the real thing)."""
    rows = db.execute(
        select(User.display_name, User.role)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.assigned_at)
    ).all()
    handler = next((name for name, role in rows if role in ("case_staff", "case_owner")), None)
    manager = next((name for name, role in rows if role in ("manager", "sys_admin")), None)
    return handler, manager


@router.get("/dashboard-summary", response_model=DashboardSummary)
def get_dashboard_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role not in MANAGE_ROLES:
        member_project_ids = db.scalars(
            select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        ).all()
        projects_stmt = select(Project).where(Project.id.in_(member_project_ids)).order_by(Project.created_at.desc())
    else:
        projects_stmt = select(Project).order_by(Project.created_at.desc())
    projects = db.scalars(projects_stmt).all()
    project_ids = [p.id for p in projects]

    land_counts = dict(
        db.execute(
            select(LandRecord.project_id, func.count(LandRecord.id))
            .where(LandRecord.project_id.in_(project_ids))
            .group_by(LandRecord.project_id)
        ).all()
    )
    building_counts = dict(
        db.execute(
            select(BuildingRecord.project_id, func.count(BuildingRecord.id))
            .where(BuildingRecord.project_id.in_(project_ids))
            .group_by(BuildingRecord.project_id)
        ).all()
    )

    # Latest OCR job per project - used for the per-project status badge (OCR中/needs
    # review/complete) and rolled up into pending_ai_review_count below.
    latest_job_by_project: dict[int, OcrJob] = {}
    for job in db.scalars(
        select(OcrJob).where(OcrJob.project_id.in_(project_ids)).order_by(OcrJob.created_at.desc())
    ):
        latest_job_by_project.setdefault(job.project_id, job)

    pending_ai_review_count = (
        db.scalar(
            select(func.count(OcrJob.id)).where(
                OcrJob.project_id.in_(project_ids),
                or_(OcrJob.status == "failed", (OcrJob.status == "completed") & OcrJob.error_message.isnot(None)),
            )
        )
        or 0
    )

    project_items = []
    for p in projects:
        ratio = calculate_consent_ratio(db, p.id, p.current_stage)
        alert_tiers = _alert_tier_counts(db, p.id)
        handler_name, manager_name = _case_handler_names(db, p.id)
        project_items.append(
            DashboardProjectItem(
                id=p.id,
                name=p.name,
                project_code=p.project_code,
                city=p.city,
                district=p.district,
                status=p.status,
                land_record_count=land_counts.get(p.id, 0),
                building_record_count=building_counts.get(p.id, 0),
                latest_ocr_job_status=latest_job_by_project[p.id].status if p.id in latest_job_by_project else None,
                latest_ocr_job_has_warning=bool(latest_job_by_project[p.id].error_message)
                if p.id in latest_job_by_project
                else False,
                current_stage=p.current_stage,
                headcount_ratio=ratio["headcount_ratio"],
                land_share_ratio=ratio["land_share_ratio"],
                building_share_ratio=ratio["building_share_ratio"],
                reminder_count=alert_tiers["reminder"],
                warning_count=alert_tiers["warning"],
                urgent_count=alert_tiers["urgent"],
                case_handler_name=handler_name,
                case_manager_name=manager_name,
            )
        )

    return DashboardSummary(
        project_count=len(projects),
        land_record_count=sum(land_counts.values()),
        building_record_count=sum(building_counts.values()),
        pending_ai_review_count=pending_ai_review_count,
        ai_online=bool(settings.OPENAI_API_KEY),
        projects=project_items,
    )


@router.get("", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role not in MANAGE_ROLES:
        stmt = (
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == current_user.id)
            .order_by(Project.created_at.desc())
        )
    else:
        stmt = select(Project).order_by(Project.created_at.desc())
    return db.scalars(stmt).all()


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in MANAGE_ROLES | {"case_owner"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="L1/L2/L3 role required")

    existing = db.scalar(select(Project).where(Project.project_code == payload.project_code))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="project_code already exists")

    project = Project(**payload.model_dump(), created_by=current_user.id, current_stage=0)
    db.add(project)
    db.flush()

    # Stage 0 (初始核定立案) has its own real checklist (template uploads) that must be
    # completed before advancing - it is NOT pre-completed at creation time (see
    # routers/sop.py's build_initial_stage_data/STAGE_CHECKLIST_REQUIREMENTS).
    db.add(SopStage(project_id=project.id, stage_data=_initial_stage_data(), current_stage=0))

    if current_user.role == "case_owner":
        # Otherwise an L3 who just created this project couldn't see it themselves -
        # require_project_viewer/editor require ProjectMember for non-manager roles.
        db.add(ProjectMember(project_id=project.id, user_id=current_user.id, role_in_project=current_user.role))

    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project: Project = Depends(require_project_viewer)):
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


@router.post("/batch-delete", response_model=BatchDeleteResult)
def batch_delete_projects(
    payload: BatchDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Deletes several projects at once - same irreversible cascade delete as
    delete_project() below, applied per project. Requires re-entering a real L1/L2
    account's username/password in the request body as an extra confirmation step on
    top of already holding an L1/L2 JWT (require_manager) - this guards against e.g. an
    already-unlocked manager browser tab being used for a bulk delete by whoever is
    physically at the keyboard. The password mismatch case uses 403, not 401: the
    frontend treats any 401 as "session expired" and force-logs-out the current user,
    which would be wrong here since the JWT itself is still perfectly valid."""
    admin_user = db.scalar(select(User).where(User.username == payload.admin_username))
    if admin_user is None or admin_user.role not in MANAGE_ROLES or not verify_password(payload.admin_password, admin_user.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="管理者帳號或密碼錯誤")

    deleted_ids: list[int] = []
    not_found_ids: list[int] = []
    for project_id in payload.project_ids:
        project = db.get(Project, project_id)
        if project is None:
            not_found_ids.append(project_id)
            continue
        upload_dir = os.path.join(settings.UPLOAD_DIR, project.project_code)
        if os.path.isdir(upload_dir):
            shutil.rmtree(upload_dir, ignore_errors=True)
        db.delete(project)
        deleted_ids.append(project_id)
    db.commit()
    return BatchDeleteResult(deleted_ids=deleted_ids, not_found_ids=not_found_ids)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_manager),
):
    """Permanently deletes a project and everything under it (landowners, land/building
    records, contact logs, consent records, documents, expenses, SOP progress) via
    ON DELETE CASCADE. L1/L2-only and irreversible - the frontend requires re-typing
    the project code before calling this."""
    upload_dir = os.path.join(settings.UPLOAD_DIR, project.project_code)
    if os.path.isdir(upload_dir):
        shutil.rmtree(upload_dir, ignore_errors=True)
    db.delete(project)
    db.commit()


@router.get("/{project_id}/consent-ratio", response_model=ConsentRatio)
def get_consent_ratio(
    stage: int | None = None,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    if stage is None:
        stage = next((s for s in (4, 8, 9) if s >= project.current_stage), 9)

    return calculate_consent_ratio(db, project.id, stage)


@router.get("/{project_id}/members", response_model=list[ProjectMemberRead])
def list_project_members(db: Session = Depends(get_db), project: Project = Depends(require_project_viewer)):
    rows = db.execute(
        select(ProjectMember, User.username, User.display_name)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
        .order_by(ProjectMember.assigned_at)
    ).all()
    return [
        ProjectMemberRead(
            id=member.id,
            user_id=member.user_id,
            username=username,
            display_name=display_name,
            role_in_project=member.role_in_project,
            assigned_at=member.assigned_at,
        )
        for member, username, display_name in rows
    ]


@router.post("/{project_id}/members", response_model=ProjectMemberRead, status_code=status.HTTP_201_CREATED)
def add_project_member(
    payload: ProjectMemberCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_manager),
):
    user = db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already a member of this project")

    member = ProjectMember(project_id=project.id, user_id=user.id, role_in_project=user.role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return ProjectMemberRead(
        id=member.id,
        user_id=member.user_id,
        username=user.username,
        display_name=user.display_name,
        role_in_project=member.role_in_project,
        assigned_at=member.assigned_at,
    )


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(
    user_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_manager),
):
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user_id
        )
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    db.delete(member)
    db.commit()


def _initial_stage_data() -> dict:
    from routers.sop import build_initial_stage_data

    return build_initial_stage_data()
