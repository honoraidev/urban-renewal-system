"""Turns a raw (method, path) into a human-readable Chinese label for the activity
feed, and pulls the project id out of the path when present. Used by the activity
logging middleware in main.py - deliberately path-based so it covers the whole API
without每個 endpoint 自己埋點."""

import re

# (method or "*", compiled path regex, label). First match wins, so put the more
# specific patterns first. {id} segments are \d+.
_P = r"/projects/(?P<pid>\d+)"
_LO = _P + r"/landowners/(?P<lid>\d+)"

_RAW_RULES: list[tuple[str, str, str]] = [
    ("POST", _LO + r"/contacts$", "新增聯絡紀錄"),
    ("POST", _LO + r"/land-records$", "新增土地標示"),
    ("PATCH", _LO + r"/land-records/\d+$", "修改土地標示"),
    ("DELETE", _LO + r"/land-records/\d+$", "刪除土地標示"),
    ("POST", _LO + r"/building-records$", "新增建物標示"),
    ("PATCH", _LO + r"/building-records/\d+$", "修改建物標示"),
    ("DELETE", _LO + r"/building-records/\d+$", "刪除建物標示"),
    ("POST", _LO + r"/merge$", "合併地主"),
    ("PATCH", _LO + r"$", "修改地主資料"),
    ("DELETE", _LO + r"$", "刪除地主"),
    ("POST", _P + r"/landowners$", "新增地主"),
    ("POST", _P + r"/documents$", "上傳文件"),
    ("POST", _P + r"/documents/from-images$", "上傳文件（影像）"),
    ("DELETE", _P + r"/documents/\d+$", "刪除文件"),
    ("POST", _P + r"/documents/cleanup-duplicates$", "清理重複文件"),
    ("POST", _P + r"/ocr/title-deed$", "OCR 辨識謄本"),
    ("POST", _P + r"/ocr/split-pages$", "OCR 分頁"),
    ("POST", _P + r"/sop/force-close$", "強制結案"),
    ("POST", _P + r"/sop/\d+/complete$", "SOP 過關"),
    ("POST", _P + r"/sop/\d+/checklist$", "SOP 勾選查核項目"),
    ("POST", _P + r"/sop/\d+/form$", "SOP 儲存表單"),
    ("POST", _P + r"/sop/\d+/consent$", "登錄同意書"),
    ("POST", _P + r"/expenses$", "新增費用"),
    ("PATCH", _P + r"/expenses/\d+$", "修改費用"),
    ("DELETE", _P + r"/expenses/\d+$", "刪除費用"),
    ("POST", _P + r"/encumbrances$", "新增他項權利"),
    ("PATCH", _P + r"/encumbrances/\d+$", "修改他項權利"),
    ("DELETE", _P + r"/encumbrances/\d+$", "刪除他項權利"),
    ("POST", _P + r"/members$", "新增案件成員"),
    ("DELETE", _P + r"/members/\d+$", "移除案件成員"),
    ("PATCH", _P + r"$", "修改案件資料"),
    ("DELETE", _P + r"$", "刪除案件"),
    ("POST", r"/projects$", "建立案件"),
    ("POST", r"/projects/batch-delete$", "批量刪除案件"),
    ("POST", r"/dashboard/calendar$", "新增行事曆備註"),
    ("PATCH", r"/dashboard/calendar/\d+$", "修改行事曆備註"),
    ("DELETE", r"/dashboard/calendar/\d+$", "刪除行事曆備註"),
    ("*", r"/users$", "使用者管理"),
    ("*", r"/users/\d+$", "使用者管理"),
    ("*", r"/auth/me$", "更新個人資料"),
    ("*", r"/companydocs", "公版文件維護"),
    ("*", r"/regulations", "法規維護"),
    ("*", r"/websites", "網站維護"),
    ("*", r"/faq", "知識庫維護"),
]

_RULES = [(m, re.compile("^" + p), label) for m, p, label in _RAW_RULES]

# Paths that are mutating in HTTP terms but not worth showing in an activity feed.
_IGNORE = re.compile(r"^/(auth/(login|logout)|dashboard/my-work)")


def describe_request(method: str, path: str) -> tuple[str | None, int | None]:
    """Returns (label, project_id). label is None when the request should not be logged."""
    if _IGNORE.match(path):
        return None, None
    project_id: int | None = None
    m = re.match(r"^/projects/(\d+)", path)
    if m:
        project_id = int(m.group(1))
    for rule_method, rule_re, label in _RULES:
        if rule_method not in ("*", method):
            continue
        match = rule_re.match(path)
        if match:
            if project_id is None and "pid" in match.groupdict() and match.group("pid"):
                project_id = int(match.group("pid"))
            return label, project_id
    # Fallback: still record it, just with a generic label.
    return f"{method} {path}", project_id
