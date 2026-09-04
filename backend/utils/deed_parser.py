"""Rule-based parser for Taiwanese electronic land-title deeds (電子謄本).

An electronic 謄本 downloaded from https://ep.land.nat.gov.tw carries a perfect
embedded text layer whose layout is highly regular. For those files the structured
data can be pulled out with anchored regexes alone - no OCR, no LLM, instant and
free. extract_title_deed() calls parse_electronic_deed() first when every page has a
usable text layer; it returns None (and the normal AI pipeline runs) on anything it
is not confident about - buildings, unexpected layout, or a coverage mismatch
between the 「（NNNN）登記次序」 markers and the records it managed to extract.
"""

import re

_FW_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")

# One 地號 per 「土地登記第X類謄本（地號全部）」 title page.
_DEED_SPLIT_RE = re.compile(r"(?=(?:土地|建物)登記第[一二三123]類謄本[（\(][地建]號全部[）\)])")
_DEED_KIND_RE = re.compile(r"(?:土地|建物)登記第([一二三123])類謄本")
_LOCATION_RE = re.compile(
    r"([一-鿿]{2,4}區)\s*([一-鿿]{2,4}段)\s*([一-鿿]{1,4}小段)?\s*(\d{3,5}-\d{3,5})\s*地號"
)
_AREA_RE = re.compile(r"面\s*積\s*[:：]\s*[*\s]*([\d,]+(?:\.\d+)?)\s*平方公尺")
_SECTION_OWNER = "土地所有權部"
_SECTION_ENC = "土地他項權利部"

# A real record header is 「（NNNN）登記次序：XXXX」. 「登記次序」 also appears bare inside
# other fields - 「標的登記次序：0053」 and 「相關他項權利登記次序：0196-000」 in the
# 他項權利部 - which must NOT be picked up as records, or every owner after the first
# 抵押權 fails to parse and the whole rule-based read bails to the slow AI path.
_OWNER_BLOCK_RE = re.compile(
    r"(?:[（\(]\s*\d{1,4}\s*[）\)]\s*)?(?<!標的)(?<!他項權利)登記次序\s*[:：]\s*(\d{3,4})(?!\s*-\s*\d)"
)
_ENC_BLOCK_RE = re.compile(
    r"(?:[（\(]\s*\d{1,4}\s*[）\)]\s*)?(?<!標的)(?<!他項權利)登記次序\s*[:：]\s*(\d{3,4}-\d{2,4})"
)

_OWNER_NAME_RE = re.compile(r"^[ \t　]*所有權人\s*[:：][ \t　]*(.*?)[ \t　]*$", re.M)
_ID_RE = re.compile(r"統一編號\s*[:：]\s*([A-Za-z0-9*]+)")
_ADDR_RE = re.compile(
    r"[住佳往]\s*[址趾]\s*[:：]?\s*(.*?)(?=\s*(?:(歷次取得)?權\s*利\s*範\s*圍|權\s*狀\s*字\s*號|當期申報地價|統\s*一\s*編\s*號|管\s*理\s*者|前次移轉現值|歷次取得|其他登記事項|[（\(]|\Z))",
    re.S,
)
_CUR_SHARE_RE = re.compile(r"(歷次取得)?\s*權利範圍\s*[:：]\s*(?:公同共有\s*|公同\s*|全部\s*)?[*\s]*(\d+)\s*分之\s*(\d+)")
_TRANSFER_LABEL = "前次移轉現值或原規定地價"
_YM_VALUE_RE = re.compile(r"(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*[*\s]*([\d,]+(?:\.\d+)?)\s*元")

# 所有權部區塊裡的「相關他項權利登記次序：0004-000」- 把這位所有權人連到設定在他
# 持分上的那筆他項權利。沒有這一行 = 這位所有權人沒有他項權利。
_RELATED_ENC_RE = re.compile(r"相\s*關\s*他\s*項\s*權\s*利\s*登\s*記\s*次\s*序\s*[:：]\s*(\d{1,4}(?:\s*-\s*\d{1,4})?)")

_ENC_RIGHT_TYPE_RE = re.compile(r"權利種類\s*[:：]\s*([^\s\n]+)")
_ENC_HOLDER_RE = re.compile(r"權\s*利\s*人\s*[:：][ \t　]*(.*?)[ \t　]*$", re.M)
_ENC_DEBTOR_RE = re.compile(r"債[權務]額比例\s*[:：]\s*(?:全部\s*)?[*\s]*(\d+)\s*分之\s*(\d+)")
_ENC_COMMON_PARCEL_RE = re.compile(r"共同擔保地號\s*[:：]\s*([^\n]+)")

_BLANK_TOKENS = {
    "",
    "（空白）",
    "(空白)",
    "空白",
    "無",
    "null",
    "none",
    "-",
    "依規定隱匿",
    "隱匿",
    "依規定隱匿住址",
    "住址隱匿",
    "(依規定隱匿)",
    "（依規定隱匿）",
}


def _clean(v: str) -> str:
    return (v or "").translate(_FW_DIGITS).strip().strip("*＊").strip()


def _first(rx: re.Pattern, text: str):
    m = rx.search(text)
    return m.group(1) if m else None


def _parse_owner(order_disp: str, block: str) -> dict | None:
    name = _first(_OWNER_NAME_RE, block)
    # Keep the redaction mark (「陳＊＊」) - it is part of the displayed name on a
    # 第二類 謄本; only strip surrounding whitespace and normalise fullwidth digits.
    name = re.sub(r"[ \t　]+", "", name).translate(_FW_DIGITS) if name else ""
    if not name:
        name = "＊＊"

    id_number = _clean(_first(_ID_RE, block) or "")

    addr_m = _ADDR_RE.search(block)
    if addr_m:
        raw_addr = re.sub(r"\s+", "", addr_m.group(1).strip())
        addr = _clean(raw_addr)
        if addr.strip("()（） ").lower() in _BLANK_TOKENS:
            addr = ""
    else:
        addr = ""

    is_pooled = bool(re.search(r"權\s*利\s*範\s*圍\s*[:：]\s*(?:[*　\s]*)(?:公同共有|公同)", block))

    num = den = None
    for m in _CUR_SHARE_RE.finditer(block):
        if m.group(1):  # 歷次取得權利範圍 - skip
            continue
        # 「X分之Y」 == Y/X : denominator is X (group 2), numerator is Y (group 3)
        den, num = int(m.group(2)), int(m.group(3))
        break
    if num is None or den is None or den == 0:
        return None  # a real owner always has a 權利範圍 - bail to the AI path

    transfer_history: list[dict] = []
    li = block.find(_TRANSFER_LABEL)
    if li != -1:
        tail = block[li + len(_TRANSFER_LABEL):]
        end = tail.find("其他登記事項")
        if end != -1:
            tail = tail[:end]
        for ym in _YM_VALUE_RE.finditer(tail):
            y, mo, val = ym.group(1), ym.group(2), ym.group(3).replace(",", "")
            try:
                transfer_history.append({"period": f"{int(y):03d}年{int(mo):02d}月", "value": float(val)})
            except ValueError:
                pass

    owner = {
        "registration_order": order_disp,
        "owner_name": name,
        "id_number": id_number,
        "ownership_numerator": num,
        "ownership_denominator": den,
        "address": addr,
        "is_pooled": is_pooled,
        "transfer_history": transfer_history,
    }
    if transfer_history:
        owner["declared_value_period"] = transfer_history[-1]["period"]
        owner["declared_value_per_sqm"] = transfer_history[-1]["value"]
    else:
        owner["declared_value_period"] = None
        owner["declared_value_per_sqm"] = None
    return owner


def _split_blocks(section: str, rx: re.Pattern) -> list[tuple[str, str]]:
    """Return [(display_order, block_text), ...] split at each （NNNN）登記次序 marker."""
    marks = list(rx.finditer(section))
    out = []
    for i, m in enumerate(marks):
        start = m.start()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(section)
        out.append((m.group(1), section[start:end]))
    return out


def _parse_one_deed(block: str) -> dict | None:
    if "建物登記第" in block or "建物標示部" in block or "建物他項權利部" in block:
        return None  # mixed land+building - let the AI pipeline handle it

    kind = _DEED_KIND_RE.search(block)
    deed_category = f"土地登記第{kind.group(1)}類謄本" if kind else ""

    loc = _LOCATION_RE.search(block)
    if not loc:
        return None
    township, section_name, subsection, parcel_number = (
        loc.group(1), loc.group(2), loc.group(3) or "", loc.group(4).translate(_FW_DIGITS),
    )

    area_m = _AREA_RE.search(block)
    area_sqm = float(area_m.group(1).replace(",", "")) if area_m else None

    oi = block.find(_SECTION_OWNER)
    ei = block.find(_SECTION_ENC)
    if oi == -1:
        return None
    owner_sec = block[oi:(ei if ei != -1 else len(block))]
    enc_sec = block[ei:] if ei != -1 else ""

    owner_blocks = _split_blocks(owner_sec, _OWNER_BLOCK_RE)
    if not owner_blocks:
        return None
    owners = []
    for order_disp, ob in owner_blocks:
        parsed = _parse_owner(order_disp, ob)
        if parsed is None:
            return None
        owners.append(parsed)

    encumbrances = []
    if enc_sec:
        for order_disp, eb in _split_blocks(enc_sec, _ENC_BLOCK_RE):
            right_type = _clean(_first(_ENC_RIGHT_TYPE_RE, eb) or "")
            holder = _clean(_first(_ENC_HOLDER_RE, eb) or "")
            dm = _ENC_DEBTOR_RE.search(eb)
            debtor_info = f"{dm.group(1)}分之{dm.group(2)}" if dm else ""
            cp = _first(_ENC_COMMON_PARCEL_RE, eb)
            applies = _clean(cp) if cp else parcel_number
            encumbrances.append({
                "registration_order": order_disp,
                "applies_to_parcels": applies,
                "right_type": right_type,
                "right_holder": holder,
                "debtor_info": debtor_info,
            })
        # coverage: every （NNNN）登記次序：NNNN-NNN marker became a record
        if len(_ENC_BLOCK_RE.findall(enc_sec)) != len(encumbrances):
            return None

    parcel = {
        "township": township,
        "section": section_name,
        "subsection": subsection,
        "parcel_number": parcel_number,
        "area_sqm": area_sqm,
        "owners": owners,
        "encumbrances": encumbrances,
    }
    return {"deed_category": deed_category, "parcel": parcel}


def parse_electronic_deed(full_text: str) -> dict | None:
    """Parse the concatenated text of an electronic 土地謄本 PDF into the same shape
    extract_title_deed() produces. Returns None if not fully confident."""
    if not full_text or "土地登記第" not in full_text:
        return None
    text = full_text.translate(_FW_DIGITS)

    blocks = [b for b in _DEED_SPLIT_RE.split(text) if "登記次序" in b and _SECTION_OWNER in b]
    if not blocks:
        return None

    land_parcels = []
    deed_category = ""
    for b in blocks:
        parsed = _parse_one_deed(b)
        if parsed is None:
            return None
        land_parcels.append(parsed["parcel"])
        deed_category = deed_category or parsed["deed_category"]

    if not land_parcels:
        return None

    return {
        "deed_category": deed_category,
        "land_parcels": land_parcels,
        "buildings": [],
        "encumbrances": [],
    }


# --- 電子建物謄本 (建物登記第X類謄本（建號全部）) ------------------------------------
# Same idea as parse_electronic_deed but for 建物謄本. A weak vision model tends to
# misfile 建物所有權部 owners into land_parcels because the page is full of 「地號」
# strings (建物坐落地號 / 共有部分…建號), so reading these straight from the text
# layer is both faster and much more reliable.
_BLDG_SPLIT_RE = re.compile(r"(?=建物登記第[一二三123]類謄本[（\(]建號全部[）\)])")
_BLDG_KIND_RE = re.compile(r"建物登記第([一二三123])類謄本")
_BLDG_HDR_RE = re.compile(
    r"([一-鿿]{2,4}區)?\s*([一-鿿]{2,4}段)\s*([一-鿿]{1,4}小段)?\s*(\d{3,5}-\d{3,5})\s*建號"
)
_SECTION_BLDG_OWNER = "建物所有權部"
_SECTION_BLDG_ENC = "建物他項權利部"
_BLDG_DOOR_RE = re.compile(r"建\s*物\s*門\s*牌\s*[:：]\s*([^\n]+)")
_BLDG_PARCEL_RE = re.compile(
    r"建物坐落地號\s*[:：]\s*(?:[一-鿿]{2,4}段\s*)?(?:[一-鿿]{1,4}小段\s*)?(\d{3,5}-\d{3,5})"
)
_BLDG_FLOORS_RE = re.compile(r"層\s*數\s*[:：]\s*[*\s]*([^\n]+?)\s*(?:總\s*面\s*積|$)", re.M)
_BLDG_FLOOR_RE = re.compile(r"層\s*次\s*[:：]\s*[*\s]*([^\n]+?)\s*(?:層\s*次\s*面\s*積|$)", re.M)
_BLDG_TOTAL_AREA_RE = re.compile(r"總\s*面\s*積\s*[:：][*\s]*([\d,]+(?:\.\d+)?)\s*平方公尺")
_BLDG_FLOOR_AREA_RE = re.compile(r"層\s*次\s*面\s*積\s*[:：][*\s]*([\d,]+(?:\.\d+)?)\s*平方公尺")
_BLDG_ACCESSORY_RE = re.compile(
    r"附屬建物用途\s*[:：]\s*([^\n]+?)\s*面\s*積\s*[:：][*\s]*([\d,]+(?:\.\d+)?)\s*平方公尺"
)
_BLDG_ACCESSORY_START_RE = re.compile(r"附屬建物用途\s*[:：]")
_BLDG_ACCESSORY_ROW_RE = re.compile(
    r"([一-鿿]{1,8})[ \t　]+(?:面\s*積\s*[:：])?[ \t　*]*([\d,]+(?:\.\d+)?)\s*平方公尺"
)
_BLDG_ACCESSORY_STOP_RE = re.compile(r"共有部分|權利範圍|其他登記事項|建物他項權利部|建物所有權部")
# 層次可能有多筆(二層 / 三層 堆疊),第一筆有「層次：」「層次面積：」標籤,後續筆只印
# 樓層名 + 面積、靠縮排對齊。
_BLDG_FLOOR_START_RE = re.compile(r"層\s*次\s*[:：]")
# 樓層名不一定以「層」結尾 - 也有「屋頂突出物」「騎樓」「夾層」「陽台」等,所以不能只認
# 「X層」。抓 2~10 個中文字後接(可略的「層次面積：」)+ 數字 + 平方公尺。
_BLDG_FLOOR_ROW_RE = re.compile(
    r"([一-鿿]{2,10})[ \t　]+(?:層\s*次\s*面\s*積\s*[:：])?[ \t　*]*([\d,]+(?:\.\d+)?)\s*平方公尺"
)
_BLDG_FLOOR_STOP_RE = re.compile(r"建築完成日期|附屬建物|共有部分|權利範圍|建物他項權利部|建物所有權部")
_ENC_COMMON_BLDG_RE = re.compile(r"共同擔保建號\s*[:：]\s*([^\n]+)")


def _parse_one_building(block: str) -> dict | None:
    kind = _BLDG_KIND_RE.search(block)
    deed_category = f"建物登記第{kind.group(1)}類謄本" if kind else ""

    hdr = _BLDG_HDR_RE.search(block)
    if not hdr:
        return None
    township, section_name, subsection, building_number = (
        hdr.group(1) or "", hdr.group(2), hdr.group(3) or "",
        hdr.group(4).translate(_FW_DIGITS),
    )

    ei = block.find(_SECTION_BLDG_ENC)
    oi = block.find(_SECTION_BLDG_OWNER)
    # 共有部分 建號 (樓梯間 / 共同使用部分) carry a 建物標示部 but no 建物所有權部 -
    # their ownership is split among the flats via each flat's 「共有部分：…建號」
    # reference. Emit them with an empty owners list rather than dropping them.
    has_owner_section = oi != -1
    std_end = oi if has_owner_section else (ei if ei != -1 else len(block))
    std_sec = block[:std_end]
    owner_sec = block[oi:(ei if ei != -1 else len(block))] if has_owner_section else ""
    enc_sec = block[ei:] if ei != -1 else ""

    door = _BLDG_DOOR_RE.search(std_sec)
    building_address = _clean(re.sub(r"\s+", "", door.group(1))) if door else ""
    pm = _BLDG_PARCEL_RE.search(std_sec)
    parcel_number = pm.group(1).translate(_FW_DIGITS) if pm else ""
    ta = _BLDG_TOTAL_AREA_RE.search(std_sec)
    total_area_sqm = float(ta.group(1).replace(",", "")) if ta else None
    fa = _BLDG_FLOOR_AREA_RE.search(std_sec)
    floor_area_sqm = float(fa.group(1).replace(",", "")) if fa else None
    fls = _BLDG_FLOORS_RE.search(std_sec)
    total_floors = _clean(re.sub(r"\s+", "", fls.group(1))) if fls else ""

    floors: list[dict] = []
    fsm = _BLDG_FLOOR_START_RE.search(std_sec)
    if fsm:
        ftail = std_sec[fsm.end():]
        fstop = _BLDG_FLOOR_STOP_RE.search(ftail)
        fseg = ftail[: fstop.start()] if fstop else ftail
        for fname, farea in _BLDG_FLOOR_ROW_RE.findall(fseg):
            try:
                floors.append({
                    "floor": _clean(re.sub(r"\s+", "", fname)),
                    "area_sqm": float(farea.replace(",", "")),
                })
            except ValueError:
                pass
    floor = floors[0]["floor"] if floors else ""
    floor_area_sqm = floors[0]["area_sqm"] if floors else floor_area_sqm
    # 附屬建物可能有多筆 - 第一筆有「附屬建物用途：」標籤,後續筆只印用途名 + 面積,
    # 靠縮排對齊(和「層次」的二層/三層堆疊同一種排版)。
    accessories: list[dict] = []
    sm = _BLDG_ACCESSORY_START_RE.search(std_sec)
    if sm:
        tail = std_sec[sm.end():]
        stop = _BLDG_ACCESSORY_STOP_RE.search(tail)
        seg = tail[: stop.start()] if stop else tail
        for use, area in _BLDG_ACCESSORY_ROW_RE.findall(seg):
            try:
                accessories.append({
                    "use": _clean(re.sub(r"\s+", "", use)),
                    "area_sqm": float(area.replace(",", "")),
                })
            except ValueError:
                pass
    accessory_use = accessories[0]["use"] if accessories else ""
    accessory_area_sqm = accessories[0]["area_sqm"] if accessories else None

    owners = []
    if has_owner_section:
        owner_blocks = _split_blocks(owner_sec, _OWNER_BLOCK_RE)
        if not owner_blocks:
            return None
        for order_disp, ob in owner_blocks:
            parsed = _parse_owner(order_disp, ob)
            if parsed is None:
                return None
            owners.append(parsed)

    encumbrances = []
    if enc_sec:
        for order_disp, eb in _split_blocks(enc_sec, _ENC_BLOCK_RE):
            right_type = _clean(_first(_ENC_RIGHT_TYPE_RE, eb) or "")
            holder = _clean(_first(_ENC_HOLDER_RE, eb) or "")
            dm = _ENC_DEBTOR_RE.search(eb)
            debtor_info = f"{dm.group(1)}分之{dm.group(2)}" if dm else ""
            cp = _first(_ENC_COMMON_BLDG_RE, eb) or _first(_ENC_COMMON_PARCEL_RE, eb)
            applies = _clean(cp) if cp else building_number
            encumbrances.append({
                "registration_order": order_disp,
                "applies_to_parcels": applies,
                "right_type": right_type,
                "right_holder": holder,
                "debtor_info": debtor_info,
            })
        if len(_ENC_BLOCK_RE.findall(enc_sec)) != len(encumbrances):
            return None

    building = {
        "building_number": building_number,
        "building_address": building_address,
        "township": township,
        "section": section_name,
        "subsection": subsection,
        "parcel_number": parcel_number,
        "total_floors": total_floors,
        "floor": floor,
        "floors": floors,
        "total_area_sqm": total_area_sqm,
        "floor_area_sqm": floor_area_sqm,
        "accessory_use": accessory_use,
        "accessory_area_sqm": accessory_area_sqm,
        "accessories": accessories,
        "owners": owners,
        "encumbrances": encumbrances,
    }
    return {"deed_category": deed_category, "building": building}


def parse_electronic_building_deed(full_text: str) -> dict | None:
    """Parse the concatenated text of an electronic 建物謄本 PDF into the same shape
    extract_title_deed() produces. Returns None if not fully confident."""
    if not full_text or "建物登記第" not in full_text or _SECTION_BLDG_OWNER not in full_text:
        return None
    text = full_text.translate(_FW_DIGITS)

    blocks = [b for b in _BLDG_SPLIT_RE.split(text) if "建物標示部" in b]
    if not blocks:
        return None

    buildings = []
    deed_category = ""
    for b in blocks:
        parsed = _parse_one_building(b)
        if parsed is None:
            return None
        buildings.append(parsed["building"])
        deed_category = deed_category or parsed["deed_category"]

    if not buildings:
        return None

    return {
        "deed_category": deed_category,
        "land_parcels": [],
        "buildings": buildings,
        "encumbrances": [],
    }
