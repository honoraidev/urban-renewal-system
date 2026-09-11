"""地主清冊 Excel 匯出 - 版面依 clientside「清冊範本」(範本.pdf):兩列表頭(群組列 +
欄位列),一列資料 = 一筆土地登記(地號 × 所有權人),對應建物依號碼比對帶入。

群組:土地標示部 / 土地所有權部 / 土地他項權利部 / 建物標示部 / 建物所有權部 / 建物他項權利部 / 共有建號。
他項權利部只出「他項權利人 / 擔保債權總金額」兩欄,靠所有權部的「相關他項權利登記次序」對到該列
(沒有這一行 = 該所有權人沒有他項權利,留白);同一人有多筆時權利人用「、」串接、金額加總。

「建物標示部」的「層次面積(㎡)」欄組**依每個案件的實際樓層客製化**:掃過該案件所有
建物的「層數 / 層次」,地上最高到 N 層就出 1F~NF、地下最深到 M 層就出「地下1F~地下MF」,
平台 / 陽臺 / 騎樓層次一律出;只有在真的出現屋突 / 夾層 / 認不出來的樓層時,才多補一欄
「其他層次」。這樣「建物總面積 = Σ層次各格 + 附屬建物總面積」「權狀面積 = 建物總面積 +
共有持分」在匯出檔裡每一列都對得起來(以前欄位寫死 1F~7F,地下層直接被丟掉,加總就對不上)。
"""

import io
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PING_PER_SQM = 0.3025

# 「層次面積」欄組前面、固定不變的欄位(群組, 標題)
_COLS_HEAD: list[tuple[str, str]] = [
    ("土地標示部", "土地清冊編號"),
    ("土地標示部", "鄉鎮市區"),
    ("土地標示部", "地段"),
    ("土地標示部", "小段"),
    ("土地標示部", "地號"),
    ("土地標示部", "土地面積(㎡)"),
    ("土地所有權部", "登記次序"),
    ("土地所有權部", "所有權人"),
    ("土地所有權部", "統一編號"),
    ("土地所有權部", "權利範圍(分子)"),
    ("土地所有權部", "權利範圍(分母)"),
    ("土地所有權部", "持分面積(㎡)"),
    ("土地所有權部", "持分面積(坪)"),
    ("土地所有權部", "所有權人戶籍地址"),
    ("土地他項權利部", "他項權利人"),
    ("土地他項權利部", "擔保債權總金額"),
    ("建物標示部", "建號"),
    ("建物標示部", "建號門牌"),
    ("建物標示部", "坐落地號"),
    ("建物標示部", "層數"),
    ("建物標示部", "層次"),
    ("建物標示部", "建物總面積(㎡)"),
    ("建物標示部", "附屬建物總面積(㎡)"),
    ("建物標示部", "共有建號持分面積"),
    ("建物標示部", "權狀面積(㎡)"),
]
_HEAD_BLD_COLS = 9  # 建號 … 權狀面積(㎡):_bld_std_cells 回傳的前 9 欄

# 「層次面積」欄組後面的固定附屬欄(建物標示部尾)
_COLS_ACCESSORY: list[tuple[str, str]] = [
    ("建物標示部", "附屬建物(㎡)平台"),
    ("建物標示部", "附屬建物(㎡)陽臺"),
    ("建物標示部", "防空避難室"),
]

# 「層次面積」欄組後面、固定不變的欄位
_COLS_TAIL: list[tuple[str, str]] = [
    ("建物所有權部", "登記次序"),
    ("建物所有權部", "所有權人"),
    ("建物所有權部", "統一編號"),
    ("建物所有權部", "權利範圍(分子)"),
    ("建物所有權部", "權利範圍(分母)"),
    ("建物所有權部", "持份權狀面積(㎡)"),
    ("建物所有權部", "持份權狀面積(坪)"),
    ("建物所有權部", "所有權人戶籍地址"),
    ("建物他項權利部", "他項權利人"),
    ("建物他項權利部", "擔保債權總金額"),
    ("共有建號", "共有建號"),
    ("共有建號", "共有面積"),
    ("共有建號", "共有權利範圍(分子)"),
    ("共有建號", "共有權利範圍(分母)"),
    ("共有建號", "持分面積(㎡)"),
    ("共有建號", "持分面積(坪)"),
]


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _parse_cn_int(tok: str):
    """「一」「12」「005」「十一」「二十」-> int,認不出回 None。"""
    tok = (tok or "").strip()
    if tok.isdigit():
        return int(tok)
    if tok in _CN_NUM:
        return _CN_NUM[tok]
    if tok == "十":
        return 10
    if len(tok) == 2 and tok[0] == "十" and tok[1] in _CN_NUM:
        return 10 + _CN_NUM[tok[1]]
    if len(tok) == 2 and tok[1] == "十" and tok[0] in _CN_NUM:
        return _CN_NUM[tok[0]] * 10
    return None


# 層次(非數字樓層)裡、範本有獨立欄位的幾種;順序即欄位順序
_LAYER_L_KINDS: list[tuple[str, tuple[str, ...]]] = [
    ("平台", ("平台", "平臺")),
    ("陽臺", ("陽台", "陽臺")),
    ("騎樓", ("騎樓",)),
]

# OCR 髒資料保險:層次欄最多開到這麼多層,超過的併進「其他層次」
_MAX_FLOOR_COLS = 40


def _classify_floor(name: str) -> tuple:
    """floors_detail 的樓層名 -> 版面 key:
      ("F", n)     地上第 n 層
      ("L", 平台/陽臺/騎樓)  非數字層次
      ("B", n)     地下第 n 層(沒帶數字的「地下層」當地下一層)
      ("OTHER",)   屋突 / 夾層 / 認不出來 / 超出上限 —— 併進「其他層次」(僅在真的有這種樓層時才出欄)
    """
    s = re.sub(r"\s+", "", str(name or ""))
    for tag, kws in _LAYER_L_KINDS:
        if any(k in s for k in kws):
            return ("L", tag)
    if "地下" in s:
        m = re.search(r"地下([一二三四五六七八九十0-9]+)", s)
        n = _parse_cn_int(m.group(1)) if m else None
        if n and 1 <= n <= _MAX_FLOOR_COLS:
            return ("B", n)
        return ("OTHER",) if m else ("B", 1)  # 「地下層」沒帶數字 -> 地下一層
    m = re.match(r"([一二三四五六七八九十0-9]+)層?", s)
    n = _parse_cn_int(m.group(1)) if m else None
    return ("F", n) if n and 1 <= n <= _MAX_FLOOR_COLS else ("OTHER",)


def _parse_total_floors(text: str) -> tuple[int, int]:
    """『層數』欄 -> (地上最高層, 地下最深層)。吃得下 '005' / '五層' /
    '地上5層地下2層' / '地上七層' 等寫法。"""
    s = re.sub(r"\s+", "", str(text or ""))
    if not s:
        return (0, 0)
    below = 0
    mb = re.search(r"地下([一二三四五六七八九十0-9]+)層?", s)
    if mb:
        below = _parse_cn_int(mb.group(1)) or 0
    above = 0
    ma = re.search(r"地上([一二三四五六七八九十0-9]+)層?", s)
    if ma:
        above = _parse_cn_int(ma.group(1)) or 0
    if not above:
        s2 = s.replace(mb.group(0), "") if mb else s  # 去掉「地下N層」再找地上層數
        m = re.search(r"([一二三四五六七八九十0-9]+)層?", s2)
        if m:
            above = _parse_cn_int(m.group(1)) or 0
        elif s2.isdigit():
            above = int(s2)
    return (min(above, _MAX_FLOOR_COLS), min(below, _MAX_FLOOR_COLS))


def _layer_layout(building_records: list) -> list[tuple[tuple, str]]:
    """掃過(已過濾的)建物 records,決定這個案件「層次面積」欄組要有哪些欄、順序為何。
    回傳 [(key, header), …],key 同 _classify_floor 的回傳值。
    地上最高 N 層 → 1F~NF、地下最深 M 層 → 地下1F~地下MF;平台 / 陽臺 / 騎樓層次一律開;
    只有在真的出現屋突 / 夾層 / 認不出來的樓層時,才在最後補一欄「其他層次」。"""
    max_f = max_b = 0
    has_other = False
    for b in building_records:
        af, bf = _parse_total_floors(getattr(b, "total_floors", None))
        max_f, max_b = max(max_f, af), max(max_b, bf)
        for fd in getattr(b, "floors_detail", None) or []:
            if not isinstance(fd, dict):
                continue
            kind, val = (_classify_floor(fd.get("floor")) + (None,))[:2]
            if kind == "F" and val:
                max_f = max(max_f, val)
            elif kind == "B" and val:
                max_b = max(max_b, val)
            elif kind == "OTHER":
                has_other = True

    slots: list[tuple[tuple, str]] = [(("F", i), f"層次面積(㎡){i}F") for i in range(1, max_f + 1)]
    slots += [(("L", tag), f"層次面積(㎡){tag}") for tag, _ in _LAYER_L_KINDS]
    slots += [(("B", i), f"層次面積(㎡)地下{i}F") for i in range(1, max_b + 1)]
    if has_other:
        slots.append((("OTHER",), "層次面積(㎡)其他層次"))
    return slots


def _accessory_slot(use: str):
    """附屬建物用途 -> _COLS_ACCESSORY 裡的 index(0=平台, 1=陽臺, 2=防空避難室)。"""
    s = re.sub(r"\s+", "", str(use or ""))
    if "平台" in s or "平臺" in s:
        return 0
    if "陽台" in s or "陽臺" in s:
        return 1
    if "防空" in s or "避難" in s:
        return 2
    return None


def _num(v):
    """數值正規化:能轉數字就回(整數就給 int,否則四捨五入到小數第 2 位),否則 None。"""
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def _ping(sqm) -> float | str:
    """㎡ -> 坪,四捨五入到小數第 2 位。"""
    n = _num(sqm)
    return round(n * PING_PER_SQM, 2) if n is not None else ""


def _is_common_part(b) -> bool:
    return (getattr(b, "main_use", None) or "").strip() == "共有部分" or bool(
        getattr(b, "common_part_shares", None)
    )


def _common_share_map(common_records: list) -> dict:
    """{ 主建物建號(純數字) -> [ (共有建號, 共有面積, 分子, 分母), … ] }。
    一個主建物可能分持好幾筆共有部分。"""
    out: dict[str, list] = {}
    for cr in common_records:
        common_no = (cr.building_number or "").strip()
        common_area = _num(getattr(cr, "total_area_sqm", None)) or _num(
            getattr(cr, "structure_area_sqm", None)
        )
        for sh in getattr(cr, "common_part_shares", None) or []:
            if not isinstance(sh, dict):
                continue
            key = _digits(sh.get("building_number"))
            num = sh.get("numerator")
            den = sh.get("denominator")
            if not key or not den:
                continue
            out.setdefault(key, []).append((common_no, common_area, num, den))
    return out


_NO_RE = re.compile(r"(\d{1,5})\s*-\s*(\d{1,4})")


def _no_keys(text) -> set:
    """地號 / 建號字串 -> {(種類, 前段, 後段)}。地號後段 4 碼、建號後段 3 碼,靠位數分開,
    數字剛好相同的地號與建號(0590-0000 vs 00590-000)才不會對在一起。"""
    return {
        ("L" if len(b) == 4 else "B", int(a), int(b))
        for a, b in _NO_RE.findall(str(text or ""))
    }


def _order_key(v) -> tuple:
    """「0004-000」「0004」-> (4,);「0001-001」-> (1, 1)。"""
    parts = [int(p) for p in re.findall(r"\d+", str(v or ""))]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def _enc_cells(encumbrances: list, related_orders, own_number) -> list:
    """[他項權利人, 擔保債權總金額]。只收登記次序列在該所有權人「相關他項權利登記次序」
    裡、且對應地號/建號包含本筆的他項權利(對應欄空白或寫「全部」時不限)。"""
    orders = {_order_key(t) for t in re.split(r"[,，、\s]+", str(related_orders or ""))}
    orders.discard(())
    if not orders:
        return ["", ""]
    own = _no_keys(own_number)
    holders: list[str] = []
    total = None
    seen_orders: set = set()
    for e in encumbrances:
        ok = _order_key(e.registration_order)
        if ok not in orders or ok in seen_orders:
            continue
        targets = _no_keys(e.applies_to_parcels)
        if own and targets and not (own & targets):
            continue
        seen_orders.add(ok)
        holder = (e.right_holder or "").strip()
        if holder and holder not in holders:
            holders.append(holder)
        if e.secured_amount is not None:
            total = (total or 0) + int(e.secured_amount)
    return ["、".join(holders), total if total is not None else ""]


def build_roster_workbook(
    project,
    land_records: list,
    building_records: list,
    landowners_by_id: dict,
    encumbrances: list,
) -> bytes:
    # 共有部分建號(main_use=="共有部分")不自己成列;拆出來做「主建物建號 -> 共有持分」對照表。
    common_records = [b for b in building_records if _is_common_part(b)]
    building_records = [b for b in building_records if not _is_common_part(b)]
    common_by_flat = _common_share_map(common_records)
    # 去重:同一份謄本被匯入好幾次會產生重複的土地/建物登記,清冊裡就會看到同一個人
    # 重複好幾列。以(地號/建號, 登記次序, 所有權人)為鍵,只留第一筆。
    def _dedup(records, key_fn):
        seen = set()
        out = []
        for rec in records:
            k = key_fn(rec)
            if k in seen:
                continue
            seen.add(k)
            out.append(rec)
        return out

    land_records = _dedup(
        land_records,
        lambda lr: (_digits(lr.parcel_number), (lr.registration_order or "").strip(), lr.landowner_id),
    )
    # 共有部分 / 公設 / 純地下室(門牌「…房屋地下N層」「等共同使用」)不是任何人的
    # 區分所有建物,不能自己成一列 —— OCR 常把每位區分所有權人的「共有部分:XXXX建號」
    # 誤存成掛在該人底下的一筆建物 record(同一個地下室建號會重複幾十列)。整批剔除。
    def _is_shared_space(b) -> bool:
        if (getattr(b, "main_use", None) or "").strip() == "共有部分":
            return True
        addr = (getattr(b, "address", "") or "")
        return "房屋地下" in addr or "共同使用" in addr
    building_records = [b for b in building_records if not _is_shared_space(b)]
    building_records = _dedup(
        building_records,
        lambda b: (_digits(b.building_number), (b.registration_order or "").strip(), b.landowner_id),
    )

    # ---- 依本案件實際樓層,決定「層次面積」欄組 ----
    layer_slots = _layer_layout(building_records)
    layer_pos = {key: idx for idx, (key, _) in enumerate(layer_slots)}
    other_pos = layer_pos.get(("OTHER",))  # 沒有屋突/夾層/認不出的樓層時就沒這欄 -> None
    n_layer = len(layer_slots)
    _BLD_STD_LEN = _HEAD_BLD_COLS + n_layer + len(_COLS_ACCESSORY)

    columns: list[tuple[str, str]] = (
        _COLS_HEAD
        + [("建物標示部", header) for _, header in layer_slots]
        + _COLS_ACCESSORY
        + _COLS_TAIL
    )

    # 面積類欄位:數值一律顯示到小數後 2 位(整數也是,例:80 -> 80.00);
    # 剛好是 0 的就留白不填。判定:欄名含「面積 / ㎡ / 坪」,或就是「防空避難室」。
    def _is_area_header(h: str) -> bool:
        return "面積" in h or "㎡" in h or "坪" in h or h == "防空避難室"

    area_cols = {i for i, (_g, h) in enumerate(columns, start=1) if _is_area_header(h)}
    amount_cols = {i for i, (_g, h) in enumerate(columns, start=1) if h == "擔保債權總金額"}

    wb = Workbook()
    ws = wb.active
    ws.title = "地主清冊"

    thin = Side(style="thin", color="B0B0B0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    group_fill = PatternFill("solid", fgColor="1F9BA3")
    head_fill = PatternFill("solid", fgColor="E8F6F7")
    group_font = Font(bold=True, color="FFFFFF", size=10)
    head_font = Font(bold=True, size=9)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # 群組列(第1列) + 欄位列(第2列),資料從第3列起 - 版面同「清冊範本」,無標題列。
    col = 1
    i = 0
    n = len(columns)
    while i < n:
        group = columns[i][0]
        start = col
        while i < n and columns[i][0] == group:
            c = ws.cell(row=2, column=col, value=columns[i][1])
            c.fill, c.font, c.alignment, c.border = head_fill, head_font, center, border
            col += 1
            i += 1
        end = col - 1
        gc = ws.cell(row=1, column=start, value=group)
        gc.fill, gc.font, gc.alignment, gc.border = group_fill, group_font, center, border
        if end > start:
            ws.merge_cells(start_row=1, start_column=start, end_row=1, end_column=end)
        for cc in range(start, end + 1):
            ws.cell(row=1, column=cc).border = border

    # ---- 資料列 ----
    row_seq = 0  # 土地清冊編號 = 逐列流水號
    lr_by_id = {lr.id: lr for lr in land_records}

    def _bld_parcel(b):
        pn = getattr(b, "parcel_number", None)
        if pn:
            return pn
        parent = lr_by_id.get(b.land_record_id) if b.land_record_id else None
        return parent.parcel_number if parent else None

    # 建物依「坐落地號」分組(同地號的建物照建號排序),配土地列時優先給同一所有權人,
    # 否則就照順序補進該地號的土地列 - 老公寓常見土地共有人 ≠ 建物區分所有權人,
    # 硬要求同人會讓大量建物變成孤兒列。
    bld_by_parcel: dict[str, list] = {}
    for b in building_records:
        pn = _bld_parcel(b)
        if pn:
            bld_by_parcel.setdefault(_digits(pn), []).append(b)
    for lst in bld_by_parcel.values():
        lst.sort(key=lambda b: (b.building_number or "", b.id))
    used_building_ids: set[int] = set()

    def _take_building_for(lr):
        pool = bld_by_parcel.get(_digits(lr.parcel_number), [])
        avail = [x for x in pool if x.id not in used_building_ids]
        if not avail:
            return None
        pick = next((x for x in avail if x.landowner_id == lr.landowner_id), avail[0])
        used_building_ids.add(pick.id)
        return pick

    def _land_owner_cells(lr):
        o = landowners_by_id.get(lr.landowner_id)
        num = lr.ownership_numerator or 1
        den = lr.ownership_denominator or 1
        owned = _num(lr.owned_area_sqm)
        if owned is None:
            owned = round((float(lr.total_area_sqm or 0) * num) / den, 2)
        return [
            lr.registration_order or "",
            o.name if o else "",
            (o.id_number if o else "") or "",
            num,
            den,
            owned,
            _ping(owned),
            (o.address if o else "") or "",
        ]

    def _common_shares_for(b):
        """回傳這個主建物分持的共有部分清單:[(共有建號, 共有面積, 分子, 分母, 持分面積㎡), …]。"""
        if not b:
            return []
        rows = []
        for common_no, common_area, num, den in common_by_flat.get(_digits(b.building_number), []):
            share_sqm = round(float(common_area or 0) * (num or 0) / den, 2) if den else None
            rows.append((common_no, _num(common_area), num, den, share_sqm))
        return rows

    def _bld_std_cells(b):
        if not b:
            return [""] * _BLD_STD_LEN
        total = _num(b.total_area_sqm)
        aux = _num(b.auxiliary_area_sqm)
        # 共有建號持分面積 = Σ(各共有部分 總面積 × 該主建物權利範圍)。沒有共有部分資料時
        # 退回舊的 common_area_sqm 欄位。
        _shares = _common_shares_for(b)
        if _shares:
            common_share = round(sum(s[4] or 0 for s in _shares), 2)
        else:
            common_share = _num(b.common_area_sqm)
        # total(= b.total_area_sqm)已是 _compute_building_totals() 算的 structure + auxiliary
        # + common,也就是「主建物 + 附屬建物」。權狀面積 = 建物總面積 + 共有部分持分
        # (共有持分另從共有建號分算,不在 total 裡);不能再 +aux 一次,否則附屬被算兩次。
        licence = round((total or 0) + (common_share or 0), 2)

        # detail:前 n_layer 格 = layer_slots 對應的層次面積,後 3 格 = 附屬平台/陽臺/防空
        detail = [""] * (n_layer + len(_COLS_ACCESSORY))
        for f in getattr(b, "floors_detail", None) or []:
            if not isinstance(f, dict):
                continue
            pos = layer_pos.get(_classify_floor(f.get("floor")))
            if pos is None:
                pos = other_pos
            if pos is None:
                continue  # 沒有「其他層次」欄(掃描時已判定用不到)—— 保險跳過
            area = _num(f.get("area_sqm"))
            if area is None:
                area = ""
            if pos == other_pos:
                # 「其他層次」會有多筆(地下二層 + 地下三層 + 屋突…),要加總不能覆蓋
                prev = detail[pos] if isinstance(detail[pos], (int, float)) else 0
                detail[pos] = round(prev + area, 2) if isinstance(area, (int, float)) else (prev or area)
            else:
                detail[pos] = area
        for a in getattr(b, "accessories_detail", None) or []:
            k = _accessory_slot(a.get("use") if isinstance(a, dict) else None)
            if k is not None and isinstance(a, dict):
                detail[n_layer + k] = _num(a.get("area_sqm")) or a.get("area_sqm") or ""

        # 保險:層次各格加總必須 == 主建物面積 structure_area_sqm。謄本沒逐層明細、或
        # 明細少算時,把差額補進「其他層次」,讓匯出檔裡「建物總面積 = Σ層次格 + 附屬」
        # 永遠成立。差額為負(明細多於主建物面積)、或本案沒有「其他層次」欄時不動。
        _struct = _num(b.structure_area_sqm)
        if _struct is not None and other_pos is not None:
            _placed = sum(v for v in detail[:n_layer] if isinstance(v, (int, float)))
            _gap = round(_struct - _placed, 2)
            if _gap >= 0.01:
                _prev = detail[other_pos] if isinstance(detail[other_pos], (int, float)) else 0
                detail[other_pos] = round(_prev + _gap, 2)

        # 層次欄:多筆時列出所有樓層名
        floor_names = [
            (f.get("floor") or "").strip()
            for f in (getattr(b, "floors_detail", None) or [])
            if isinstance(f, dict) and (f.get("floor") or "").strip()
        ]
        floor_label = "、".join(floor_names) if floor_names else (b.floor or "")

        return [
            b.building_number or "",
            b.address or "",
            "",  # 坐落地號 - 由土地列的地號帶
            b.total_floors or "",
            floor_label,
            total if total is not None else "",
            aux if aux is not None else "",
            common_share if common_share is not None else "",
            licence,
        ] + detail

    def _bld_owner_cells(b):
        if not b:
            return [""] * 8
        o = landowners_by_id.get(b.landowner_id)
        num = b.ownership_numerator or 1
        den = b.ownership_denominator or 1
        owned = round((float(b.total_area_sqm or 0) * num) / den, 2)
        return [
            b.registration_order or "",
            o.name if o else "",
            (o.id_number if o else "") or "",
            num,
            den,
            owned,
            _ping(owned),
            (o.address if o else "") or "",
        ]

    def _common_cells(b):
        """共有建號群組。來源:共有部分建號的建物標示部「主建物資料 + 權利範圍」。
        一個主建物分持多筆共有部分時:建號用「、」串接、共有面積與持分面積加總、
        分子分母只在單筆時填。都沒有時退回舊的 common_area_sqm。"""
        if not b:
            return [""] * 6
        shares = _common_shares_for(b)
        if not shares:
            fallback = _num(b.common_area_sqm)
            return ["", "", "", "", fallback if fallback is not None else "", _ping(fallback)]
        if len(shares) == 1:
            no, area, num, den, share_sqm = shares[0]
            return [no or "", area if area is not None else "", num, den,
                    share_sqm if share_sqm is not None else "", _ping(share_sqm)]
        total_area = round(sum(float(s[1] or 0) for s in shares), 2)
        total_share = round(sum(float(s[4] or 0) for s in shares), 2)
        return [
            "、".join(s[0] for s in shares if s[0]),
            total_area,
            "",  # 分子(多筆不填)
            "",  # 分母(多筆不填)
            total_share,
            _ping(total_share),
        ]

    def _emit(row_values):
        nonlocal r
        for cidx, val in enumerate(row_values, start=1):
            if cidx in area_cols and isinstance(val, (int, float)) and not isinstance(val, bool):
                val = None if abs(val) < 0.005 else round(float(val), 2)
            cell = ws.cell(row=r, column=cidx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            if cidx in area_cols:
                cell.number_format = "0.00"
            elif cidx in amount_cols:
                cell.number_format = "#,##0"
        r += 1

    r = 3
    # 一列 = 一筆土地登記(地號 × 所有權人),配上同一 (坐落地號, 所有權人) 底下、
    # 還沒被用過的一筆建物。
    for lr in land_records:
        row_seq += 1
        b = _take_building_for(lr)

        row = [
            row_seq,
            lr.township or "",
            lr.section or "",
            lr.subsection or "",
            lr.parcel_number or "",
            _num(lr.total_area_sqm) if lr.total_area_sqm is not None else "",
        ]
        row += _land_owner_cells(lr)
        row += _enc_cells(encumbrances, lr.related_encumbrance_orders, lr.parcel_number)
        std = _bld_std_cells(b)
        if b:
            std[2] = _bld_parcel(b) or lr.parcel_number or ""
        row += std
        row += _bld_owner_cells(b)
        row += _enc_cells(encumbrances, b.related_encumbrance_orders, b.building_number) if b else ["", ""]
        row += _common_cells(b)
        _emit(row)

    # 沒有配到土地登記的建物(同一人名下第 2+ 個建號,或只匯了建物謄本)- 補在後面,
    # 土地欄留空,坐落地號用建物自己的。
    for b in building_records:
        if b.id in used_building_ids:
            continue
        row_seq += 1
        row = [row_seq, "", "", "", "", ""] + [""] * 10
        std = _bld_std_cells(b)
        std[2] = _bld_parcel(b) or ""
        row += std
        row += _bld_owner_cells(b)
        row += _enc_cells(encumbrances, b.related_encumbrance_orders, b.building_number)
        row += _common_cells(b)
        _emit(row)

    # 欄寬
    for cidx, (_group, header) in enumerate(columns, start=1):
        w = 10
        if "地址" in header:
            w = 32
        elif header == "他項權利人":
            w = 28
        elif header == "擔保債權總金額":
            w = 14
        elif header == "所有權人":
            w = 20
        elif "編號" in header or "門牌" in header:
            w = 16
        ws.column_dimensions[get_column_letter(cidx)].width = w
    ws.freeze_panes = "G3"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
