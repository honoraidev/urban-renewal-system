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
