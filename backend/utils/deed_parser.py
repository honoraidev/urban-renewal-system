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
_DEED_SPLIT_RE = re.compile(r"(?=土地登記第[一二三]類謄本（地號全部）)")
_DEED_KIND_RE = re.compile(r"土地登記第([一二三])類謄本")
_LOCATION_RE = re.compile(
    r"([一-鿿]{2,4}區)\s*([一-鿿]{2,4}段)\s*([一-鿿]{1,4}小段)?\s*(\d{3,5}-\d{3,5})\s*地號"
)
_AREA_RE = re.compile(r"面\s*積\s*[:：]\s*[*\s]*([\d,]+(?:\.\d+)?)\s*平方公尺")
_SECTION_OWNER = "土地所有權部"
_SECTION_ENC = "土地他項權利部"

_OWNER_BLOCK_RE = re.compile(r"（\s*(\d{3,4})\s*）\s*登記次序\s*[:：]\s*(\d{3,4})")
_ENC_BLOCK_RE = re.compile(r"（\s*(\d{3,4})\s*）\s*登記次序\s*[:：]\s*(\d{3,4}-\d{2,4})")

_OWNER_NAME_RE = re.compile(r"^所有權人\s*[:：][ \t　]*(.*?)[ \t　]*$", re.M)
_ID_RE = re.compile(r"統一編號\s*[:：]\s*([A-Za-z0-9*]+)")
_ADDR_RE = re.compile(r"住\s*址\s*[:：]\s*([^\n]+)")
_CUR_SHARE_RE = re.compile(r"(歷次取得)?\s*權利範圍\s*[:：]\s*(?:全部\s*)?[*\s]*(\d+)\s*分之\s*(\d+)")
_TRANSFER_LABEL = "前次移轉現值或原規定地價"
_YM_VALUE_RE = re.compile(r"(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*[*\s]*([\d,]+(?:\.\d+)?)\s*元")

_ENC_RIGHT_TYPE_RE = re.compile(r"權利種類\s*[:：]\s*([^\s\n]+)")
_ENC_HOLDER_RE = re.compile(r"權\s*利\s*人\s*[:：][ \t　]*(.*?)[ \t　]*$", re.M)
_ENC_DEBTOR_RE = re.compile(r"債[權務]額比例\s*[:：]\s*(?:全部\s*)?[*\s]*(\d+)\s*分之\s*(\d+)")
_ENC_COMMON_PARCEL_RE = re.compile(r"共同擔保地號\s*[:：]\s*([^\n]+)")

_BLANK_TOKENS = {"", "（空白）", "(空白)", "空白", "無"}


def _clean(v: str) -> str:
    return (v or "").translate(_FW_DIGITS).strip().strip("*").strip()


def _first(rx: re.Pattern, text: str):
    m = rx.search(text)
    return m.group(1) if m else None


def _parse_owner(order_disp: str, block: str) -> dict | None:
    name = _first(_OWNER_NAME_RE, block)
    name = _clean(name) if name else ""
    if not name:
        name = "＊＊"

    id_number = _clean(_first(_ID_RE, block) or "")

    addr_raw = _first(_ADDR_RE, block)
    addr = _clean(addr_raw) if addr_raw else ""
    if addr.strip("()（） ") in _BLANK_TOKENS:
        addr = ""

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
        out.append((m.group(2), section[start:end]))
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
