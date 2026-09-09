"""地主清冊 Excel 匯出 - 版面依 clientside「清冊範本」(範本.pdf):兩列表頭(群組列 +
欄位列),一列資料 = 一筆土地登記(地號 × 所有權人),對應建物依號碼比對帶入。

群組:土地標示部 / 土地所有權部 / 建物標示部 / 建物所有權部 / 共有建號。
他項權利欄已依範本移除。「共有建號」群組的共有建號 / 共有面積 / 共有權利範圍(分子分母)
目前資料模型還沒存(待 OCR/模型擴充),先留空;持分面積先用建物的 common_area_sqm。
"""

import io
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

PING_PER_SQM = 0.3025

# (群組, 欄位標題) - 順序即欄位順序
_COLUMNS: list[tuple[str, str]] = [
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
    ("建物標示部", "建號"),
    ("建物標示部", "建號門牌"),
    ("建物標示部", "坐落地號"),
    ("建物標示部", "層數"),
    ("建物標示部", "層次"),
    ("建物標示部", "建物總面積(㎡)"),
    ("建物標示部", "附屬建物總面積(㎡)"),
    ("建物標示部", "共有建號持分面積"),
    ("建物標示部", "權狀面積(㎡)"),
    ("建物標示部", "層次面積(㎡)1F"),
    ("建物標示部", "層次面積(㎡)2F"),
    ("建物標示部", "層次面積(㎡)3F"),
    ("建物標示部", "層次面積(㎡)4F"),
    ("建物標示部", "層次面積(㎡)5F"),
    ("建物標示部", "層次面積(㎡)6F"),
    ("建物標示部", "層次面積(㎡)7F"),
    ("建物標示部", "層次面積(㎡)平台"),
    ("建物標示部", "層次面積(㎡)陽臺"),
    ("建物標示部", "層次面積(㎡)騎樓"),
    ("建物標示部", "附屬建物(㎡)平台"),
    ("建物標示部", "附屬建物(㎡)陽臺"),
    ("建物標示部", "防空避難室"),
    ("建物所有權部", "登記次序"),
    ("建物所有權部", "所有權人"),
    ("建物所有權部", "統一編號"),
    ("建物所有權部", "權利範圍(分子)"),
    ("建物所有權部", "權利範圍(分母)"),
    ("建物所有權部", "持份權狀面積(㎡)"),
    ("建物所有權部", "持份權狀面積(坪)"),
    ("建物所有權部", "所有權人戶籍地址"),
    ("共有建號", "共有建號"),
    ("共有建號", "共有面積"),
    ("共有建號", "共有權利範圍(分子)"),
    ("共有建號", "共有權利範圍(分母)"),
    ("共有建號", "持分面積(㎡)"),
    ("共有建號", "持分面積(坪)"),
]


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7}


def _floor_slot(name: str):
    """樓層名 -> 13 個明細欄位裡的 index(0=1F … 6=7F, 7=平台, 8=陽臺, 9=騎樓)。
    地下層 / 屋頂突出物 等沒有對應欄位就回 None。"""
    s = re.sub(r"\s+", "", str(name or ""))
    if "地下" in s or "屋頂" in s:
        return None
    if "平台" in s or "平臺" in s:
        return 7
    if "陽台" in s or "陽臺" in s:
        return 8
    if "騎樓" in s:
        return 9
    m = re.match(r"([一二三四五六七1-7])\s*層?", s)
    if m:
        n = _CN_NUM.get(m.group(1)) or (int(m.group(1)) if m.group(1).isdigit() else None)
        if n and 1 <= n <= 7:
            return n - 1
    return None


def _accessory_slot(use: str):
    """附屬建物用途 -> 明細 index(10=附屬平台, 11=附屬陽臺, 12=附屬防空避難室)。"""
    s = re.sub(r"\s+", "", str(use or ""))
    if "平台" in s or "平臺" in s:
        return 10
    if "陽台" in s or "陽臺" in s:
        return 11
    if "防空" in s or "避難" in s:
        return 12
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


def build_roster_workbook(
    project,
    land_records: list,
    building_records: list,
    landowners_by_id: dict,
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
    n = len(_COLUMNS)
    while i < n:
        group = _COLUMNS[i][0]
        start = col
        while i < n and _COLUMNS[i][0] == group:
            c = ws.cell(row=2, column=col, value=_COLUMNS[i][1])
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

    # 建物標示部欄位數(建號 … 防空避難室)
    _BLD_STD_LEN = 22

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
        # 權狀面積 = 主建物 + 附屬建物 + 共有部分持分。b.total_area_sqm(_compute_building_totals
        # 算出的「建物總面積」)本身就已經是 structure_area_sqm + auxiliary_area_sqm +
        # common_area_sqm 的加總 —— 附屬建物面積(aux)已經算在 total 裡面了,這裡不能再加
        # 一次 aux,不然附屬建物面積會被重複計算兩次(謄本匯入的建物尤其明顯:結構面積跟
        # 附屬建物是分開兩個數字相加得出 total,再 +aux 就變成三個數字疊加)。權狀面積真正
        # 該多算的是共有部分持分(common_share)——這是另外從共有建號分算出來的,不在 total 裡。
        licence = round((total or 0) + (common_share or 0), 2)

        detail = [""] * 13  # 1F..7F / 平台 / 陽臺 / 騎樓 / 附屬平台 / 附屬陽臺 / 防空避難室
        for f in getattr(b, "floors_detail", None) or []:
            slot = _floor_slot(f.get("floor") if isinstance(f, dict) else None)
            if slot is not None and isinstance(f, dict):
                detail[slot] = _num(f.get("area_sqm")) or f.get("area_sqm") or ""
        for a in getattr(b, "accessories_detail", None) or []:
            slot = _accessory_slot(a.get("use") if isinstance(a, dict) else None)
            if slot is not None and isinstance(a, dict):
                detail[slot] = _num(a.get("area_sqm")) or a.get("area_sqm") or ""

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
            cell = ws.cell(row=r, column=cidx, value=val)
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)
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
        std = _bld_std_cells(b)
        if b:
            std[2] = _bld_parcel(b) or lr.parcel_number or ""
        row += std
        row += _bld_owner_cells(b)
        row += _common_cells(b)
        _emit(row)

    # 沒有配到土地登記的建物(同一人名下第 2+ 個建號,或只匯了建物謄本)- 補在後面,
    # 土地欄留空,坐落地號用建物自己的。
    for b in building_records:
        if b.id in used_building_ids:
            continue
        row_seq += 1
        row = [row_seq, "", "", "", "", ""] + [""] * 8
        std = _bld_std_cells(b)
        std[2] = _bld_parcel(b) or ""
        row += std
        row += _bld_owner_cells(b)
        row += _common_cells(b)
        _emit(row)

    # 欄寬
    for cidx, (_group, header) in enumerate(_COLUMNS, start=1):
        w = 10
        if "地址" in header:
            w = 32
        elif header == "所有權人":
            w = 20
        elif "編號" in header or "門牌" in header:
            w = 16
        ws.column_dimensions[get_column_letter(cidx)].width = w
    ws.freeze_panes = "G3"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
