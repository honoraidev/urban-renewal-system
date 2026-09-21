"""待辦事項「自動判斷重要 / 緊急」— 純規則式,不呼叫 AI。

案件總覽的待辦卡(徽章 + 排序)跟全站鈴鐺(緊急且重要才推播)共用這一份規則,
所以判斷條件只改這裡。每個判斷都回傳「原因」清單(空 = 不符合),前端拿來顯示提示。

  緊急 = 已逾期 / 2 天內到期 / 內容有「緊急、盡快、立即…」;
         SOP 項目則看案件本身:已經延遲,或離預計完成日 ≤ 30 天。
  重要 = 手動標了 ⭐ / 內容有「簽約、同意書、送件、審查…」;
         這階段還沒完成的 SOP 項目本身就是過關必要條件,一律算重要(下階段的不算)。
"""

import re
from datetime import date

URGENT_WORDS = re.compile(r"緊急|急件|盡快|儘快|立即|馬上|立刻|今天|逾期|催|asap", re.IGNORECASE)
IMPORTANT_WORDS = re.compile(
    r"簽約|同意書|送件|審查|核定|核准|申請|截止|說明會|反對|陳情|補件|公文|簽署|聽證|公聽會"
)

# 案件離預計完成日幾天內,SOP 項目就算緊急(對應 project_overview._risk_and_delay 的「中」風險)
DEADLINE_URGENT_DAYS = 30
# 自訂待辦幾天內到期算緊急(含今天)
DUE_URGENT_DAYS = 2


def todo_priority(event_date: date, content: str, is_important: bool, today: date) -> tuple[list[str], list[str]]:
    """自訂待辦(calendar_events)→ (緊急原因, 重要原因)。"""
    urgent: list[str] = []
    important: list[str] = []
    days = (event_date - today).days
    if days < 0:
        urgent.append(f"已逾期 {-days} 天")
    elif days == 0:
        urgent.append("今天到期")
    elif days <= DUE_URGENT_DAYS:
        urgent.append(f"{days} 天內到期")
    if URGENT_WORDS.search(content or ""):
        urgent.append("內容含緊急字眼")
    if is_important:
        important.append("已手動標為重要")
    if IMPORTANT_WORDS.search(content or ""):
        important.append("內容與簽約/送件/審查等關鍵事項有關")
    return urgent, important


def sop_task_priority(is_current: bool, delay_days: int, days_to_deadline: int | None) -> tuple[list[str], list[str]]:
    """SOP 關卡項目 → (緊急原因, 重要原因)。只有「這階段」的項目才有。"""
    if not is_current:
        return [], []
    urgent: list[str] = []
    if delay_days > 0:
        urgent.append(f"案件已延遲 {delay_days} 天")
    elif days_to_deadline is not None and days_to_deadline <= DEADLINE_URGENT_DAYS:
        urgent.append(f"距預計完成日只剩 {days_to_deadline} 天")
    return urgent, ["這階段的過關必要項目"]
