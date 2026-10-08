"""分部(桃園 / 台北)共用規則 —— 公版文件與案件的可見度都用這份。

分部由使用者的「部門」判斷:部門名稱含「桃園」→ taoyuan;其他任何部門 → taipei。
同時有兩邊部門的人兩邊都看得到;沒有任何部門的人只看得到 branch=all(共用)的資料。
只有 L0 系統管理員不受限制。
"""
from sqlalchemy import or_

from models.user import User

BRANCHES = {"all", "taoyuan", "taipei"}


def user_branches(user: User) -> set[str]:
    out: set[str] = set()
    for d in user.departments or []:
        name = str(d or "")
        if not name.strip():
            continue
        out.add("taoyuan" if "桃園" in name else "taipei")
    return out


def branch_for_new_record(user: User) -> str:
    """新建資料(案件、公版文件)的分部:建立者只屬一個分部 → 那個分部;兩邊都有或沒部門 → all。"""
    mine = user_branches(user)
    return next(iter(mine)) if len(mine) == 1 else "all"


def branch_visible(branch: str | None, user: User) -> bool:
    if user.role == "sys_admin":
        return True
    b = branch or "all"
    return b == "all" or b in user_branches(user)


def branch_clause(column, user: User):
    """SQLAlchemy where 條件;L0 回傳 None(不過濾)。"""
    if user.role == "sys_admin":
        return None
    mine = list(user_branches(user))
    conds = [column.is_(None), column == "all"]
    if mine:
        conds.append(column.in_(mine))
    return or_(*conds)


def recompute_project_branch(db, project_id: int) -> str | None:
    """案件所屬分部 = 依「案件人員」的部門自動判斷:成員(不含沒有部門的人,如 L0)只涵蓋一個分部 → 那個分部;
    涵蓋兩個分部或沒有任何成員有部門 → all。成員增減時、啟動時都會重算,所以把某人移出案件人員,分部也會跟著變。
    回傳新的分部;案件不存在回傳 None。"""
    from sqlalchemy import select

    from models.project import Project, ProjectMember

    project = db.get(Project, project_id)
    if project is None:
        return None
    users = db.scalars(select(User).join(ProjectMember, ProjectMember.user_id == User.id).where(ProjectMember.project_id == project_id)).all()
    seen: set[str] = set()
    for u in users:
        seen |= user_branches(u)
    new = next(iter(seen)) if len(seen) == 1 else "all"
    if (project.branch or "all") != new:
        project.branch = new
    return new
