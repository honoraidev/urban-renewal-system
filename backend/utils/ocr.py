import base64
try:
    import fcntl
except ImportError:
    fcntl = None
try:
    import msvcrt
except ImportError:
    msvcrt = None
import io
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Lock
from typing import Callable

import fitz
import httpx
import numpy as np
from opencc import OpenCC
from PIL import Image
try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    RapidOCR = None

from config import settings

OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"

# The EXTRACTION_PROMPT below already tells the model to output Traditional Chinese, but
# that's a soft instruction the model doesn't always follow perfectly (real examples:
# "陈柏安" instead of "陳柏安", "楼" instead of "樓") - a simplified character slipping
# through a name field silently creates a second, seemingly-different landowner record
# instead of matching the existing one, since matching is done by exact string. s2twp
# (Simplified -> Taiwan Traditional, with phrase-level substitutions like idioms) is run
# as a deterministic backstop over every extracted string field so this can't happen
# regardless of what the model returns.
_S2TW_CONVERTER = OpenCC("s2t")


# 字形極相近、OCR/字型常混淆的字 - 一律校正成台灣戶政/地政慣用字。
# 「内」(U+5185) -> 「內」(U+5167):地址「內湖」「內政部」等常被辨識成「内」。
_LOOKALIKE_CHAR_FIX = str.maketrans({"内": "內"})


def _to_traditional(value, key=None):
    if isinstance(value, str):
        value = value.translate(_LOOKALIKE_CHAR_FIX)
    if key == "owner_name":
        return value
    if isinstance(value, str):
        return _S2TW_CONVERTER.convert(value)
    if isinstance(value, list):
        return [_to_traditional(item, key) for item in value]
    if isinstance(value, dict):
        return {k: _to_traditional(v, k) for k, v in value.items()}
    return value


_BLANK_ADDRESS_TOKENS = {
    "",
    "空白",
    "無",
    "null",
    "none",
    "-",
    "nil",
    "n/a",
    "na",
    "依規定隱匿",
    "隱匿",
    "依規定隱匿住址",
    "住址隱匿",
}


def _clean_address(addr: str) -> str:
    if not addr or not isinstance(addr, str):
        return addr
    addr = addr.translate(_FULLWIDTH_DIGIT_MAP).strip().strip("*＊").strip()
    if addr.strip("()（） ").lower() in _BLANK_ADDRESS_TOKENS or not addr:
        return ""
    # 1. Standardize '臺' -> '台', '裏'/'裡' -> '里', '楼' -> '樓'
    addr = addr.replace("臺", "台").replace("裏", "里").replace("裡", "里").replace("楼", "樓")

    # 2. Section numbers (段) use Chinese numerals (e.g. 5段 -> 五段, 1段 -> 一段)
    cn_num_map_rev = {"1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "7": "七", "8": "八", "9": "九", "10": "十"}
    for num, cn in cn_num_map_rev.items():
        addr = addr.replace(f"{num}段", f"{cn}段")

    # 3. Floor numbers (樓) use Arabic numerals (e.g. 二樓 -> 2樓, 十一樓 -> 11樓, 二十八樓 -> 28樓)
    def _cn_to_num(cn_str: str) -> str:
        cn_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
        if not cn_str:
            return cn_str
        if cn_str == "十":
            return "10"
        if cn_str.startswith("十") and len(cn_str) == 2:
            return str(10 + cn_map.get(cn_str[1], 0))
        if "十" in cn_str:
            parts = cn_str.split("十")
            tens = cn_map.get(parts[0], 1) * 10
            ones = cn_map.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
            return str(tens + ones)
        if len(cn_str) == 1 and cn_str in cn_map:
            return str(cn_map[cn_str])
        return cn_str

    addr = re.sub(r"([一二三四五六七八九十]+)樓", lambda m: f"{_cn_to_num(m.group(1))}樓", addr)

    # 4. Collapse spaced-out digits in Taiwanese address components
    # e.g. "1 5 0 巷 3 3 5 弄 1 5 號" -> "150巷335弄15號"
    addr = re.sub(r"(\d)\s+(?=\d)", r"\1", addr)

    # 5. Fix erroneous dots/commas between digits or right before address units
    # e.g. "4.45弄" -> "445弄", "15.號" -> "15號"
    addr = re.sub(r"(\d+)\.(\d+)\s*([巷弄號樓])", r"\1\2\3", addr)
    addr = re.sub(r"(\d+)[.,、]\s*([巷弄號樓鄰])", r"\1\2", addr)

    # 6. Fix OCR misreads of '鄰' (frequently misread as '鄭', '鄰', etc.) right after neighborhood numbers
    addr = re.sub(r"(\d{1,3})\s*[鄭鄰隣粼潾嶙鏻]\s*", r"\1鄰", addr)

    # 7. Insert missing '鄰' when a number after '里'/'村'/'犂'/'梨' is missing '鄰' before a road/street/character
    # e.g. "三犂里6信義路" -> "三犂里6鄰信義路"
    addr = re.sub(r"([里村離梨犂])\s*(\d{1,3})\s*(?!鄰)([\u4e00-\u9fa5])", r"\1\2鄰\3", addr)

    # 8. Remove extra whitespace around Taiwanese address unit markers
    addr = re.sub(r"\s*([縣市區鄉鎮村里鄰路街段巷弄號樓])\s*", r"\1", addr)

    return addr


_ADDR_STOP_RE = re.compile(r"(?:權\s*利\s*範\s*圍|權\s*利\s*圍|權\s*狀\s*字\s*號|權\s*狀|當\s*期\s*申\s*報|當期申報地價|統\s*一\s*編\s*號|管\s*理\s*者|前\s*次\s*移\s*轉|前次移轉現值|歷次取得|其他登記事項)")
_OWNER_BLOCK_RE = re.compile(r"(?:[（\(]\s*[0-9]{1,4}\s*[）\)]\s*)?登記次序\s*[:：]\s*0*([0-9]{1,4})(.*?)(?=(?:[（\(]\s*[0-9]{1,4}\s*[）\)]\s*)?登記次序|\Z)", re.S)
_CUR_SHARE_RE = re.compile(r"(?<!取得)權\s*利\s*範\s*圍\s*[:：]\s*(?:(公同共有|公同|全部)\s*)?[*\s]*([0-9]+)\s*分\s*之\s*([0-9]+)")
_YM_VAL_RE = re.compile(r"([0-9]{2,3})\s*年\s*([0-9]{1,2})\s*月\s*[*\s]*([0-9,]+(?:\.[0-9]+)?)\s*元")


def _backfill_owners_from_raw(data: dict, page_texts: list[str] | None) -> dict:
    """Recover / correct owner fields straight from the raw text.

    Land-registry text is highly regular - each owner is a 「（NNNN）登記次序：XXXX …
    住　址：<addr> … 權利範圍：X分之Y … 前次移轉現值或原規定地價：<年月> <金額>元 …」
    block. The model still frequently mis-reads exactly these three fields, so where the
    raw text parses unambiguously we trust it over the model:
      - address  : filled only when the model left it blank
      - 權利範圍  : overridden when the raw fraction differs
      - 前次移轉現值/年月 : overridden with the latest 年月 found
    Batch deeds reuse 登記次序 across 地號, so the raw is split per 地號 by the running
    header 「… XXXX-XXXX地號」 and each parcel matched by parcel_number.
    """
    raw = "\n".join(page_texts or [])
    if not raw.strip():
        return data
    raw = raw.translate(_FULLWIDTH_DIGIT_MAP)

    hdrs = list(re.finditer(r"([0-9]{3,5}-[0-9]{3,5})\s*地號", raw))
    sections: list[tuple[str, str]] = []
    for idx, m in enumerate(hdrs):
        end = hdrs[idx + 1].start() if idx + 1 < len(hdrs) else len(raw)
        sections.append((re.sub(r"\D", "", m.group(1)), raw[m.end():end]))
    merged: list[tuple[str, str]] = []
    for pn, text in sections:
        if merged and merged[-1][0] == pn:
            merged[-1] = (pn, merged[-1][1] + "\n" + text)
        else:
            merged.append((pn, text))
    sections = merged

    def _order_key(v) -> str:
        digits = re.sub(r"\D", "", str(v or "")).lstrip("0")
        return digits if digits != "" else ("0" if re.search(r"\d", str(v or "")) else "")

    def _field_map(text: str) -> dict[str, dict]:
        owner_part = re.split(r"土地他項權利部|建物他項權利部|他項權利部", text)[0]
        out: dict[str, dict] = {}
        for bm in _OWNER_BLOCK_RE.finditer(owner_part):
            raw_order = bm.group(1)
            key = _order_key(raw_order)
            block = bm.group(2)
            if not key or key in out:
                continue
            rec: dict = {}

            nm = re.search(r"所有權人\s*[:：]\s*([^\n]+)", block)
            if nm:
                nval = re.split(r"\s|統一編號|住\s*址|管\s*理", nm.group(1).strip())[0].strip()
                if nval and nval not in ("空白", "（空白）", "(空白)"):
                    rec["name"] = nval

            idm = re.search(r"統\s*一\s*編\s*號\s*[:：]\s*([A-Za-z0-9*＊]+)", block)
            if idm:
                idv = idm.group(1).strip().strip("*＊")
                if idv:
                    rec["id_number"] = idm.group(1).strip()

            # 「相關他項權利登記次序：0004-000」 - links this owner to the 他項權利部 entry
            # set on their share. Absent => owner carries no 他項權利.
            rel = re.findall(
                r"相\s*關\s*他\s*項\s*權\s*利\s*登\s*記\s*次\s*序\s*[:：]\s*([0-9]{1,4}(?:\s*-\s*[0-9]{1,4})?)",
                block,
            )
            if rel:
                seen_rel: list[str] = []
                for v in rel:
                    nv = re.sub(r"\s+", "", v)
                    if nv and nv not in seen_rel:
                        seen_rel.append(nv)
                if seen_rel:
                    rec["related_enc_orders"] = seen_rel

            am = re.search(r"[住佳往]\s*[址趾]\s*[:：]?\s*(.*?)(?=\s*(?:(歷次取得)?權\s*利\s*範\s*圍|權\s*狀\s*字\s*號|當期申報地價|統\s*一\s*編\s*號|管\s*理\s*者|前次移轉現值|歷次取得|其他登記事項|[（\(]|\Z))", block, re.S)
            if am:
                raw_val = re.sub(r"\s+", "", am.group(1).strip())
                val = _ADDR_STOP_RE.split(raw_val)[0].strip()
                val = val.strip("*＊").strip()
                if val and val.strip("()（） ").lower() not in _BLANK_ADDRESS_TOKENS:
                    rec["address"] = val

            if re.search(r"權\s*利\s*範\s*圍\s*[:：]\s*(?:[*　\s]*)(?:公同共有|公同)", block):
                rec["is_pooled"] = True

            sm = _CUR_SHARE_RE.search(block)
            if sm:
                prefix_matched = sm.group(1) or ""
                if "公同" in prefix_matched:
                    rec["is_pooled"] = True
                den, num = int(sm.group(2)), int(sm.group(3))  # 「X分之Y」 == Y/X
                if den > 0 and 0 < num <= den:
                    rec["share"] = (num, den)

            li = block.find("前次移轉現值或原規定地價")
            if li != -1:
                tail = block[li + len("前次移轉現值或原規定地價"):]
                stop = tail.find("其他登記事項")
                if stop != -1:
                    tail = tail[:stop]
                dated = []
                for ym in _YM_VAL_RE.finditer(tail):
                    y, mo, v = int(ym.group(1)), int(ym.group(2)), ym.group(3).replace(",", "")
                    try:
                        dated.append(((y, mo), f"{int(y):03d}年{int(mo):02d}月", float(v)))
                    except ValueError:
                        pass
                if dated:
                    dated.sort(key=lambda t: t[0])
                    rec["value_period"] = dated[-1][1]
                    rec["value"] = dated[-1][2]

            if rec:
                out[key] = rec
        return out

    # Always available whole-document field map. Used as the fallback whenever a
    # per-地號 section can't be matched to a parcel (the model's parcel_number
    # formatting isn't guaranteed to digit-match the OCR page header - e.g. it
    # returns "301-2" while the header reads "0301-0002"), which otherwise left the
    # address blank even though the raw text clearly had it.
    global_map = _field_map(raw)

    def _order_key(v) -> str:
        digits = re.sub(r"\D", "", str(v or "")).lstrip("0")
        return digits or ""

    def _id_key(v) -> str:
        return re.sub(r"[^A-Za-z0-9]", "", str(v or "")).upper()

    def _apply(owners: list, fmap: dict[str, dict]) -> None:
        by_id = {
            _id_key(r["id_number"]): r
            for r in fmap.values()
            if r.get("id_number") and _id_key(r["id_number"])
        }
        for o in owners or []:
            o_id = _id_key(o.get("id_number"))
            rec = fmap.get(_order_key(o.get("registration_order")))
            # If the order-matched record's id_number contradicts the owner's, this is
            # a cross-地號 collision (orders repeat between parcels); trust id instead.
            if rec and o_id and rec.get("id_number") and _id_key(rec["id_number"]) != o_id:
                rec = None
            if not rec and o_id:
                rec = by_id.get(o_id)
            if not rec:
                continue
            raw_name = (rec.get("name") or "").strip()
            cur_name = (o.get("owner_name") or "").strip()
            if raw_name and raw_name != cur_name:
                # Overwrite when the model's name is empty, all-masked ("＊＊"), or a
                # strict suffix of the raw name (i.e. it dropped the leading surname,
                # "陳＊＊" -> "＊＊"). Otherwise keep what the model/vision read.
                degenerate = cur_name == "" or set(cur_name) <= {"＊", "*", "○", "O"}
                dropped_surname = len(raw_name) > len(cur_name) and raw_name.endswith(cur_name)
                if degenerate or dropped_surname:
                    o["owner_name"] = raw_name
            cur_addr = (o.get("address") or "").strip()
            if (not cur_addr or cur_addr.strip("()（） ").lower() in _BLANK_ADDRESS_TOKENS) and rec.get("address"):
                o["address"] = _clean_address(rec["address"])
            if rec.get("is_pooled"):
                o["is_pooled"] = True
            if rec.get("share"):
                num, den = rec["share"]
                if (o.get("ownership_numerator"), o.get("ownership_denominator")) != (num, den):
                    o["ownership_numerator"], o["ownership_denominator"] = num, den
            if rec.get("value_period"):
                o["declared_value_period"] = rec["value_period"]
                o["declared_value_per_sqm"] = rec.get("value")
            # Raw text is authoritative for 相關他項權利登記次序 - the model routinely
            # omits it. Only fill when the model didn't already provide one.
            if rec.get("related_enc_orders") and not o.get("related_encumbrance_orders"):
                o["related_encumbrance_orders"] = list(rec["related_enc_orders"])

    for parcel in data.get("land_parcels", []) or []:
        pn = re.sub(r"\D", "", str(parcel.get("parcel_number") or ""))
        fmap = {}
        for spn, stext in sections:
            if not spn or not pn:
                continue
            # tolerant match: exact, or either side a suffix of the other (handles
            # "301-2" vs "0301-0002" / "30010002")
            if spn == pn or (len(pn) >= 4 and spn.endswith(pn)) or (len(spn) >= 4 and pn.endswith(spn)):
                fmap = _field_map(stext)
                break
        if not fmap and len(sections) == 1:
            fmap = _field_map(sections[0][1])
        # Fall back to the whole-document map when the per-地號 section couldn't be
        # matched - _apply only fills BLANK fields and matches each owner by
        # registration_order (and id_number), so a wrong-地號 record can't overwrite
        # a good one.
        _apply(parcel.get("owners"), fmap or global_map)

    for building in data.get("buildings", []) or []:
        _apply(building.get("owners"), global_map or (sections and _field_map(sections[-1][1])) or {})

    return data


# Backwards-compatible alias.
_backfill_owner_addresses = _backfill_owners_from_raw


def _fix_ownership_fractions(result: dict) -> dict:
    """A single owner's 權利範圍 (ownership share) can never exceed the whole - numerator
    must be <= denominator. The prompt below already asks the model to self-correct a
    reversed "X分之Y" fraction, but that's a soft instruction; this is a deterministic
    backstop (same idea as _to_traditional above) that swaps the two whenever the
    extracted numerator is larger, so a reversed fraction can't silently produce a >100%
    share and blow up the DB's ownership_share_pct column."""
    for owner in [o for parcel in result.get("land_parcels", []) for o in parcel.get("owners", [])]:
        num, den = owner.get("ownership_numerator"), owner.get("ownership_denominator")
        if isinstance(num, int) and isinstance(den, int) and den and num > den:
            owner["ownership_numerator"], owner["ownership_denominator"] = den, num
    for building in result.get("buildings", []):
        for owner in building.get("owners", []):
            num, den = owner.get("ownership_numerator"), owner.get("ownership_denominator")
            if isinstance(num, int) and isinstance(den, int) and den and num > den:
                owner["ownership_numerator"], owner["ownership_denominator"] = den, num
    return result


def _normalize_null_values(value):
    """Normalize model-generated string sentinels to real JSON null values."""
    if isinstance(value, dict):
        return {k: _normalize_null_values(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_null_values(v) for v in value]
    if isinstance(value, str) and value.strip().lower() in {"null", "none", "nil", "n/a", "na", ""}:
        return None
    return value


# A 收件字號 such as 「信義字第028163號」/「北投字第12345號」 - looks like this and nothing
# else. Used to catch a right_holder that is actually the file number, not a name.
_FILE_NUMBER_RE = re.compile(r"^.{0,8}字第[\d\-]+號?$")


def _validation_problems(data: dict, page_texts: list[str] | None = None) -> list[dict]:
    """Deterministic quality checks for title-deed extraction.

    Besides checking the JSON itself, optionally inspect the raw OCR pages.  A key
    failure mode on real deeds is: OCR clearly contains 「他項權利事項」/「抵押權」,
    but the model returns encumbrances=[] .  That is a structural extraction failure,
    so it must trigger a targeted re-OCR + re-extraction instead of being accepted.
    """
    problems: list[dict] = []

    # Raw OCR evidence that an encumbrance section exists somewhere in this chunk.
    raw_has_encumbrance = False
    if page_texts:
        raw_text = "\n".join(page_texts)
        raw_has_encumbrance = bool(re.search(
            r"他項權利事項|他項權利部|最高限額抵押權|抵押權|設定義務人|債務人及債務額比例",
            raw_text,
        ))

    for parcel in data.get("land_parcels", []):
        parcel_no = parcel.get("parcel_number")
        if not parcel_no:
            problems.append({"type": "MISSING_PARCEL_NUMBER", "parcel": None})

        if parcel.get("area_sqm") in (None, 0, "0", "0.0"):
            problems.append({"type": "MISSING_AREA", "parcel": parcel_no})

        seen = set()
        total = 0.0
        for owner in parcel.get("owners", []) or []:
            order = str(owner.get("registration_order") or "").strip()
            identity = (
                order,
                str(owner.get("id_number") or "").strip(),
                str(owner.get("owner_name") or "").strip(),
            )
            if order and identity in seen:
                continue
            if order:
                seen.add(identity)
            num = owner.get("ownership_numerator")
            den = owner.get("ownership_denominator")
            if isinstance(num, int) and isinstance(den, int) and den > 0:
                if num > den:
                    problems.append({
                        "type": "INVALID_FRACTION",
                        "parcel": parcel_no,
                        "registration_order": order,
                    })
                total += num / den
            if not owner.get("owner_name"):
                problems.append({
                    "type": "MISSING_OWNER_NAME",
                    "parcel": parcel_no,
                    "registration_order": order,
                })

        if total > 1.0001:
            problems.append({
                "type": "OWNERSHIP_OVER_100",
                "parcel": parcel_no,
                "total_pct": round(total * 100, 2),
            })

        # Sum of all 分別共有 owners' 權利範圍 on one 地號 should land near 100%. Well
        # under that means a fraction was misread (defaulted to a tiny/placeholder
        # value) or an owner row was dropped - both are exactly the failure the user
        # sees. 公同共有 legitimately sums low, so skip when the raw text shows it.
        owners_here = parcel.get("owners", []) or []
        all_counted = owners_here and all(
            isinstance(o.get("ownership_numerator"), int)
            and isinstance(o.get("ownership_denominator"), int)
            and o.get("ownership_denominator")
            for o in owners_here
        )
        raw_pooled = bool(page_texts) and "公同共有" in "\n".join(page_texts)
        if len(owners_here) >= 2 and all_counted and not raw_pooled and total < 0.98:
            problems.append({
                "type": "OWNERSHIP_SUM_LOW",
                "parcel": parcel_no,
                "total_pct": round(total * 100, 2),
            })

        owner_orders = {
            str(o.get("registration_order")).strip()
            for o in parcel.get("owners", []) or []
            if o.get("registration_order")
        }
        enc_orders = {
            str(e.get("registration_order")).strip()
            for e in parcel.get("encumbrances", []) or []
            if e.get("registration_order")
        }
        # Check if owner's transfer value is wrongly populated with parcel's current declared value
        p_period = (parcel.get("declared_value_period") or "").strip()
        p_val = parcel.get("declared_value_per_sqm")
        if p_period or p_val is not None:
            for owner in parcel.get("owners", []) or []:
                o_period = (owner.get("declared_value_period") or "").strip()
                o_val = owner.get("declared_value_per_sqm")
                if p_period and o_period == p_period:
                    problems.append({
                        "type": "TRANSFER_VALUE_IS_PARCEL_DECLARED_VALUE",
                        "parcel": parcel_no,
                        "owner": owner.get("owner_name"),
                        "message": f"所有權人 '{owner.get('owner_name')}' 的前次移轉現值年月({o_period})不可誤抓為標示部的當期申報地價年月({p_period})"
                    })

        for overlap in sorted(owner_orders & enc_orders):
            problems.append({
                "type": "OWNER_ENCUMBRANCE_OVERLAP",
                "parcel": parcel_no,
                "registration_order": overlap,
            })

    # If the OCR text explicitly contains an encumbrance section but this extraction
    # produced no encumbrance anywhere, flag it.  This catches the exact 0242-0000 case
    # where the source page visibly contains 「他項權利事項」 but the UI showed 0 rows.
    if raw_has_encumbrance:
        parcel_enc_count = sum(
            len(p.get("encumbrances") or [])
            for p in data.get("land_parcels", []) or []
        )
        top_enc_count = len(data.get("encumbrances") or [])
        if parcel_enc_count + top_enc_count == 0:
            problems.append({
                "type": "ENCUMBRANCE_SECTION_MISSING",
                "parcel": None,
                "message": "OCR 原文出現他項權利/抵押權關鍵字，但 JSON 沒有任何他項權利資料",
            })

    for building in data.get("buildings", []) or []:
        if building.get("total_area_sqm") in (None, 0, "0", "0.0") and building.get("floor_area_sqm") in (None, 0, "0", "0.0"):
            problems.append({
                "type": "MISSING_BUILDING_AREA",
                "building": building.get("building_number"),
            })

    # right_holder must be the 「權利人」 name, never the 「字號」 (收件字號). A value that
    # is nothing but a "XX字第<digits>號" file number means the model grabbed the wrong
    # line - flag it so the chunk is re-extracted with a targeted instruction.
    def _iter_all_encumbrances():
        for parcel in data.get("land_parcels", []) or []:
            for enc in parcel.get("encumbrances", []) or []:
                yield parcel.get("parcel_number"), enc
        for enc in data.get("encumbrances", []) or []:
            yield None, enc

    for parcel_ref, enc in _iter_all_encumbrances():
        holder = str(enc.get("right_holder") or "").strip()
        if holder and _FILE_NUMBER_RE.match(holder):
            problems.append({
                "type": "RIGHT_HOLDER_IS_FILE_NUMBER",
                "parcel": parcel_ref,
                "registration_order": str(enc.get("registration_order") or "").strip(),
                "value": holder,
            })

    # Completeness: every 「登記次序 XXXX」 printed in the raw OCR text should show up
    # somewhere in the extraction (as an owner or an encumbrance). If the raw text
    # clearly references registration orders the JSON never produced, the model
    # dropped rows - most often an owner list that got split across a chunk boundary
    # or truncated in a long co-owner run. Flag it so the chunk is re-extracted.
    if page_texts:
        raw_text = "\n".join(page_texts)

        def _norm_order(value) -> str:
            digits = re.sub(r"\D", "", str(value or ""))
            return str(int(digits)) if digits else ""

        raw_orders = {
            _norm_order(m)
            for m in re.findall(r"登記次序[^0-9]{0,6}(\d{1,4})", raw_text)
        }
        raw_orders.discard("")

        got_orders: set[str] = set()
        for parcel in data.get("land_parcels", []) or []:
            for owner in parcel.get("owners", []) or []:
                got_orders.add(_norm_order(owner.get("registration_order")))
            for enc in parcel.get("encumbrances", []) or []:
                got_orders.add(_norm_order(enc.get("registration_order")))
        for enc in data.get("encumbrances", []) or []:
            got_orders.add(_norm_order(enc.get("registration_order")))
        for building in data.get("buildings", []) or []:
            for owner in building.get("owners", []) or []:
                got_orders.add(_norm_order(owner.get("registration_order")))
        got_orders.discard("")

        missing_orders = sorted(raw_orders - got_orders, key=lambda s: int(s))
        # >= 2 missing (not just 1) to avoid tripping on a single stray OCR read of the
        # literal 「登記次序」 in an unrelated context, or a building order when the caller
        # asked for land only.
        if len(missing_orders) >= 2 and len(got_orders) < len(raw_orders):
            problems.append({
                "type": "OWNER_ROWS_INCOMPLETE",
                "parcel": None,
                "message": f"OCR 原文出現登記次序 {missing_orders}，但抽取結果沒有對應的所有權人／他項權利資料",
            })

        # The deed prints a 「住址」 line for every owner on 第一/二類 謄本. If the raw text
        # clearly has 住址 lines but owners came back with a blank address, the model
        # skipped that line (or copied 「(空白)」 from 其他登記事項). 第三類 legitimately
        # omits addresses, so skip it there.
        # Count only 住址 labels that are actually followed by an address - a
        # 「住　址：（空白）」 (e.g. 中華民國 / 管理機關 rows) legitimately has none.
        addr_label_count = len(re.findall(r"[住佳往]\s*[址趾]\s*[:：]?\s*(?!（?\s*空白\s*）?)\S", raw_text))
        is_third = "第三類" in str(data.get("deed_category") or "")
        if addr_label_count and not is_third:
            blank_addr = 0
            for _p in data.get("land_parcels", []) or []:
                for _o in _p.get("owners", []) or []:
                    _a = str(_o.get("address") or "").strip()
                    if not _a or _a in ("(空白)", "（空白）", "空白", "null", "無"):
                        blank_addr += 1
            for _b in data.get("buildings", []) or []:
                for _o in _b.get("owners", []) or []:
                    _a = str(_o.get("address") or "").strip()
                    if not _a or _a in ("(空白)", "（空白）", "空白", "null", "無"):
                        blank_addr += 1
            if blank_addr and addr_label_count >= blank_addr:
                problems.append({
                    "type": "ADDRESS_MISSING",
                    "parcel": None,
                    "message": f"原文有 {addr_label_count} 個「住址」欄位，但有 {blank_addr} 位所有權人的 address 為空",
                })

    return problems


def _needs_quality_retry(data: dict, page_texts: list[str] | None = None) -> bool:
    """Return True when deterministic validation finds high-value structural errors."""
    return bool(_validation_problems(data, page_texts))



# OCR(11): 他項權利「對應地號」只保留最後的 4碼-4碼 地號。
def _normalize_applies_to_parcels(value):
    """
    例如：
      祥和段三小段0242-0000 -> 0242-0000
      祥和段三小段 0244-0000 -> 0244-0000

    若找不到標準地號格式，保留原值，避免誤刪真實資料。
    """
    if value is None:
        return None

    if isinstance(value, list):
        return [
            _normalize_applies_to_parcels(v)
            for v in value
        ]

    s = str(value).strip()
    if not s:
        return None

    # 只保留地號/建號數字，丟掉前面的段名（例如
    # 「西湖段二小段 01805-000 01852-000 01853-000」-> 「01805-000 01852-000 01853-000」、
    # 「祥和段三小段0242-0000」-> 「0242-0000」）。土地地號多為 4-4，建號多為 5-3，
    # 一律接受 3~5 碼 - 2~4 碼。找不到就保留原值，避免誤刪「全部」等文字。
    nums = re.findall(r'\d{3,5}-\d{2,4}', s)
    if nums:
        return " ".join(nums)

    return s


def _normalize_encumbrance_parcel_fields(data):
    """統一所有他項權利的 applies_to_parcels 顯示格式。"""
    for holder in (data.get("land_parcels", []) or []) + (data.get("buildings", []) or []):
        for enc in holder.get("encumbrances", []) or []:
            enc["applies_to_parcels"] = _normalize_applies_to_parcels(
                enc.get("applies_to_parcels")
            )

    for enc in data.get("encumbrances", []) or []:
        enc["applies_to_parcels"] = _normalize_applies_to_parcels(
            enc.get("applies_to_parcels")
        )

    return data



# OCR(12): 「前次移轉現值或原規定地價」若同一所有權人/資料中有多筆年月，
# 自動依民國年月排序，取最新一筆；不與「當期申報地價」混用。
def _roc_year_month_key(value):
    """Return sortable (ROC year, month) from strings such as 92年05月 / 092年05月."""
    if value is None:
        return None
    s = str(value).strip()
    m = re.search(r'(\d{2,3})\s*年\s*(\d{1,2})\s*月', s)
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2))
    if not 1 <= month <= 12:
        return None
    return (year, month)


def _extract_transfer_value_candidates(owner, parcel=None):
    """
    收集 owner 中可能存在的歷次「前次移轉現值/原規定地價」資料。
    支援：
      - transfer_history / previous_transfer_history / value_history
      - 單一 declared_value_per_sqm + declared_value_period
    嚴格過濾：若抓到的年月/金額與土地標示部的「當期申報地價」完全一致，視為誤抓並排除。
    """
    candidates = []

    p_period = (parcel.get("declared_value_period") or "").strip() if parcel else ""
    p_val = parcel.get("declared_value_per_sqm") if parcel else None

    history_keys = (
        "transfer_history",
        "previous_transfer_history",
        "value_history",
        "declared_value_history",
        "previous_transfer_values",
    )

    for key in history_keys:
        history = owner.get(key)
        if not isinstance(history, list):
            continue

        for item in history:
            if not isinstance(item, dict):
                continue

            period = (
                item.get("period")
                or item.get("declared_value_period")
                or item.get("transfer_period")
                or item.get("date")
            )
            value = (
                item.get("value")
                if item.get("value") is not None
                else item.get("declared_value_per_sqm")
            )

            # 過濾混入當期申報地價的錯誤
            s_period = str(period or "").strip()
            if p_period and s_period == p_period:
                continue
            if p_val is not None and value is not None:
                try:
                    if abs(float(value) - float(p_val)) < 0.01:
                        continue
                except (ValueError, TypeError):
                    pass

            date_key = _roc_year_month_key(period)
            if date_key and value is not None:
                candidates.append((date_key, period, value))

    # AI 若只留下單筆資料，也要檢查是否與當期申報地價重複
    period = owner.get("declared_value_period")
    value = owner.get("declared_value_per_sqm")

    s_period = str(period or "").strip()
    is_leaked_parcel_val = False
    if p_period and s_period == p_period:
        is_leaked_parcel_val = True
    if p_val is not None and value is not None:
        try:
            if abs(float(value) - float(p_val)) < 0.01:
                is_leaked_parcel_val = True
        except (ValueError, TypeError):
            pass

    if not is_leaked_parcel_val:
        date_key = _roc_year_month_key(period)
        if date_key and value is not None:
            candidates.append((date_key, period, value))

    return candidates


def _keep_latest_transfer_value(owner, parcel=None):
    """
    將 owner 的 declared_value_period / declared_value_per_sqm
    統一為日期最新的一筆。

    注意：這個函式只處理「前次移轉現值或原規定地價」，
    絕不拿 parcel 的「當期申報地價」來填入 owner。
    """
    candidates = _extract_transfer_value_candidates(owner, parcel=parcel)
    if not candidates:
        owner["declared_value_period"] = None
        owner["declared_value_per_sqm"] = None
        owner["transfer_history"] = []
        return owner

    # 同年月若有多筆，保留最後一筆；日期不同則取最新年月。
    candidates.sort(key=lambda x: x[0])
    _, period, value = candidates[-1]

    # Keep the full history for audit/debugging, but expose only the newest
    # record through the two fields used by the website.
    history = []
    seen = set()
    for date_key, raw_period, raw_value in candidates:
        key = (date_key, str(raw_value).strip())
        if key in seen:
            continue
        seen.add(key)
        history.append({
            "period": raw_period,
            "value": raw_value,
        })

    history.sort(
        key=lambda item: _roc_year_month_key(item.get("period")) or (-1, -1)
    )
    owner["transfer_history"] = history
    owner["declared_value_period"] = period
    owner["declared_value_per_sqm"] = value

    return owner


def _normalize_latest_transfer_values(data):
    """對所有土地所有權人套用最新前次移轉現值/原規定地價規則。"""
    for parcel in data.get("land_parcels", []) or []:
        for owner in parcel.get("owners", []) or []:
            _keep_latest_transfer_value(owner, parcel=parcel)

    for building in data.get("buildings", []) or []:
        for owner in building.get("owners", []) or []:
            _keep_latest_transfer_value(owner, parcel=None)

    return data


def _detect_deed_category(data: dict) -> str:
    category = data.get("deed_category")
    is_building = bool(data.get("buildings") and not data.get("land_parcels"))
    prefix = "建物登記" if is_building else "土地登記"

    if category and isinstance(category, str) and ("類" in category):
        s = category.strip()
        if "一" in s or "1" in s:
            return f"{prefix}第一類謄本"
        if "二" in s or "2" in s:
            return f"{prefix}第二類謄本"
        if "三" in s or "3" in s:
            return f"{prefix}第三類謄本"

    id_numbers = []
    for p in data.get("land_parcels", []) or []:
        for o in p.get("owners", []) or []:
            if o.get("id_number"):
                id_numbers.append(str(o["id_number"]))

    for b in data.get("buildings", []) or []:
        for o in b.get("owners", []) or []:
            if o.get("id_number"):
                id_numbers.append(str(o["id_number"]))

    if any("*" in id_num or "隱匿" in id_num for id_num in id_numbers):
        return f"{prefix}第二類謄本"

    if any(re.match(r"^[A-Z][12]\d{8}$", id_num, re.I) for id_num in id_numbers):
        return f"{prefix}第一類謄本"

    return f"{prefix}第二類謄本"


def _post_process_extracted_data(data: dict) -> dict:
    # 前次移轉現值／原規定地價：多筆歷次紀錄時自動取最新民國年月。
    data = _normalize_latest_transfer_values(data)

    # 統一他項權利「對應地號」：只保留最後的 XXXX-XXXX。
    data = _normalize_encumbrance_parcel_fields(data)
    if not isinstance(data, dict):
        return data

    data = _normalize_null_values(data)

    # Fix fractions
    data = _fix_ownership_fractions(data)

    # Convert simplified to traditional (except owner_name)
    data = _to_traditional(data)

    # Clean address AFTER _to_traditional so OpenCC never turns '里' into '裏'
    for parcel in data.get("land_parcels", []):
        for owner in parcel.get("owners", []):
            if owner.get("address"):
                owner["address"] = _clean_address(owner["address"])

    for bldg in data.get("buildings", []):
        if bldg.get("building_address"):
            bldg["building_address"] = _clean_address(bldg["building_address"])
        for owner in bldg.get("owners", []):
            if owner.get("address"):
                owner["address"] = _clean_address(owner["address"])

    data = _fix_known_entity_names(data)

    data["deed_category"] = _detect_deed_category(data)

    return data


# Registered names of institutions that officially use 「台」, not 「臺」 - OCR and the
# s2twp conversion both tend to "correct" these to 臺. Substring-replaced only inside
# name fields (owner_name / right_holder), never addresses, so 臺北市 etc. are untouched.
# Match enough trailing context (銀行/公司…) that a bare city name can't hit by accident.
_KNOWN_ENTITY_NAME_FIXES = {
    "臺新國際商業銀行": "台新國際商業銀行",
    "臺新銀行": "台新銀行",
    "臺北富邦商業銀行": "台北富邦商業銀行",
    "臺北富邦銀行": "台北富邦銀行",
    "臺中商業銀行": "台中商業銀行",
}


def _fix_known_entity_names(data: dict) -> dict:
    def _fix(name):
        if not isinstance(name, str) or not name:
            return name
        for wrong, right in _KNOWN_ENTITY_NAME_FIXES.items():
            if wrong in name:
                name = name.replace(wrong, right)
        return name

    for holder in (data.get("land_parcels", []) or []) + (data.get("buildings", []) or []):
        for owner in holder.get("owners", []) or []:
            owner["owner_name"] = _fix(owner.get("owner_name"))
        for enc in holder.get("encumbrances", []) or []:
            enc["right_holder"] = _fix(enc.get("right_holder"))
    for enc in data.get("encumbrances", []) or []:
        enc["right_holder"] = _fix(enc.get("right_holder"))
    return data


# OCR(12): latest transfer-value selection is enforced in Python post-process.
EXTRACTION_PROMPT = """你是台灣地政士助理。以下會依序提供同一份謄本文件連續頁面的「原始掃描影像」以及「本地 OCR 引擎\
辨識出的文字」。請以「影像」為準,OCR 文字只當作輔助參考:遇到欄位對應(哪個地址/持分/統一編號屬於哪個所有權人)、\
表格結構、字形相近的字、數字,一律回頭看影像判讀;OCR 文字與影像不一致時,以影像為準。若某頁沒有附影像,才單獨依該頁\
OCR 文字判讀。這份文件可能是「單一地號/建號」的謄本,也可能是「批次謄本」——同一份文件裡連續印著好幾筆不同地號、\
好幾筆不同建號(例如信義區祥和段三小段0242-0000、0250-0000...等多筆地號依序印在同一份 PDF 裡),每筆地號/建號底下\
又可能有一長串繼承共有人(常見一筆地號有 10 位以上所有權人,分散在好幾頁)。請通盤閱讀所有頁面後,依照提供的 JSON \
schema 回傳結構化結果。

OCR 文字品質提醒:這些掃描件背景印有防偽浮水印,OCR 有時會把浮水印紋路誤判成一串沒有意義的英數字雜訊(例如\
「DCDDdDDDdDdDADCDdDDdDDdDdDDdDdCDDDQDD」這種夾雜在正常文字行之間的重複亂碼),請自行判斷、忽略這類雜訊,絕對不要\
當成真實資料填入任何欄位;OCR 也可能把個別字認錯(例如「日」認成「白」、「義」認成「羲」、「臺/台」認成「基」或\
「壹」),請依上下文合理判斷還原正確字,不要照單全收——這種字形相近誤讀不限於這幾個例子,任何欄位只要出現不合常理、\
明顯不是台灣戶政/地政慣用字的內容,都要懷疑是 OCR 誤讀,依上下文、同一份文件其他筆乾淨的對照資料還原成合理的字。

- 【一律輸出繁體中文】所有文字欄位(姓名、地址、地段、權利種類等)一律輸出繁體中文,不可以有簡體字殘留。這份\
OCR 引擎的辨識結果偶爾會混入簡體字或簡體/繁體之間的中間型寫法(例如「楼」應為「樓」、「弄」被誤植等),只要看到\
明顯是簡體寫法的字,一律還原成對應的正體/繁體字再填入欄位,不要原樣照抄簡體字。

重要規則:
- 【不可漏列任何登記次序】土地／建物所有權部裡每一個「登記次序」都必須輸出成一位 owner,他項權利部裡每一個\
「登記次序」都必須輸出成一筆 encumbrance,一筆都不能略過或合併。一筆地號常有十幾位繼承共有人、分散在好幾頁,\
請逐頁逐列點名到最後一位,不要因為名單很長就截斷。若不確定某列是否為獨立一筆,寧可多列一筆,交給人工刪除。
- 【住址一定要抓】每一位所有權人底下都會有一行「住　址:」(字中間可能有全形空白),後面接的完整地址就是 address。\
地址值有時會換行才接完(下一行才是門牌「XX號YY樓之Z」),要把換行後的部分一起接起來,直到遇到「權利範圍:」\
「權狀字號:」「當期申報地價:」或下一筆「登記次序」為止。只要原文有「住　址:」這一行,address 就絕對不可以留空、\
不可以填 null、不可以填「(空白)」——「(空白)」只會出現在「其他登記事項:」,永遠不是住址,不可以拿來當 address。\
第二類謄本的住址通常仍完整印出(只有身分證字號會遮成 F220****6 這種),不要因為是第二類就不填住址。\
- 【address 欄位務必逐字檢查】所有權人的 address(住址)欄位,OCR 常常會在門牌號碼中間誤插入一個不該有的\
「.」或「,」符號,把原本連續的三位數字拆成「一位.兩位」或「兩位.一位」的樣子,例如原文其實是「445弄」,OCR 卻印成\
「4.45弄」或「44.5弄」;同一份文件裡其他筆住址如果有印出乾淨、沒有被拆開的同類型巷弄號碼(例如同一頁另一位所有\
權人的住址寫「445弄13號」),就是最直接的證據,證明這一整份文件的門牌號碼原文根本不含任何「.」或「,」,那麼看到\
「4.45弄」「44.5弄」這種格式時,必須視為 OCR 雜訊,一律拿掉中間的符號、還原成連續數字(「4.45弄」→「445弄」)\
再填入 address,絕對不可以把帶有「.」或「,」的門牌號碼原樣填入 address 欄位。同樣道理,地址裡任何段落(不只是\
巷弄號碼)如果出現看起來突兀、跟同一份文件其他乾淨地址對照後明顯是多餘插入的字或符號(例如「4期大安路1段」\
這種在正常地址格式裡不會出現「期」字的地方),也一律視為 OCR 雜訊拿掉,不要照抄進 address 欄位。「鄰」這個字\
(例如「4鄰」)常被 OCR 認成「郡」或直接漏掉,台灣地址裡數字後面接的單位字如果不是合理的「鄰」,依上下文還原。
- 【address 結尾的「之X」千萬不要漏掉】台灣地址常見門牌號碼後面接「之一」「之2」這種同一個門牌再分割出的次編號\
(例如「2樓之1」「65號之3」),這個「之X」後綴是地址不可或缺的一部分,絕對不可以因為它印得比較小、比較靠後面\
就漏抄——填入 address 欄位時要包含完整的「之X」,不要只填到「2樓」就結束,漏掉後面的「之一」。
- 【address 開頭的縣市/行政區字形校正】OCR 常把地址開頭的縣市名稱認錯成字形相近但意思不通的字,例如把\
「臺北市」「台北市」誤認成「壹北市」「基北市」(臺/台 vs 壹/基),把「信義區」誤認成「信羲區」(義 vs 羲)。台灣\
地址開頭一定是「臺北市/台北市/新北市/桃園市...」等實際存在的縣市名稱,不可能是「壹北市」「基北市」這種不存在的\
地名;同一份文件裡通常會有好幾位所有權人的地址,只要有任何一筆印得比較清楚、能確認正確的縣市/行政區名稱,其他筆\
地址開頭如果明顯是同一個縣市卻被 OCR 認成形似但不合理的字,一律依照清楚那筆校正過來,不要把這種不存在的地名原樣\
照抄進 address 欄位——這條規則不限於「壹/基」這兩個例子,任何開頭字看起來不像真實縣市名稱的情況都要比照處理。
- 【address 整段每個地名都要交叉比對,不是只看開頭縣市】同一份文件裡,同一棟建物/同一個門牌下的所有權人,\
地址往往除了門牌號碼(樓層、之幾號)不同以外,前面的縣市、行政區、里、路段、巷弄幾乎完全一樣——這是最好用的\
校正依據。例如同一份文件裡如果分別出現「台北市信義區三型里6信義路五段150巷335弄3號」和「台北市信義區三張犁里\
6鄰信義路五段150巷335弄9號」,兩筆的巷弄門牌前段明顯是同一個地方,只是其中一筆的「里」名被 OCR 漏字/認錯\
(「三型里」應為「三張犁里」,「三張犁」是台北市信義區真實存在的地名,「三型」不是),應該以資訊完整、合理的\
那一筆為準,把有缺漏或不合理的那一筆校正一致,不要讓同一棟樓的地址在「里」名這種中段欄位上兜不起來。不只是里名,\
路名、段名、巷弄名只要同一份文件裡有其他筆可以互相印證,都要比照校正,不要各筆各自照抄互相矛盾的版本。就算\
同一份文件裡剛好只有一筆地址、沒有其他筆可以交叉比對,也要憑常識判斷「里」名是不是台灣真實存在的地名——例如\
「三型里」「三犁裡」「三里」都是「三張犁里」(台北市信義區真實地名,常搭配「信義路五段」出現)被漏字/誤字/多字\
的結果,只要看到「信義區」+「信義路五段」搭配一個像是被截斷或錯字的「X里」,一律還原成「三張犁里」。
- 【「裡」一律校正成「里」】台灣地址裡「XX里」是行政區劃分單位,不管是哪一個里名(不限於上面舉例的\
「三張犁里」,任何縣市任何區底下的里都一樣),結尾一定是「里」這個字,不可能是同音的「裡」(裡面的裡)。這是\
這份 OCR 引擎常見的同音誤植,只要看到地址裡「XX裡」這種寫法,一律無條件校正成「XX里」,不需要靠其他筆地址\
交叉比對才能判斷——這條規則本身就足夠當作校正依據。
- 每一頁最上方都會印出「XX段XX小段0242-0000地號」這樣的標題,這是每頁都會重複列印的頁首(跟頁次欄位一樣逐頁重印),\
不代表每次看到標題文字就是新的一筆——真正決定是否為新地號的關鍵,是標題裡的地號數字本身有沒有換成不同號碼。同一筆\
地號的所有權人清單常橫跨好幾頁,每一頁都會重複印同樣的標題文字,這些頁面全部算同一筆,收進同一個 land_parcels 項目\
的 owners 陣列裡,不可遺漏任何一位;只有當地號數字真的變成不同號碼時,才代表開始一筆新的土地資料,才在 land_parcels \
陣列中新增一個項目,絕對不要把同一個地號因為標題文字在好幾頁重複出現,就重複建立好幾筆一模一樣的項目。
- 同樣地,建號標題也是逐頁重複列印,判斷是否為新的一筆要看建號數字本身有沒有換,不是看標題文字有沒有再次出現;\
建物所有權人的收錄規則同上,同一建號絕對不要因為標題重複出現在好幾頁就重複建立。
- 登記次序請填「登記次序:」後面的實際值(例如「0002」),不要填每筆記錄前面括號內的流水編號(例如「(0001)」),\
這兩者不是同一個東西。
- 面積、地價、權利範圍等數字或分數欄位前後常有 * 字元作為版面對齊填充(例如「****134.00平方公尺」、\
「**********4分之1**********」),這些 * 不是資料的一部分,請忽略,只填實際的數字/文字內容。
- owners 的 ownership_numerator/ownership_denominator 只能取自單獨一行的「權利範圍:」欄位(目前的持分),\
絕對不要跟「歷次取得權利範圍:」欄位搞混——後者是這位所有權人「以前某一次取得時」的歷史持分紀錄(同一人底下\
常常會有好幾筆不同數字的歷次取得權利範圍,分別對應不同次取得的時間點),不是現在的持分,不可以拿來當作\
ownership_numerator/ownership_denominator。
- 【權利範圍分子不可能大於分母】「權利範圍:」代表這位所有權人在這筆地號/建號裡「占整體的多少比例」,單一所有\
權人的持分不可能超過整體,所以 ownership_numerator 一定要小於等於 ownership_denominator——如果讀出來的結果\
分子大於分母(例如「12/1」這種算出來超過 100% 的組合),幾乎可以確定是「X分之Y」的 X、Y 兩個數字讀反了\
(分子分母對調),請直接自行對調成分子小於分母的合理版本再填入欄位,不要照抄出分子大於分母的不合理結果。
- 他項權利部(抵押權等)緊接在它所屬的那筆地號/建號的所有權部之後印出、在下一筆地號/建號開始之前——如果一筆他項\
權利明確只對應到單一一筆地號(對應地號欄位只寫一個地號、且是這頁前後在講的那一筆),請直接收錄進那筆 land_parcels \
項目自己的 encumbrances 陣列裡,不要另外放到最外層。只有當一筆他項權利明確橫跨多筆地號/建號、或原文寫「全部」\
這種無法歸屬到單一一筆的情況,才收錄進最外層的 encumbrances 陣列,並在 applies_to_parcels 欄位依原文寫出對應的\
地號/建號。
- 他項權利的 right_type(權利種類)最常見的就是「最高限額抵押權」跟「抵押權」這兩種標準用語,如果 OCR 文字\
看起來是這兩種其中一種、只是漏字或錯字(例如「最高限抵押權」少了「額」字),請直接還原成正確的標準用語,不要\
照 OCR 錯字原樣填入;只有真的是其他種類的權利(例如「地上權」「典權」)才依原文填寫。
- 【他項權利部的人名絕對不可以填進 owners】他項權利部(抵押權等)裡出現的人名——「權利人」(通常是銀行等\
債權人)、「義務人」「債務人」(欠錢的人,常標示為「設定義務人:」或「債務人及債務額比例:」)——都是這筆\
他項權利/抵押權自己的欄位,跟「這筆地號/建號的所有權人」是完全不同的兩件事,絕對不可以把這些人名放進\
land_parcels[].owners 或 buildings[].owners 陣列裡,即使他項權利部緊接在所有權部後面印出、版面上看起來很\
靠近也一樣。owners 陣列只能收錄「所有權部」區塊裡登記次序底下明確標示「所有權人:」的人名;「權利人:」\
「義務人:」「債務人:」開頭的人名一律只能收在對應那筆他項權利/encumbrance 項目自己的 right_holder(權利人)\
欄位,不能出現在任何一筆 owners 裡,即使這份文件裡看起來所有權人湊不滿 100% 持分,也不可以把他項權利部的\
人名拿來湊數。
- 【同統一編號、姓名或地址寫法不一致時互相校正】人名不像地址開頭的縣市/里名有固定的標準寫法可以比對,OCR\
較容易把姓名中間某個字讀錯,又沒有字典可以判斷哪個版本才對——但同一份文件裡,如果同一位所有權人(統一編號\
完全相同)在好幾筆地號都有登記、其中一兩筆的姓名或戶籍地址寫法卻跟其他筆有一兩個字不一樣,這代表同一個統一\
編號被拆成好幾種姓名/地址寫法印出,實際上是同一個人,應該以同一份文件裡出現次數較多、或看起來較完整清晰的\
那個寫法為準,把其他筆的 owner_name/address 校正成一致的版本,不要讓同一個統一編號底下出現好幾種不同的姓名\
或地址寫法。這條只在統一編號確實相同時才適用,沒有統一編號可以比對、或統一編號本身就不同,就照各自實際讀到\
的內容填寫,不要臆測。地址欄位仍優先套用前面【address 整段每個地名都要交叉比對】等既有規則,這條是額外補充,\
不是取代。

1. land_parcels(土地標示部+所有權部+屬於這筆地號自己的他項權利部,陣列,一筆地號一個項目;若整份文件完全沒有\
土地部分則回傳空陣列 []):
   - township:鄉鎮市區(例如「板橋區」)
   - section:地段名稱,不含行政區前綴(例如「民族段」而非「板橋區民族段」),也不含小段名稱
   - subsection:小段名稱(若有才填,很多謄本沒有小段)。【重要】地段跟小段在原文常常連在一起印刷、中間沒有\
空格或標點,例如「祥和段三小段」,這是**兩個獨立欄位**:section 只填到第一個「段」字為止(「祥和段」),\
subsection 填後面剩下、同樣以「段」結尾的部分(「三小段」)——不要把整串「祥和段三小段」都塞進 section、\
更不可以把 subsection 填成地號或其他不相關的數字。判斷依據就是「段」這個字出現兩次,第一次結束的地方是\
section,第二次(通常較短、常見「一小段」「二小段」「三小段」這類數字+小段的格式)是 subsection。
   - parcel_number:地號(例如「1099-0000」)
   - area_sqm:土地標示部登載的面積(平方公尺),純數字。真的在文件裡找不到這個數字時,填 null,\
【絕對不可以填 0】——0 平方公尺不是任何一筆真實地號合理的面積,填 0 等於謊報「這筆地號沒有面積」,\
比留空(null)更誤導,寧可留 null 讓使用者知道需要人工補值。
   - declared_value_per_sqm:土地標示部或所有權部「當期申報地價:」欄位的金額(元/平方公尺),純數字(例如「67520.0」;【嚴禁填成「前次移轉現值」】)。找不到就填 null,不可以填 0。
   - declared_value_period:「當期申報地價:」欄位旁邊標註的年月(通常是民國年,例如「115年01月」;【嚴禁填成「前次移轉現值」】),依原文格式填寫成文字,找不到清楚的年月就填 null,不要自己推算或臆測。
   - owners(陣列,**列出這筆地號底下所有登記次序/所有權人,不要只列第一位**):
     - registration_order:登記次序(例如「0157」)
     - owner_name:所有權人姓名
     - id_number:所有權人統一編號(身分證字號)
     - ownership_numerator:「權利範圍:」欄位的分子(例如「10000000分之10364」中的 10364;不是「歷次取得權利範圍:」欄位)
     - ownership_denominator:「權利範圍:」欄位的分母(例如「10000000分之10364」中的 10000000;不是「歷次取得權利範圍:」欄位)
     - address:所有權人戶籍地址(【重要】戶籍地址中的「鄰」字如「6鄰」絕對不能遺漏、不可吃掉或刪除)
     - transfer_history(陣列):【非常重要】把該位所有權人底下「前次移轉現值或原規定地價:」出現的**每一筆歷史紀錄全部抓出來**，不要只抓第一筆。每筆包含 period(年月，例如「090年05月」) 與 value(元/平方公尺，例如 113000)。只收錄「前次移轉現值或原規定地價」這個欄位，絕對不要把「當期申報地價」混進來。若有 90年05月、91年09月、92年05月三筆，就三筆全部放進 transfer_history。
     - declared_value_per_sqm:【最終顯示值】該位所有權人底下「前次移轉現值或原規定地價:」的單價金額(元/平方公尺),純數字。若有多筆，**不要自行只抓第一筆**，先完整放入 transfer_history；系統會在後處理階段依年月自動選最新一筆。絕對不可以抓成「當期申報地價」(如 67520.0)的金額；若完全沒有則填 null。
     - declared_value_period:【最終顯示值】該位所有權人底下「前次移轉現值或原規定地價:」的年月。若有多筆，先完整放入 transfer_history；系統會依民國年月自動選最新一筆。絕對不可以抓成「當期申報地價」(如 115年01月)的年月；若完全沒有則填 null。
     - related_encumbrance_orders(陣列):該位所有權人區塊裡「相關他項權利登記次序:」這一行後面的登記次序(例如「0004-000」),逐筆放進陣列(可能有多筆)。這條是把這位所有權人連到土地他項權利部裡設定在他持分上的那筆抵押權/他項權利用的。若該所有權人區塊裡**沒有出現**「相關他項權利登記次序:」這一行,就回傳空陣列 [],不要臆測、不要從別的所有權人或標示部借。
   - encumbrances(陣列,只放明確只屬於這筆地號自己的他項權利,沒有的話回傳空陣列 []。他項權利部裡每一個「(流水號)登記次序:XXXX-XXX」區塊都要產出一筆,連號逐一、不可跳過或合併;某頁尾寫「(續次頁)」表示該筆延續到下一頁):
     - registration_order:該區塊開頭的「登記次序:XXXX-XXX」。不可用區塊中間的「標的登記次序」(那是指設定在哪位所有權人身上,不是這筆抵押權的次序)
     - applies_to_parcels:依原文填寫(通常就是這筆地號本身)
     - right_type:權利種類(例如「最高限額抵押權」)
     - right_holder:他項權利人,只取「權　利　人:」這一行後面的**名稱**(通常是銀行或公司全名,例如「台北富邦商業銀行股份有限公司」,個人則為姓名)。\
【嚴禁】把「字　號:」「收件字號:」的內容(長得像「信義字第028163號」「北投字第12345號」這種 "XX字第數字號")當成 right_holder——那是收件字號,不是權利人。若「權利人」那行讀不到名稱,寧可留空字串,也不要拿字號、收件年期、登記日期來頂替。
     - debtor_info:「債務額比例」或「債權額比例」欄位裡「N分之M」這個分數格式本身,只填分數(例如「債權額比例:全部\
*********1分之1*********」只填「1分之1」),不要包含「全部」、「債權比例:」之類的文字,也不要包含\
債務人姓名、債權總金額等其他描述。【嚴禁】填成「設定權利範圍:X分之Y」(那是設定在標的所有權人持分裡的比例)、\
「擔保債權總金額」的金額

2. encumbrances(橫跨多筆地號/建號、或寫「全部」、無法歸屬到單一一筆地號的他項權利部,陣列,可能有 0 到多筆;\
沒有的話回傳空陣列 []。已經歸進 land_parcels[].encumbrances 的項目不要在這裡重複):
   - registration_order:登記次序
   - applies_to_parcels:這筆他項權利對應到的地號/建號(可能是多筆、或「全部」,依文件原文填寫)
   - right_type:權利種類(例如「最高限額抵押權」)
   - right_holder:他項權利人,只取「權　利　人:」那行後面的名稱(銀行/公司全名或個人姓名)。【嚴禁】填成「字　號:」「收件字號:」的內容(像「信義字第028163號」這種 "XX字第數字號");讀不到名稱就留空字串,不要用字號頂替。
   - debtor_info:「債務額比例」欄位裡「N分之M」這個分數格式本身,只填分數(例如「債權額比例:全部\
*********1分之1*********」只填「1分之1」),不要包含「全部」、「債權比例:」之類的文字,也不要包含\
債務人姓名、債權總金額等其他描述

3. buildings(建物標示部+所有權部,陣列,一筆建號一個項目;若整份文件完全沒有建物部分則回傳空陣列 []):
   - building_number:建號
   - building_address:建號門牌(建物門牌地址)
   - parcel_number:建物坐落地號
   - total_floors:層數(依文件原文,例如「地上10層」)
   - floor:層次(這筆建物標示部所在的樓層,例如「三層」)
   - total_area_sqm:建物總面積(平方公尺),純數字。找不到就填 null,【絕對不可以填 0】——理由同\
land_parcels 的 area_sqm。
   - floor_area_sqm:層次面積(平方公尺,該樓層/主建物本身的面積),純數字。同樣找不到就填 null,不可以填 0。
   - accessory_use:「附屬建物用途:」欄位後面的用途文字(例如「平台」「陽台」「露臺」);沒有就填 null。
   - accessory_area_sqm:緊接在「附屬建物用途:」那一行後面的「面積:」數字(平方公尺),純數字;沒有就填 null,不可以填 0。若有多筆附屬建物,取第一筆。
   - owners(陣列,若這筆建物沒有所有權部則回傳空陣列 []):
     - registration_order:登記次序
     - owner_name:所有權人姓名
     - ownership_numerator:「權利範圍:」欄位的分子(不是「歷次取得權利範圍:」欄位)
     - ownership_denominator:「權利範圍:」欄位的分母(不是「歷次取得權利範圍:」欄位)
     - address:所有權人戶籍地址

找不到、看不清楚、或文件上沒有的欄位一律填 null(陣列則填空陣列 []),絕對不要用臆測值填補。"""


def _n(json_type: str) -> dict:
    """A nullable field in standard JSON Schema. OpenAI's structured-output "strict"
    mode requires every property (including ones that may be null) to appear in the
    object's "required" list - the type itself carries the nullability."""
    return {"type": [json_type, "null"]}


_LAND_OWNER_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "registration_order": _n("string"),
        "owner_name": _n("string"),
        "id_number": _n("string"),
        "ownership_numerator": _n("integer"),
        "ownership_denominator": _n("integer"),
        "address": _n("string"),
        "is_pooled": _n("boolean"),
        "transfer_history": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "period": _n("string"),
                    "value": _n("number"),
                },
                "required": ["period", "value"],
                "additionalProperties": False,
            },
        },
        "declared_value_per_sqm": _n("number"),
        "declared_value_period": _n("string"),
    },
    "required": [
        "registration_order",
        "owner_name",
        "id_number",
        "ownership_numerator",
        "ownership_denominator",
        "address",
        "is_pooled",
        "transfer_history",
        "declared_value_per_sqm",
        "declared_value_period",
    ],
    "additionalProperties": False,
}

_BUILDING_OWNER_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "registration_order": _n("string"),
        "owner_name": _n("string"),
        "id_number": _n("string"),
        "ownership_numerator": _n("integer"),
        "ownership_denominator": _n("integer"),
        "address": _n("string"),
        "is_pooled": _n("boolean"),
    },
    "required": ["registration_order", "owner_name", "id_number", "ownership_numerator", "ownership_denominator", "address", "is_pooled"],
    "additionalProperties": False,
}

_ENCUMBRANCE_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "registration_order": _n("string"),
        "applies_to_parcels": _n("string"),
        "right_type": _n("string"),
        "right_holder": _n("string"),
        "debtor_info": _n("string"),
    },
    "required": ["registration_order", "applies_to_parcels", "right_type", "right_holder", "debtor_info"],
    "additionalProperties": False,
}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "deed_category": _n("string"),
        "land_parcels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "township": _n("string"),
                    "section": _n("string"),
                    "subsection": _n("string"),
                    "parcel_number": _n("string"),
                    "area_sqm": _n("number"),
                    "declared_value_per_sqm": _n("number"),
                    "declared_value_period": _n("string"),
                    "owners": {"type": "array", "items": _LAND_OWNER_ITEM_SCHEMA},
                    "encumbrances": {"type": "array", "items": _ENCUMBRANCE_ITEM_SCHEMA},
                },
                "required": [
                    "township",
                    "section",
                    "subsection",
                    "parcel_number",
                    "area_sqm",
                    "declared_value_per_sqm",
                    "declared_value_period",
                    "owners",
                    "encumbrances",
                ],
                "additionalProperties": False,
            },
        },
        "encumbrances": {
            "type": "array",
            "items": _ENCUMBRANCE_ITEM_SCHEMA,
        },
        "buildings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "building_number": _n("string"),
                    "building_address": _n("string"),
                    "parcel_number": _n("string"),
                    "total_floors": _n("string"),
                    "floor": _n("string"),
                    "total_area_sqm": _n("number"),
                    "floor_area_sqm": _n("number"),
                    "accessory_use": _n("string"),
                    "accessory_area_sqm": _n("number"),
                    "owners": {"type": "array", "items": _BUILDING_OWNER_ITEM_SCHEMA},
                },
                "required": [
                    "building_number",
                    "building_address",
                    "parcel_number",
                    "total_floors",
                    "floor",
                    "total_area_sqm",
                    "floor_area_sqm",
                    "accessory_use",
                    "accessory_area_sqm",
                    "owners",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["deed_category", "land_parcels", "encumbrances", "buildings"],
    "additionalProperties": False,
}


class OcrError(Exception):
    """Raised when the OCR/extraction provider cannot be reached or returns an error."""


# Asking a vision model to read a whole large batch (dozens of pages) in a single
# request risks degenerate/truncated output - splitting into small chunks and merging
# the results client-side keeps each individual call comfortably sized.
# Four image-only registry pages already contain a large amount of dense OCR text.
# Keeping chunks small prevents a single structured-AI request from stalling for
# several minutes on 27–41 page deeds.
PAGES_PER_CHUNK = settings.OCR_PAGES_PER_CHUNK
# Each chunk (after the first) also re-includes this many trailing pages of the previous
# chunk. A 地號's owner list often spans several pages; without overlap, an owner list
# straddling a 4-page cut point gets split across two independent OpenAI calls and
# partially dropped. The parcel/building that then appears in both chunks is deduped by
# _merge_extractions, so the only cost is re-OCR'ing / re-sending a couple of pages per
# chunk. Set to 2 (not 1) because a dense 土地他項權利部 - one 地號 with many 抵押權
# entries, each block several lines, often marked 「(續次頁)」 - regularly runs across
# three pages, which a 1-page overlap still splits.
CHUNK_OVERLAP = settings.OCR_CHUNK_OVERLAP
# How many chunks' OpenAI structuring calls run concurrently in extract_title_deed. Each
# chunk's call is independent (different pages, no shared state), so this just overlaps
# their network wait time instead of serializing every chunk's full round-trip one after
# another - kept modest to stay within OpenAI's per-minute rate limits and avoid piling
# every chunk's own local-OCR thread pool on top of each other at once.
CHUNK_CONCURRENCY = settings.OCR_CHUNK_CONCURRENCY
OCR_OPENAI_TIMEOUT_SECONDS = 90.0
PDF_RENDER_DPI = 300
# Fast OCR remains the default. Only the weakest pages in each chunk are re-scanned
# with the slower engine, preserving batch speed while recovering likely misreads.
SMART_RESCAN_CONFIDENCE = 0.82
SMART_RESCAN_MAX_PAGES_PER_DOCUMENT = settings.OCR_SMART_RESCAN_MAX_PAGES
# Confidence-based smart re-scan (above) only catches text the fast engine detected but
# read uncertainly - it can't catch a field the fast engine's detector missed outright
# (no detected text = no confidence score to flag it), which is what was actually
# happening to area_sqm on some pages: the high-accuracy engine caught it on the same
# page the fast engine skipped entirely. This is a second, separate backstop for that:
# after AI structuring, if a chunk's result is missing area_sqm/total_area_sqm on any
# parcel/building, retry that whole chunk once with the high-accuracy engine. Capped at
# a small number of chunks per document (chunk-level, not page-level, since by the time
# a field is known missing the AI has already merged multiple pages' text into one
# response - there's no cheap way to know which single page within the chunk needs it).
MISSING_AREA_RESCAN_MAX_CHUNKS_PER_DOCUMENT = settings.OCR_MISSING_AREA_RESCAN_MAX_CHUNKS


# Used when extract_title_deed() is called with high_accuracy=True (the single-record
# wizard, now defaulted to the accurate engine - see high_accuracy elsewhere in this
# file). Rasterizing at a higher DPI gives the OCR model more actual pixels to
# disambiguate visually-similar characters from (壹/臺, 羲/義 etc. were still getting
# swapped even on the accurate engine at the default 200 DPI) - the accurate engine's
# per-page cost already dwarfs the extra rasterization time this adds, so there's no
# real reason to hold back resolution on this path specifically the way the fast/batch
# paths need to.
HIGH_ACCURACY_PDF_RENDER_DPI = 400


def _expand_pdf_pages(content: bytes, dpi: int = PDF_RENDER_DPI) -> list[tuple[bytes, str | None]]:
    """Splits a multi-page PDF into one page-image per page. Chunking has to operate on
    actual pages, not uploaded files - a single 27-page PDF is still just 1 "file", so
    without this a whole batch deed uploaded as one PDF would still be sent in one
    request and hit the same quality breakdown chunking is meant to avoid."""
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        page_count = doc.page_count
        # Rendering each page (rasterization + PNG encode) is the actual OCR input preparation step for
        # a large multi-page batch PDF - often more than the header OCR pass that
        # follows it. fitz's C-level rendering releases the GIL, so a small thread pool
        # (same pattern as the header-OCR pools below) lets a multi-page PDF use more
        # than one CPU core here too, instead of rasterizing pages one at a time.
        def _render_one(i: int) -> tuple[bytes, str | None]:
            # PNG is used for OCR input so fine strokes and small registry characters are preserved
            # watermark pattern; the OCR path prioritizes character fidelity over image-file size.
            # Preview images can still be downscaled separately; OCR input remains lossless.
            # painfully slow, especially over a public tunnel. High-quality JPEG is a
            # fraction of the size with no meaningful loss of text legibility.
            return doc[i].get_pixmap(dpi=dpi).tobytes("png"), "image/png"

        if page_count:
            with ThreadPoolExecutor(max_workers=min(_HEADER_OCR_WORKERS, page_count)) as pool:
                pages = list(pool.map(_render_one, range(page_count)))
        else:
            pages = []
    except Exception as exc:  # fitz raises its own exception types on malformed PDFs
        raise OcrError(f"無法讀取 PDF 檔案:{exc}") from exc
    if not pages:
        raise OcrError("PDF 檔案沒有任何頁面")
    return pages


def _flatten_to_pages(files: list[tuple[bytes, str | None]], dpi: int = PDF_RENDER_DPI) -> list[tuple[bytes, str | None]]:
    pages: list[tuple[bytes, str | None]] = []
    for content, mime_type in files:
        if (mime_type or "").lower() == "application/pdf" or content[:5] == b"%PDF-":
            pages.extend(_expand_pdf_pages(content, dpi=dpi))
        else:
            pages.append((content, mime_type))
    return pages


# A real 謄本 page carries far more embedded text than this once whitespace is
# stripped; anything below it is either a scanned image with no text layer or a
# near-empty cover page, both of which still need image OCR.
TEXT_LAYER_MIN_CHARS = 200


_PAGE_OWNER_MARKER_RE = re.compile(r"(?<!標的)(?<!他項權利)登\s*記\s*次\s*序\s*[:：]\s*(\d{3,4})(?!\s*-\s*\d)")
_PAGE_ADDR_LINE_RE = re.compile(r"[住佳往][ 　\t]{0,4}[址趾]\s*[:：]?\s*(.+)")
_PAGE_PARCEL_HDR_RE = re.compile(r"(\d{3,5})\s*-\s*(\d{3,5})\s*[地建]\s*[號琥唬]")


def _recover_burned_in_addresses(files: list[tuple[bytes, str | None]]) -> dict[tuple[str, str], str]:
    """Newer 電子謄本 burn every owner's 「住　址：…」 line into the page as a raster
    strip that never reaches the text layer, so a pure text-layer read leaves every
    戶籍地址 blank. For each such page, render + OCR it once and walk the recognised
    lines top-to-bottom: track the running 「NNNN-NNNN 地號」 header and the current
    「登記次序：XXXX」, and bind the first 住址 line after each marker to that
    (地號, 登記次序). Each address is tied to the 登記次序 printed right above it on
    the SAME page, so page-boundary straddling and a missed strip never shift another
    owner's address. Returns {(parcel_digits, order_digits): address}. No vision call.
    """
    recovered: dict[tuple[str, str], str] = {}
    for content, mime_type in files:
        is_pdf = (mime_type or "").lower() == "application/pdf" or content[:5] == b"%PDF-"
        if not is_pdf:
            continue
        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception:
            continue

        # One global reading-order stream across the whole PDF: text-layer
        # 「（M）登記次序：NNNN」 markers (exact - from the text layer) interleaved with
        # the address image strips (by page + y). An owner's 登記次序 text and its
        # address strip can land on different pages when the record sits on a page
        # boundary, so this must be matched globally, not per page.
        events: list[tuple[int, float, str, object]] = []  # (page_idx, y, kind, payload)
        needs_recovery = False
        page_needs: set[int] = set()  # page indices whose 住址 lines are missing
        for pi, page in enumerate(doc):
            try:
                raw = page.get_text("text") or ""
            except Exception:
                raw = ""
            norm_tl = _normalize_ocr_text(raw)
            has_owner = re.search(r"所有權人\s*[:：]\s*\S", norm_tl)
            has_addr = re.search(r"[住佳往][ 　\t]{0,4}[址趾]\s*[:：]", norm_tl)
            if has_owner and not has_addr and "第三類" not in norm_tl:
                needs_recovery = True
                page_needs.add(pi)
            try:
                tld = page.get_text("dict")
            except Exception:
                tld = {"blocks": []}
            cur_parcel_this_page = ""
            for blk in tld.get("blocks", []):
                for line in blk.get("lines", []):
                    ltext = "".join(sp.get("text", "") for sp in line.get("spans", []))
                    lt = _normalize_ocr_text(ltext)
                    y = line.get("bbox", (0, 0, 0, 0))[1]
                    ph = _PAGE_PARCEL_HDR_RE.search(lt)
                    # 「共有部分：…01854-000建號」 / 「共同擔保地號：…」 name a DIFFERENT
                    # 地/建號 inside the 標示部 / 他項權利部 body - not this page's own
                    # header. Binding the following 住址 strip to that number files
                    # every flat's address under the shared 共有部分 建號.
                    if ph and not re.search(r"共有部分|共同擔保|主建物|附屬建物", lt):
                        cur_parcel_this_page = ph.group(1) + ph.group(2)
                        events.append((pi, y, "parcel", cur_parcel_this_page))
                    mk = _PAGE_OWNER_MARKER_RE.search(lt)
                    if mk:
                        events.append((pi, y, "order", mk.group(1).lstrip("0") or "0"))
            try:
                info = page.get_text("rawdict")
            except Exception:
                info = {"blocks": []}
            for b in info.get("blocks", []):
                if b.get("type") != 1:
                    continue
                x0, y0, x1, y1 = b.get("bbox", (0, 0, 0, 0))
                w, h = x1 - x0, y1 - y0
                if w > 200 and 4 < h < 40 and w / max(h, 1) > 6:
                    events.append((pi, y0, "strip", (pi, x0, y0, x1, y1)))

        if not needs_recovery:
            continue

        events.sort(key=lambda e: (e[0], e[1]))
        cur_parcel = ""
        cur_order = ""
        done_order = None
        for _pi, _y, kind, payload in events:
            if kind == "parcel":
                cur_parcel = payload
            elif kind == "order":
                cur_order = payload
            elif kind == "strip" and cur_order and (cur_parcel, cur_order) not in recovered:
                if (cur_parcel, cur_order) == done_order:
                    continue
                pj, x0, y0, x1, y1 = payload
                try:
                    clip = fitz.Rect(x0 - 2, y0 - 10, x1 + 2, y1 + 12)
                    png = doc[pj].get_pixmap(dpi=400, clip=clip).tobytes("png")
                    text, _c = _ocr_page_text(png)
                    m = re.search(r"[住佳往][ 　\t]{0,4}[址趾]\s*[:：]?\s*([^\n]+)", _normalize_ocr_text(text or ""))
                    if m:
                        val = re.sub(r"\s+", "", m.group(1))
                        val = _ADDR_STOP_RE.split(val)[0].strip("*＊ ")
                        if val and val.strip("()（） ").lower() not in _BLANK_ADDRESS_TOKENS:
                            recovered[(cur_parcel, cur_order)] = val
                            done_order = (cur_parcel, cur_order)
                except Exception as exc:
                    print(f"[_recover_burned_in_addresses] strip OCR failed: {exc}", flush=True)

        # Fallback for PDFs where the 住址 lines are unmappable vector text (a font
        # with no ToUnicode) rather than raster strips: no "strip" event fires, so
        # nothing above recovers them. OCR each still-deficient page ONCE with the
        # local engine (no vision LLM) and walk it top-to-bottom the same way.
        order_pairs_by_page: dict[int, list[tuple[str, str]]] = {}
        _p = ""
        for _pi, _y, kind, payload in events:  # already sorted above
            if kind == "parcel":
                _p = payload
            elif kind == "order":
                order_pairs_by_page.setdefault(_pi, []).append((_p, payload))
        for pi in sorted(page_needs):
            wanted = [k for k in order_pairs_by_page.get(pi, []) if k not in recovered]
            if not wanted:
                continue
            try:
                png = doc[pi].get_pixmap(dpi=300).tobytes("png")
                text, _c = _ocr_page_text(png)
            except Exception as exc:
                print(f"[_recover_burned_in_addresses] full-page OCR failed: {exc}", flush=True)
                continue
            cur_p, cur_o = wanted[0][0], ""
            for ln in _normalize_ocr_text(text or "").splitlines():
                ph = _PAGE_PARCEL_HDR_RE.search(ln)
                if ph and not re.search(r"共有部分|共同擔保|主建物|附屬建物", ln):
                    cur_p = ph.group(1) + ph.group(2)
                mk = _PAGE_OWNER_MARKER_RE.search(ln)
                if mk:
                    cur_o = mk.group(1).lstrip("0") or "0"
                    continue
                am = re.search(r"[住佳往][ 　\t]{0,4}[址趾]\s*[:：]?\s*([^\n]+)", ln)
                if am and cur_o and (cur_p, cur_o) not in recovered:
                    val = re.sub(r"\s+", "", am.group(1))
                    val = _ADDR_STOP_RE.split(val)[0].strip("*＊ ")
                    if val and val.strip("()（） ").lower() not in _BLANK_ADDRESS_TOKENS:
                        recovered[(cur_p, cur_o)] = val
                        cur_o = ""
    if recovered:
        print(f"[_recover_burned_in_addresses] recovered {len(recovered)} burned-in 住址", flush=True)
    return recovered


def _apply_recovered_addresses(data: dict, recovered: dict[tuple[str, str], str]) -> dict:
    """Fill any still-blank owner 戶籍地址 from the burned-in-strip recovery map,
    matched by (地號, 登記次序) and then by 登記次序 alone."""
    if not recovered:
        return data
    by_order: dict[str, list[str]] = {}
    for (_p, o), v in recovered.items():
        by_order.setdefault(o, []).append(v)
    containers = [
        (p, p.get("parcel_number")) for p in (data.get("land_parcels", []) or [])
    ] + [
        (b, b.get("building_number")) for b in (data.get("buildings", []) or [])
    ]
    for holder, ident in containers:
        pdig = re.sub(r"\D", "", str(ident or ""))
        for owner in holder.get("owners", []) or []:
            cur = (owner.get("address") or "").strip()
            if cur and cur.strip("()（） ").lower() not in _BLANK_ADDRESS_TOKENS:
                continue
            odig = re.sub(r"\D", "", str(owner.get("registration_order") or "")).lstrip("0") or "0"
            hit = recovered.get((pdig, odig))
            if not hit:
                cands = by_order.get(odig) or []
                if len(cands) == 1:
                    hit = cands[0]
            if hit:
                owner["address"] = _clean_address(hit)
    return data


def _pdf_text_layer_overrides(files: list[tuple[bytes, str | None]]) -> list[str | None]:
    """For every flattened page (same order as _flatten_to_pages), return the PDF's
    own embedded text layer when the page already has real, extractable text - i.e.
    an electronic 謄本 downloaded from the 地政 e-service rather than a scan/photo.
    Such pages need no OCR and no vision call at all: pymupdf reads their text
    exactly. Pages with no usable text layer (scans) return None and fall through to
    the normal image-OCR path."""
    overrides: list[str | None] = []
    for content, mime_type in files:
        is_pdf = (mime_type or "").lower() == "application/pdf" or content[:5] == b"%PDF-"
        if not is_pdf:
            overrides.append(None)
            continue
        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception:
            # Let the normal render path (_expand_pdf_pages) surface the real error.
            continue
        for page in doc:
            try:
                raw = page.get_text("text") or ""
            except Exception:
                raw = ""
            compact = re.sub(r"\s+", "", raw)
            has_marker = re.search(r"地號|建號|登記次序|所有權|標示部|權利範圍", raw)
            usable = has_marker and (
                len(compact) >= TEXT_LAYER_MIN_CHARS
                # A short continuation/tail page of an electronic 謄本 (e.g. a
                # 共有部分 建號's 「本謄本依第二類提供…」 note) has a real text layer,
                # just few characters. Its page furniture (列印時間 / 頁次 / 地政事務所)
                # proves it is a rendered e-謄本 page, not a blank scan - accept it so
                # one short page doesn't disqualify the whole document from the
                # rule-based (no-OCR, no-OpenAI) fast path.
                or (len(compact) >= 30 and re.search(r"列印時間|頁\s*次|地政事務所|登記機關", raw))
            )
            if usable:
                # Note: newer 電子謄本 omit every owner's 「住　址：…」 line from the text
                # layer (it is burned into the page as a raster strip). The structure
                # here is still exact and free to read; the missing 戶籍地址 is filled
                # separately by _recover_burned_in_addresses() + _apply_recovered_addresses().
                overrides.append(_normalize_ocr_text(raw))
            else:
                overrides.append(None)
    return overrides


def merge_pages_to_pdf(pages: list[tuple[bytes, str | None]]) -> bytes:
    """The inverse of _expand_pdf_pages(): combines page images back into a single PDF,
    one page image per PDF page. Used to give a batch-import case group a durable, findable
    home as a normal project document right after it's split off - without this the
    original scan pages only exist transiently in the browser tab that ran the split, and
    are lost the moment that tab is closed or navigated away from without immediately
    running the OCR wizard on them. Page size is derived from each image's pixel
    dimensions at PDF_RENDER_DPI, matching how _expand_pdf_pages originally rendered them
    - this keeps a page merged from a PDF-sourced image the same physical size a PDF
    viewer would show, and produces a reasonable approximation for images that were
    directly uploaded (not from a PDF) too."""
    doc = fitz.open()
    for content, _mime_type in pages:
        img = Image.open(io.BytesIO(content))
        width_pt = img.width * 72 / (dpi or PDF_RENDER_DPI)
        height_pt = img.height * 72 / (dpi or PDF_RENDER_DPI)
        page = doc.new_page(width=width_pt, height=height_pt)
        page.insert_image(page.rect, stream=content)
    return doc.tobytes()


def downscale_for_preview(content: bytes, max_dimension: int = 1000, quality: int = 65, decoded: Image.Image | None = None) -> bytes:
    """Shrinks a page image for use as a lightweight preview - e.g. the batch-import
    case-split review grid only ever displays these at ~110px tall, so there's no need
    to ship the full ~200-DPI page (several MB each, since these are dense scans with a
    repeating watermark that compresses poorly). Returning the untouched original for a
    batch of a few dozen pages made that response payload huge (100+MB), which was
    painfully slow to actually download over a remote/mobile connection (e.g. through a
    Tailscale Funnel) even though the server had already finished processing and logged
    the request as complete. Falls back to the original bytes if the image can't be
    decoded, rather than dropping the page. Pass `decoded` (see _decode_image) to reuse
    an already-decoded page instead of re-decoding the same JPEG from scratch."""
    img = decoded if decoded is not None else _decode_image(content)
    if img is None:
        return content
    img = img.convert("RGB")
    if max(img.width, img.height) > max_dimension:
        scale = max_dimension / max(img.width, img.height)
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _chunk_missing_area(result: dict) -> bool:
    """True if any land parcel/building in this chunk's AI result came back with no
    area at all - the fast OCR engine occasionally misses that field's text region
    outright (not a misread, an outright detection miss), which the confidence-based
    smart re-scan can't catch since there's no detected text to score as low-confidence
    in the first place. See MISSING_AREA_RESCAN_MAX_CHUNKS_PER_DOCUMENT.

    Treats both null AND 0 as missing - the prompt tells the model to return null when
    it can't find a field, but that's a soft instruction the model doesn't reliably
    follow; in practice a "couldn't find it" area came back as the number 0 instead of
    null, which null-only detection silently missed entirely (0 sqm is never a real
    registered area, so there's no legitimate case being wrongly flagged here)."""
    for parcel in result.get("land_parcels", []):
        if not parcel.get("area_sqm"):
            return True
    for building in result.get("buildings", []):
        if not building.get("total_area_sqm") and not building.get("floor_area_sqm"):
            return True
    return False


def _ocr_quality_flags(page_texts: list[str]) -> list[str]:
    """Return cheap, deterministic warnings before AI structuring.

    These flags do not alter OCR text. They tell the extraction layer that a page
    deserves closer review/re-scan when it contains likely missing registry labels,
    too little text, or suspicious OCR noise.
    """
    flags: list[str] = []
    for i, text in enumerate(page_texts, 1):
        t = text or ""
        compact = re.sub(r"\s+", "", t)
        if len(compact) < 80:
            flags.append(f"第{i}頁文字量偏低")
        if re.search(r"[A-Za-z]{6,}", compact) and not re.search(r"地號|建號|所有權|登記次序", compact):
            flags.append(f"第{i}頁疑似含浮水印英數雜訊")
        if not re.search(r"地號|建號|所有權|標示部|他項權利|登記次序", t):
            flags.append(f"第{i}頁缺少常見謄本標籤")
    return flags


def extract_title_deed(
    files: list[tuple[bytes, str | None]], record_type: str = "both", high_accuracy: bool = False
) -> tuple[dict, str | None]:
    """OCRs 1+ scanned pages (in the given order) locally, then sends the recognized
    text to OpenAI and asks it to return the title-deed sections as structured JSON. The
    pages may be a single 地號/建號's title deed, or a batch covering many
    parcels/buildings - either shape is returned as
    land_parcels/buildings arrays. record_type ("land"/"building"/"both") tells the
    model which section(s) the batch actually contains, so it doesn't invent a spurious
    entry of the excluded type out of misread content (e.g. treating a land page's
    parcel_number as if it belonged to a building record). Multi-page PDFs are first
    split into per-page images, then large page counts are processed in chunks of
    PAGES_PER_CHUNK and merged (by parcel_number / building_number) to avoid per-request
    quality breakdown. Each chunk already retries once internally on failure; if a chunk
    still fails, the other chunks' results are kept and a warning is returned alongside
    the data instead of discarding everything. Returns (data, warning_message_or_None).
    Every field is a suggestion for the user to review before saving, not an
    authoritative value."""
    if not settings.OPENAI_API_KEY:
        raise OcrError("尚未設定 OPENAI_API_KEY,請聯絡系統管理員設定 OCR 金鑰後再試")
    if not files:
        raise OcrError("沒有可供辨識的檔案")

    document_started_at = time.time()
    pages = _flatten_to_pages(files, dpi=HIGH_ACCURACY_PDF_RENDER_DPI if high_accuracy else PDF_RENDER_DPI)
    flatten_seconds = time.time() - document_started_at

    # Electronic 謄本 PDFs carry a perfect text layer - use it verbatim and skip both
    # OCR and the vision call for those pages (free + exact). Aligned 1:1 with `pages`;
    # a length mismatch (unexpected) just disables the optimisation for safety.
    try:
        text_overrides = _pdf_text_layer_overrides(files)
        if len(text_overrides) != len(pages):
            text_overrides = [None] * len(pages)
    except Exception:
        text_overrides = [None] * len(pages)

    # Newer 電子謄本 leave every owner's 戶籍地址 out of the text layer (burned into the
    # page as an image). Recover those once, up front, so both the fast rule-based path
    # and the AI path can fill them in. Cheap: OCRs only the address-deficient pages,
    # never calls the vision model.
    try:
        recovered_addresses = _recover_burned_in_addresses(files)
    except Exception as exc:
        print(f"[extract_title_deed] burned-in address recovery failed: {exc}", flush=True)
        recovered_addresses = {}

    # When EVERY page has a usable text layer (a pure electronic 土地/建物謄本), try the
    # regex parser first - it needs no OCR and no OpenAI call at all. It returns None
    # (and we fall through to the AI pipeline) on anything it is not fully sure about:
    # unexpected layout, or a coverage mismatch.
    if text_overrides and all(text_overrides):
        joined_text = "\n\n".join(o for o in text_overrides if o)
        rule_data = None
        try:
            from utils.deed_parser import parse_electronic_deed, parse_electronic_building_deed

            if record_type == "building":
                rule_data = parse_electronic_building_deed(joined_text) or parse_electronic_deed(joined_text)
            else:
                rule_data = parse_electronic_deed(joined_text)
                if rule_data is None and record_type != "land":
                    rule_data = parse_electronic_building_deed(joined_text)
        except Exception as exc:
            print(f"[extract_title_deed] rule-based parser raised, using AI path: {exc}", flush=True)
            rule_data = None
        if rule_data and (rule_data.get("land_parcels") or rule_data.get("buildings")):
            data = _post_process_extracted_data(rule_data)
            data = _backfill_owner_addresses(data, [o for o in text_overrides if o])
            data = _apply_recovered_addresses(data, recovered_addresses)
            probs = _validation_problems(data, [o for o in text_overrides if o])
            n_parcels = len(data.get("land_parcels") or [])
            n_bldgs = len(data.get("buildings") or [])
            n_owners = sum(
                len(x.get("owners") or [])
                for x in (data.get("land_parcels") or []) + (data.get("buildings") or [])
            )
            n_enc = len(data.get("encumbrances") or []) + sum(
                len(p.get("encumbrances") or []) for p in (data.get("land_parcels") or [])
            )
            print(
                f"[extract_title_deed] parsed {n_parcels} 地號 / {n_bldgs} 建號 / {n_owners} 所有權人 / {n_enc} 他項權利 "
                f"via rule-based parser (no OCR, no OpenAI) in {time.time() - document_started_at:.1f}s; "
                f"validation issues={len(probs)}",
                flush=True,
            )
            # 規則直讀的軟性驗證提示不回傳給前端(使用者反映是雜訊);
            # 真正的失敗只會發生在下面的 AI 路徑。
            return data, None

    # Chunks step by PAGES_PER_CHUNK but each chunk (after the first) also re-includes
    # the last CHUNK_OVERLAP page(s) of the previous chunk, so a 地號 whose owner list
    # straddles a cut point still appears complete in at least one chunk instead of
    # being split across two OpenAI calls and half-dropped. _merge_extractions dedupes
    # the parcel/building that then legitimately appears in both.
    chunks: list[list[tuple[bytes, str | None]]] = []
    override_chunks: list[list[str | None]] = []
    chunk_page_starts: list[int] = []  # 1-based page number of each chunk's first page
    for s in range(0, len(pages), PAGES_PER_CHUNK):
        lo = max(0, s - CHUNK_OVERLAP) if s else 0
        hi = s + PAGES_PER_CHUNK
        chunks.append(pages[lo:hi])
        override_chunks.append(text_overrides[lo:hi])
        chunk_page_starts.append(lo + 1)
    text_layer_page_count = sum(1 for o in text_overrides if o)
    if text_layer_page_count:
        print(f"[extract_title_deed] {text_layer_page_count}/{len(pages)} page(s) have a PDF text layer; skipping OCR+vision for those", flush=True)

    def _images_for_chunk(idx: int) -> list[tuple[bytes, str | None]]:
        """Chunk's page images with text-layer pages blanked out so the OpenAI call
        doesn't waste tokens sending an image we don't need."""
        imgs = chunks[idx]
        ovs = override_chunks[idx] if idx < len(override_chunks) else [None] * len(imgs)
        return [(b"", None) if (k < len(ovs) and ovs[k]) else imgs[k] for k in range(len(imgs))]

    results: list[dict | None] = [None] * len(chunks)
    failed_chunks: list[tuple[int, OcrError]] = []
    # A large scanned deed can contain dozens of pages. Cap expensive smart re-scans
    # across the whole document, not once per chunk.
    rescan_budget_lock = Lock()
    rescan_budget_remaining = [SMART_RESCAN_MAX_PAGES_PER_DOCUMENT if not high_accuracy else 0]

    def claim_rescan_budget(requested: int) -> int:
        with rescan_budget_lock:
            claimed = min(requested, rescan_budget_remaining[0])
            rescan_budget_remaining[0] -= claimed
            return claimed

    # Phase 1+2, pipelined: OCR each chunk's pages one chunk at a time (see
    # _ocr_chunk_pages - the local GPU OCR engine isn't safe to hit from several chunks'
    # worth of concurrent page-level thread pools at once, that crashed onnxruntime in
    # testing), but fire that chunk's (network-bound, GPU-free) OpenAI structuring call
    # as soon as its OCR finishes instead of waiting for every chunk's OCR to finish
    # first. The next chunk's GPU-bound OCR and the previous chunk's network-bound
    # OpenAI call don't contend for anything, so this lets them genuinely overlap
    # instead of running as two fully separate serial phases - cuts a multi-chunk
    # batch's total wall time significantly without changing what either step does.
    # Capped at CHUNK_CONCURRENCY to stay within OpenAI's per-minute rate limits.
    ocr_seconds_total = 0.0
    validation_retry_ocr_seconds = [0.0]
    page_texts_by_chunk: list[list[str] | None] = [None] * len(chunks)
    openai_seconds_total = [0.0]
    openai_seconds_lock = Lock()

    def _run_chunk_openai(i: int) -> None:
        try:
            extracted, openai_seconds = _call_openai_for_chunk(page_texts_by_chunk[i], record_type, page_images=_images_for_chunk(i))
            with openai_seconds_lock:
                openai_seconds_total[0] += openai_seconds

            # First-pass OCR is intentionally fast. If deterministic validation catches
            # a high-value structural problem (missing area, >100% ownership, or an
            # owner/encumbrance registration-order collision), re-render ONLY this chunk
            # at 400 DPI and run the same extraction again. This is much cheaper than
            # rescanning an entire 27-page document and avoids asking the model to guess.
            problems = _validation_problems(extracted, page_texts_by_chunk[i])
            # The 他項權利部 is the single hardest section to structure (many densely
            # printed fields; the model routinely picks the wrong line for right_holder /
            # debtor_info). Whenever a chunk actually contains that section, always spend
            # one high-accuracy, encumbrance-focused refinement pass on it - not only
            # when generic validation happens to trip.
            raw_joined = "\n".join(page_texts_by_chunk[i] or [])
            has_enc_section = bool(re.search(
                r"他項權利部|他項權利事項|最高限額抵押權|普通抵押權|抵押權|地上權|不動產役權|地役權|典權|耕作權",
                raw_joined,
            ))
            if (problems or (has_enc_section and not high_accuracy)) and not high_accuracy:
                print(
                    f"[extract_title_deed] chunk {i}: validation found {len(problems)} issue(s)"
                    f"{'; encumbrance section present -> forced refine pass' if has_enc_section and not problems else ''}; "
                    "retrying this chunk at high_accuracy",
                    flush=True,
                )
                try:
                    retry_pages, retry_ocr_seconds, _ = _ocr_chunk_pages(chunks[i], high_accuracy=True, page_start_number=chunk_page_starts[i], text_overrides=override_chunks[i])
                    print(
                        f"[extract_title_deed] chunk {i}: retrying pages "
                        f"{chunk_page_starts[i]}-{chunk_page_starts[i] + len(chunks[i]) - 1} at 400 DPI",
                        flush=True,
                    )
                    if has_enc_section:
                        retry_focus = "encumbrance"
                    elif any(p.get("type") == "ENCUMBRANCE_SECTION_MISSING" for p in problems):
                        retry_focus = "encumbrance"
                    elif any(p.get("type") == "RIGHT_HOLDER_IS_FILE_NUMBER" for p in problems):
                        retry_focus = "right_holder"
                    elif any(p.get("type") == "ADDRESS_MISSING" for p in problems):
                        retry_focus = "address"
                    elif any(p.get("type") == "OWNER_ROWS_INCOMPLETE" for p in problems):
                        retry_focus = "completeness"
                    elif any(p.get("type") in ("OWNERSHIP_SUM_LOW", "OWNERSHIP_OVER_100", "INVALID_FRACTION") for p in problems):
                        retry_focus = "share_value"
                    else:
                        retry_focus = None
                    retry_result, retry_openai_seconds = _call_openai_for_chunk(retry_pages, record_type, validation_focus=retry_focus, page_images=_images_for_chunk(i))
                    with openai_seconds_lock:
                        validation_retry_ocr_seconds[0] += retry_ocr_seconds
                    with openai_seconds_lock:
                        openai_seconds_total[0] += retry_openai_seconds
                    retry_problems = _validation_problems(retry_result, retry_pages)
                    enc_fixed = (
                        any(p.get("type") == "ENCUMBRANCE_SECTION_MISSING" for p in problems)
                        and not any(p.get("type") == "ENCUMBRANCE_SECTION_MISSING" for p in retry_problems)
                    )
                    # Accept the refined pass on a tie too (it had better OCR + a focused
                    # prompt), and always accept it when it was a forced encumbrance
                    # refine with no prior validation problems to compare against.
                    forced_enc_refine = has_enc_section and not problems
                    if len(retry_problems) <= len(problems) or enc_fixed or forced_enc_refine:
                        extracted = retry_result
                        print(
                            f"[extract_title_deed] chunk {i}: high_accuracy improved validation "
                            f"{len(problems)} -> {len(retry_problems)} issue(s)",
                            flush=True,
                        )
                    else:
                        print(
                            f"[extract_title_deed] chunk {i}: high_accuracy did not improve validation; "
                            "keeping first result",
                            flush=True,
                        )
                    print(f"[extract_title_deed] chunk {i}: validation retry OCR={retry_ocr_seconds:.1f}s", flush=True)
                except OcrError as retry_exc:
                    print(
                        f"[extract_title_deed] chunk {i}: validation retry failed; keeping first result: {retry_exc}",
                        flush=True,
                    )
            elif high_accuracy and (problems or has_enc_section):
                # high_accuracy is already the best OCR, so no re-OCR - but a targeted,
                # focused structuring pass on the same text+images still fixes the common
                # "picked the wrong line" errors (encumbrance fields, missing address,
                # wrong share). Accept it only if it doesn't add validation problems.
                if has_enc_section:
                    refine_focus = "encumbrance"
                elif any(p.get("type") == "RIGHT_HOLDER_IS_FILE_NUMBER" for p in problems):
                    refine_focus = "right_holder"
                elif any(p.get("type") == "ADDRESS_MISSING" for p in problems):
                    refine_focus = "address"
                elif any(p.get("type") == "OWNER_ROWS_INCOMPLETE" for p in problems):
                    refine_focus = "completeness"
                elif any(p.get("type") in ("OWNERSHIP_SUM_LOW", "OWNERSHIP_OVER_100", "INVALID_FRACTION") for p in problems):
                    refine_focus = "share_value"
                else:
                    refine_focus = None
                try:
                    before = _validation_problems(extracted, page_texts_by_chunk[i])
                    refined, refine_secs = _call_openai_for_chunk(
                        page_texts_by_chunk[i], record_type, validation_focus=refine_focus, page_images=_images_for_chunk(i)
                    )
                    with openai_seconds_lock:
                        openai_seconds_total[0] += refine_secs
                    after = _validation_problems(refined, page_texts_by_chunk[i])
                    if len(after) <= len(before):
                        extracted = refined
                        print(f"[extract_title_deed] chunk {i}: focused refine applied (high_accuracy, focus={refine_focus})", flush=True)
                    else:
                        print(f"[extract_title_deed] chunk {i}: focused refine rejected ({len(before)} -> {len(after)} issue(s), focus={refine_focus})", flush=True)
                except OcrError as refine_exc:
                    print(f"[extract_title_deed] chunk {i}: focused refine failed: {refine_exc}", flush=True)
            results[i] = extracted
        except OcrError as exc:
            failed_chunks.append((i, exc))

    with ThreadPoolExecutor(max_workers=min(CHUNK_CONCURRENCY, len(chunks))) as pool:
        futures = []
        for i, chunk in enumerate(chunks):
            page_texts, ocr_seconds, _rescanned = _ocr_chunk_pages(chunk, high_accuracy, claim_rescan_budget=claim_rescan_budget, page_start_number=chunk_page_starts[i], text_overrides=override_chunks[i])
            page_texts_by_chunk[i] = page_texts
            ocr_seconds_total += ocr_seconds
            futures.append(pool.submit(_run_chunk_openai, i))
        for future in futures:
            future.result()

    # Phase 3: a chunk whose result is missing area_sqm/total_area_sqm on some
    # parcel/building most likely had that field's text region missed outright by the
    # fast engine's detector (see _chunk_missing_area) - retry that whole chunk once
    # with the high-accuracy engine, capped to a small number of chunks per document so
    # one bad page doesn't silently turn every large batch into a slow all-high-accuracy
    # run. Skipped entirely when already running high_accuracy, since that's already the
    # best detector available - a repeat miss there is an AI reading issue, not a
    # detection gap this retry can fix.
    if not high_accuracy:
        missing_area_budget = MISSING_AREA_RESCAN_MAX_CHUNKS_PER_DOCUMENT
        for i, result in enumerate(results):
            if missing_area_budget <= 0:
                break
            if result is None or not _chunk_missing_area(result):
                continue
            missing_area_budget -= 1
            try:
                retry_page_texts, retry_ocr_seconds, _ = _ocr_chunk_pages(chunks[i], high_accuracy=True, page_start_number=chunk_page_starts[i], text_overrides=override_chunks[i])
                retried_result, retry_openai_seconds = _call_openai_for_chunk(retry_page_texts, record_type, page_images=_images_for_chunk(i))
                ocr_seconds_total += retry_ocr_seconds
                openai_seconds_total[0] += retry_openai_seconds
                print(
                    f"[extract_title_deed] chunk {i}: missing area_sqm, retried with high_accuracy "
                    f"(still_missing={_chunk_missing_area(retried_result)})",
                    flush=True,
                )
                results[i] = retried_result
            except OcrError as exc:
                print(f"[extract_title_deed] chunk {i}: missing-area retry failed, keeping original result: {exc}", flush=True)

    results = [r for r in results if r is not None]
    print(
        f"[extract_title_deed] timing: {len(pages)} page(s) in {len(chunks)} chunk(s), "
        f"flatten={flatten_seconds:.1f}s ocr_total={ocr_seconds_total:.1f}s openai_total={openai_seconds_total[0]:.1f}s "
        f"wall_total={time.time() - document_started_at:.1f}s "
        f"(input=PNG+vision, page_diagnostics=True, high_accuracy={high_accuracy}, openai_concurrency={min(CHUNK_CONCURRENCY, len(chunks)) if chunks else 0}, "
        f"failed_chunks={len(failed_chunks)}, validation_retry_ocr={validation_retry_ocr_seconds[0]:.1f}s)",
        flush=True,
    )
    if not results:
        raise failed_chunks[0][1]

    warning = None
    if failed_chunks:
        ranges = [f"第 {chunk_page_starts[i]}-{chunk_page_starts[i] + len(chunks[i]) - 1} 頁" for i, _ in failed_chunks]
        warning = f"{'、'.join(ranges)}辨識失敗,以下結果可能不完整,請仔細核對並視需要手動補充"

    data = results[0] if len(results) == 1 else _merge_extractions(results)
    data = _drop_empty_entries(data)
    data = _post_process_extracted_data(data)

    all_page_texts = [text for chunk in page_texts_by_chunk if chunk for text in chunk]

    # Deterministic address recovery: if the model left an owner's address blank but the
    # raw text (text-layer PDF or OCR) clearly has a 「住址：…」 line in that owner's
    # 登記次序 block, fill it from the text directly - no dependence on the model.
    data = _backfill_owner_addresses(data, all_page_texts)
    data = _apply_recovered_addresses(data, recovered_addresses)

    final_problems = _validation_problems(data, all_page_texts)
    if final_problems:
        sample = []
        for problem in final_problems[:6]:
            parcel = problem.get("parcel") or problem.get("building") or ""
            ptype = problem.get("type", "UNKNOWN")
            extra = f" ({parcel})" if parcel else ""
            sample.append(f"{ptype}{extra}")
        quality_warning = "OCR資料驗證發現可疑欄位: " + ", ".join(sample)
        warning = f"{warning}; {quality_warning}" if warning else quality_warning

    # Last resort (after validation has had its chance to trigger a retry): a
    # right_holder that is still only a 收件字號 is always wrong. Blank it so the wizard
    # shows an empty field to fill from the image, not a confidently-wrong value.
    for _parcel in data.get("land_parcels", []) or []:
        for _enc in _parcel.get("encumbrances", []) or []:
            if isinstance(_enc.get("right_holder"), str) and _FILE_NUMBER_RE.match(_enc["right_holder"].strip()):
                _enc["right_holder"] = ""
    for _enc in data.get("encumbrances", []) or []:
        if isinstance(_enc.get("right_holder"), str) and _FILE_NUMBER_RE.match(_enc["right_holder"].strip()):
            _enc["right_holder"] = ""

    return data, warning



def _drop_empty_entries(data: dict) -> dict:
    """Occasionally a chunk's response includes a degenerate entry - garbled text with
    no parcel_number/building_number and no owners. A real 地號/建號 always has at
    least one of those, so entries with neither carry no information and are almost
    certainly noise; drop them rather than showing the user empty junk cards."""
    data["land_parcels"] = [p for p in data["land_parcels"] if p.get("parcel_number") or p.get("owners")]
    data["buildings"] = [b for b in data["buildings"] if b.get("building_number") or b.get("owners")]
    return data


# OCR(10): chunk 合併時去重，避免跨頁重複所有權人/他項權利造成假性 >100%。
def _merge_extractions(chunk_results: list[dict]) -> dict:
    """Merge chunk results without counting the same registry record twice.

    A multi-page title deed is split into small AI chunks.  The same owner or
    encumbrance can therefore be returned by two neighbouring chunks because the
    section/header is repeated at the chunk boundary.  The old implementation
    blindly extended both lists, which could turn a legitimate 1/2 + 1/2 into
    1/2 + 1/2 + 1/2 + 1/2 and trigger a false OWNERSHIP_OVER_100 warning.

    Owners are deduplicated inside each parcel/building by registration_order.
    Encumbrances are deduplicated inside their parcel, and top-level encumbrances
    by registration_order + target + right_type + right_holder.  When a duplicate
    has more complete non-null fields, those fields are merged into the retained
    record instead of creating a second row.
    """

    def _norm(value) -> str:
        if value is None:
            return ""
        return re.sub(r"\s+", "", str(value)).strip()

    def _present(value) -> bool:
        return value is not None and str(value).strip() != ""

    def _merge_record(existing: dict, incoming: dict) -> dict:
        # Keep the existing record, but fill missing fields from the duplicate.
        # This is important when one chunk sees the name while the other sees
        # the address/share at a page boundary.
        for field, value in incoming.items():
            if field == "transfer_history":
                history = list(existing.get("transfer_history") or [])
                history.extend(incoming.get("transfer_history") or [])

                # Deduplicate historical values by period + value.
                seen_history = set()
                clean_history = []
                for item in history:
                    if not isinstance(item, dict):
                        continue
                    period = _norm(item.get("period"))
                    value_key = _norm(item.get("value"))
                    key = (period, value_key)
                    if not period and not value_key:
                        continue
                    if key in seen_history:
                        continue
                    seen_history.add(key)
                    clean_history.append(item)

                existing["transfer_history"] = clean_history
            elif not _present(existing.get(field)) and _present(value):
                existing[field] = value
        return existing

    def _dedupe_records(
        records: list[dict],
        key_func: Callable[[dict], tuple],
        label: str = "",
    ) -> list[dict]:
        seen: dict[tuple, dict] = {}
        result: list[dict] = []
        for record in records or []:
            if not isinstance(record, dict):
                continue
            key = key_func(record)
            # If there is no stable key, retain the record rather than risking
            # accidental deletion of a real registration.
            if not any(key):
                result.append(record)
                continue
            existing = seen.get(key)
            if existing is None:
                seen[key] = record
                result.append(record)
            else:
                _merge_record(existing, record)
                if label:
                    print(
                        f"[extract_title_deed] merge deduplicated duplicate {label}: {key}",
                        flush=True,
                    )
        return result

    def _owner_key(owner: dict) -> tuple:
        order = _norm(owner.get("registration_order"))
        if order:
            return ("order", order)
        # Fallback only when registration_order is missing.
        return (
            "fallback",
            _norm(owner.get("id_number")),
            _norm(owner.get("owner_name")),
            _norm(owner.get("address")),
            _norm(owner.get("ownership_numerator")),
            _norm(owner.get("ownership_denominator")),
        )

    def _enc_key(enc: dict, parcel_number: str = "") -> tuple:
        order = _norm(enc.get("registration_order"))
        target = _norm(enc.get("applies_to_parcels")) or _norm(parcel_number)
        if order:
            return (
                "order",
                order,
                target,
                _norm(enc.get("right_type")),
                _norm(enc.get("right_holder")),
            )
        # Fallback when OCR missed registration_order.
        return (
            "fallback",
            target,
            _norm(enc.get("right_type")),
            _norm(enc.get("right_holder")),
            _norm(enc.get("debtor_info")),
        )

    def merge_group(
        items_key: str,
        id_field: str,
        scalar_fields: tuple[str, ...],
        list_fields: tuple[str, ...] = ("owners",),
    ) -> list[dict]:
        by_id: dict[str, dict] = {}
        order: list[str] = []
        no_id: list[dict] = []

        for chunk in chunk_results:
            for item in chunk.get(items_key, []) or []:
                key = _norm(item.get(id_field))
                if not key:
                    no_id.append(item)
                    continue

                if key not in by_id:
                    copied = {**item}
                    for field in list_fields:
                        copied[field] = list(item.get(field) or [])
                    by_id[key] = copied
                    order.append(key)
                    continue

                existing = by_id[key]

                for field in scalar_fields:
                    if not _present(existing.get(field)) and _present(item.get(field)):
                        existing[field] = item[field]

                if "owners" in list_fields:
                    existing["owners"] = _dedupe_records(
                        [*(existing.get("owners") or []), *(item.get("owners") or [])],
                        _owner_key,
                        label=f"{items_key}.owners/{key}",
                    )

                if "encumbrances" in list_fields:
                    existing["encumbrances"] = _dedupe_records(
                        [*(existing.get("encumbrances") or []), *(item.get("encumbrances") or [])],
                        lambda e, parcel=key: _enc_key(e, parcel),
                        label=f"{items_key}.encumbrances/{key}",
                    )

        return [by_id[k] for k in order] + no_id

    land_parcels = merge_group(
        "land_parcels",
        "parcel_number",
        (
            "township",
            "section",
            "subsection",
            "area_sqm",
            "declared_value_per_sqm",
            "declared_value_period",
        ),
        list_fields=("owners", "encumbrances"),
    )

    # A final per-parcel pass catches duplicates that came from a parcel being
    # represented in more than two chunks.
    for parcel in land_parcels:
        parcel["owners"] = _dedupe_records(
            parcel.get("owners") or [],
            _owner_key,
            label=f"final owners/{_norm(parcel.get('parcel_number'))}",
        )
        parcel["encumbrances"] = _dedupe_records(
            parcel.get("encumbrances") or [],
            lambda e, parcel_no=_norm(parcel.get("parcel_number")): _enc_key(e, parcel_no),
            label=f"final encumbrances/{_norm(parcel.get('parcel_number'))}",
        )

    buildings = merge_group(
        "buildings",
        "building_number",
        (
            "building_address",
            "parcel_number",
            "total_floors",
            "floor",
            "total_area_sqm",
            "floor_area_sqm",
        ),
    )

    for building in buildings:
        building["owners"] = _dedupe_records(
            building.get("owners") or [],
            _owner_key,
            label=f"final building owners/{_norm(building.get('building_number'))}",
        )

    # Top-level encumbrances can span multiple parcels/buildings.  Do not use
    # registration_order alone here because the same order can theoretically
    # occur for different target sets/rights.
    encumbrances = _dedupe_records(
        [e for chunk in chunk_results for e in (chunk.get("encumbrances") or [])],
        lambda e: _enc_key(e, ""),
        label="top-level encumbrances",
    )

    deed_category = next((c.get("deed_category") for c in chunk_results if c.get("deed_category")), None)

    return {
        "deed_category": deed_category,
        "land_parcels": land_parcels,
        "encumbrances": encumbrances,
        "buildings": buildings,
    }


# Header-strip OCR (_ocr_header_text, used by detect_case_groups/detect_building_parcel_numbers)
# is cheap enough per page that the per-page loop was previously the bottleneck for
# batch import, not any single OCR call - onnxruntime's InferenceSession.run releases
# the GIL during inference and is safe to call concurrently from multiple threads on
# the same session, so running these header OCR calls in a small thread pool lets
# multi-page/multi-group batches use more than one CPU core instead of OCR'ing pages
# one at a time.
#
# Was a flat 4, then a flat 2 after a real NAS run logged 41 header-crop OCR calls
# taking 191s total (~4.6s/page average) despite each call individually being a tiny,
# aggressively-downsized crop that should be well under a second - on that NAS's 2
# physical cores (a Celeron), onnxruntime's own internal intra-op thread pool inside
# each InferenceSession.run() call means N *external* threads each also spawn their own
# *internal* threads, oversubscribing the CPU several times over and burning most of the
# time on context-switching instead of actual inference. A flat constant tuned for that
# 2-core NAS then badly under-used this same code's other deployment target - a
# multi-core dev machine (e.g. 16 logical cores) - stuck at 2 concurrent OCR calls no
# matter how many cores were sitting idle. Scaling with os.cpu_count() instead fixes
# both: 2 on the weak NAS, more on stronger hardware. Capped at 8 as a reasonable ceiling
# - onnxruntime's own internal per-call threading means the oversubscription risk
# described above doesn't fully go away just because more cores exist, so this doesn't
# scale unbounded with core count on a many-core machine.
_HEADER_OCR_WORKERS = min(os.cpu_count() or 2, 8)

# Serializes every actual GPU inference call across all three OCR engines in this file
# (default, high-accuracy, header-crop) - concurrent Run() calls into onnxruntime's CUDA
# execution provider on this GPU/driver measured out to a real crash ("CUDNN_FE failure
# 11: CUDNN_BACKEND_API_FAILED" / CUDNN_STATUS_EXECUTION_FAILED_CUDA_DRIVER) under normal
# multi-page batch load, not just under unusually heavy concurrency. The high-accuracy
# engine already had its own lock for this (_HIGH_ACCURACY_RUN_LOCK); the default
# engine's page-level thread pool (up to _HEADER_OCR_WORKERS wide) had no equivalent
# protection at all, which is what was actually crashing. A single shared lock covering
# every engine is simplest and safest - the GPU is one physical resource either way, so
# "parallel" GPU calls from separate engines were never real parallelism, just an
# unguarded race. Image decode/preprocessing before each call still happens off-lock, so
# only the actual inference is serialized, not the whole per-page pipeline.
_GPU_OCR_LOCK = Lock()

# _GPU_OCR_LOCK above only synchronizes threads within this one Python process -
# uvicorn's --reload spawns a separate reloader process, and any ad-hoc `docker exec
# python ...` script (e.g. for debugging) is a separate process too. Two processes
# each holding their own onnxruntime CUDA session and hitting the GPU at the same time
# doesn't crash (unlike the intra-process concurrent-chunk crash _GPU_OCR_LOCK guards
# against) but silently tanks throughput - measured a real 27-page high_accuracy batch
# at 435s (16s/page) with something else contending for the GPU, vs ~42s (1.5-2s/page)
# for the identical pages/code path with nothing else running. A flock on a shared file
# provides the same mutual exclusion across process boundaries.
import tempfile

_GPU_PROCESS_LOCK_PATH = os.path.join(tempfile.gettempdir(), "gpu_ocr.lock")


@contextmanager
def _gpu_process_lock():
    if fcntl:
        with open(_GPU_PROCESS_LOCK_PATH, "w") as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
    elif msvcrt:
        with open(_GPU_PROCESS_LOCK_PATH, "a+") as lock_file:
            try:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            except OSError:
                pass
            try:
                yield
            finally:
                try:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
    else:
        yield

# Loading RapidOCR's models takes a couple seconds - doing that once per process and
# reusing the engine avoids paying that cost on every single page.
_OCR_ENGINE = None


def _get_ocr_engine() -> RapidOCR:
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        # Same use_cuda GPU acceleration as the high-accuracy engine below (auto-falls-
        # back to CPU with a log warning if no CUDA device is available, so safe to leave
        # on for a GPU-less deploy target like the NAS too).
        _OCR_ENGINE = RapidOCR(det_use_cuda=True, cls_use_cuda=True, rec_use_cuda=True)
    return _OCR_ENGINE


# A second, much heavier OCR engine (the newer `rapidocr` package - not the same as the
# `rapidocr_onnxruntime` used everywhere else in this file - a "server"-tier PP-OCRv5
# model instead of the default's lighter one) reserved for on-demand single-record
# re-scans and the "掃描謄本匯入" wizard's optional accuracy toggle (see
# extract_title_deed's high_accuracy param). A/B tested against a real misread ("所有
# 權人：卓明" - missing the surname character entirely) on real project data: this
# model correctly read the full name where the default model, and even RapidOCR's own
# dedicated Traditional Chinese model, both did not.
#
# On CPU this model is genuinely slow (~50-100x the default engine, tens of seconds per
# page) - use_cuda=True below lets it run on an NVIDIA GPU when one's actually
# available (onnxruntime-gpu auto-falls-back to CPU with a log warning if not, so this
# is safe to leave on for a GPU-less deploy target like the NAS too). Measured on a dev
# machine's RTX 3060: ~57s/page on CPU -> ~2s/page on GPU, same weights/accuracy, just a
# different execution backend - see LD_LIBRARY_PATH in the Dockerfile, needed for
# onnxruntime to find the pip-installed CUDA/cuDNN .so files at runtime.
_HIGH_ACCURACY_OCR_ENGINE = None
# Prevent duplicate model loading and GPU contention when OCR runs concurrently.
_HIGH_ACCURACY_ENGINE_LOCK = Lock()
_HIGH_ACCURACY_RUN_LOCK = Lock()


def _get_high_accuracy_ocr_engine():
    global _HIGH_ACCURACY_OCR_ENGINE
    if _HIGH_ACCURACY_OCR_ENGINE is None:
        with _HIGH_ACCURACY_ENGINE_LOCK:
            if _HIGH_ACCURACY_OCR_ENGINE is None:
                from rapidocr import RapidOCR as HighAccuracyRapidOCR
                from rapidocr.utils.typings import LangRec, ModelType, OCRVersion

                _HIGH_ACCURACY_OCR_ENGINE = HighAccuracyRapidOCR(
                    params={
                        "Rec.lang_type": LangRec.CH,
                        "Rec.ocr_version": OCRVersion.PPOCRV5,
                        "Rec.model_type": ModelType.SERVER,
                        "Global.use_cls": False,
                        "EngineConfig.onnxruntime.use_cuda": True,
                        "Det.limit_side_len": 640,
                    }
                )
    return _HIGH_ACCURACY_OCR_ENGINE


_PADDLE_OCR_ENGINE = None
_PADDLE_OCR_AVAILABLE = None
_PADDLE_ENGINE_LOCK = Lock()
_PADDLE_RUN_LOCK = Lock()


def _get_paddle_ocr_engine():
    """Create the PaddleOCR 3.x PP-OCRv5 pipeline once per process.

    This project now uses PaddleOCR 3.7.x directly instead of the legacy 2.x
    ``ocr()`` API. GPU selection is explicit so the dedicated OCR venv uses the
    RTX 3060; if GPU initialization fails, the caller can fall back to the
    existing RapidOCR path used by the NAS deployment.
    """
    global _PADDLE_OCR_ENGINE, _PADDLE_OCR_AVAILABLE
    if _PADDLE_OCR_AVAILABLE is False:
        return None
    if _PADDLE_OCR_ENGINE is None:
        with _PADDLE_ENGINE_LOCK:
            if _PADDLE_OCR_ENGINE is None and _PADDLE_OCR_AVAILABLE is not False:
                try:
                    from paddleocr import PaddleOCR

                    _PADDLE_OCR_ENGINE = PaddleOCR(
                        ocr_version="PP-OCRv5",
                        lang="chinese_cht",
                        device="gpu",
                        use_doc_orientation_classify=False,
                        use_doc_unwarping=False,
                        use_textline_orientation=True,
                        text_rec_score_thresh=0.0,
                    )
                    _PADDLE_OCR_AVAILABLE = True
                    print(
                        "[PaddleOCR] PP-OCRv5 / PaddleOCR 3.x initialized on GPU.",
                        flush=True,
                    )
                except Exception as exc:
                    _PADDLE_OCR_AVAILABLE = False
                    print(f"[PaddleOCR] PP-OCRv5 unavailable ({exc}).", flush=True)
                    return None
    return _PADDLE_OCR_ENGINE

def _parse_paddle_ocr_result(res) -> tuple[list[str], list[float]]:
    """Extract text and recognition confidence from PaddleOCR 3.x results.

    PaddleOCR 3.x returns Result objects whose ``json``/``res`` payload exposes
    ``rec_texts`` and ``rec_scores``. Older list/dict output is retained only as a
    defensive compatibility path.
    """
    texts: list[str] = []
    scores: list[float] = []
    if res is None:
        return texts, scores

    for page in res:
        if page is None:
            continue

        data = None
        try:
            if hasattr(page, "json"):
                data = page.json
                if callable(data):
                    data = data()
            elif hasattr(page, "res"):
                data = page.res
        except Exception:
            data = None

        # PaddleOCR 3.7's Result.json() wraps everything one level deep under "res"
        # ({"res": {"rec_texts": [...], "rec_scores": [...]}}); older/other builds put
        # those keys at the top level. Unwrap so both shapes work.
        if isinstance(data, dict) and isinstance(data.get("res"), dict) and "rec_texts" not in data:
            data = data["res"]

        if isinstance(data, dict):
            rec_texts = data.get("rec_texts") or []
            rec_scores = data.get("rec_scores") or []
            for i, text in enumerate(rec_texts):
                if text is None or str(text).strip() == "":
                    continue
                texts.append(str(text))
                try:
                    scores.append(float(rec_scores[i]) if i < len(rec_scores) else 1.0)
                except (TypeError, ValueError):
                    scores.append(1.0)
            continue

        if isinstance(page, dict):
            rec_texts = page.get("rec_texts") or []
            rec_scores = page.get("rec_scores") or []
            for i, text in enumerate(rec_texts):
                if text:
                    texts.append(str(text))
                    scores.append(float(rec_scores[i]) if i < len(rec_scores) else 1.0)
            continue

        # Legacy PaddleOCR list output, kept so the function remains tolerant if
        # another deployment still returns the older structure.
        if isinstance(page, (list, tuple)):
            for line in page:
                if not line or len(line) < 2:
                    continue
                payload = line[1]
                if isinstance(payload, (list, tuple)) and len(payload) >= 2:
                    text, score = payload[0], payload[1]
                else:
                    text, score = payload, 1.0
                if text:
                    texts.append(str(text))
                    try:
                        scores.append(float(score))
                    except (TypeError, ValueError):
                        scores.append(1.0)

    return texts, scores


def _ocr_page_text(content: bytes, high_accuracy: bool = False) -> tuple[str, float | None]:
    """Run PP-OCRv5 on one rendered deed page and return text + mean confidence."""
    img = Image.open(io.BytesIO(content)).convert("RGB")
    img_array = np.array(img)

    paddle_engine = _get_paddle_ocr_engine()
    if paddle_engine is not None:
        try:
            # The PaddleOCR 3.x pipeline is GPU-bound. Keep the actual inference
            # serialized to avoid CUDA/cuDNN contention on the 6 GB RTX 3060.
            with _gpu_process_lock(), _GPU_OCR_LOCK, _PADDLE_RUN_LOCK:
                result = paddle_engine.predict(img_array)
            texts, scores = _parse_paddle_ocr_result(result)
            if texts:
                conf = sum(scores) / len(scores) if scores else None
                return _normalize_ocr_text("\n".join(texts)), conf
        except Exception as exc:
            print(f"[_ocr_page_text] PP-OCRv5 execution failed ({exc})", flush=True)

    # Compatibility fallback for the existing NAS deployment. This is only used if
    # PaddleOCR 3.x cannot initialize or inference fails.
    try:
        engine = _get_high_accuracy_ocr_engine() if high_accuracy else _get_ocr_engine()
        if engine is None:
            return "", 0.0
        with _gpu_process_lock(), _GPU_OCR_LOCK:
            res = engine(img_array)
        txts = res.txts if hasattr(res, "txts") else [line[1] for line in (res[0] if res else [])]
        return _normalize_ocr_text("\n".join(txts)), None
    except Exception as exc:
        print(f"[_ocr_page_text] Fallback OCR execution failed ({exc})", flush=True)

    return "", 0.0


def run_ocr(content: bytes) -> dict:
    """Runs local PP-OCRv5 on image bytes and returns {'text': extracted_text}."""
    try:
        text, _conf = _ocr_page_text(content)
        return {"text": text or ""}
    except Exception as exc:
        print(f"[run_ocr] OCR failed: {exc}", flush=True)
        return {"text": ""}


# A separate, more aggressively-tuned engine used only for the small header-strip crop
# detect_case_groups() OCRs (see _ocr_header_text) - NOT for the full-page OCR above,
# which reads dense small print (owner names, ID numbers, addresses) that genuinely
# needs the default detection resolution to find reliably. The header crop only ever
# contains a few lines of large, clear title/頁次 text, so it tolerates a much smaller
# detection input size (det_limit_side_len) and skipping the angle-classification pass
# (use_cls) - measured ~60% faster per page with identical parsed results on real
# samples, which matters a lot on this app's underpowered NAS deployment. Kept as a
# separate engine instance (not just different call-time args) because RapidOCR bakes
# det_limit_side_len into the detector at construction time, not overridable per call.
#
# det_limit_side_len was 320, dropped to 256 alongside TOP_STRIP_MAX_WIDTH above for the
# same reason - a real NAS run measured ~5s/page for this "supposedly cheap" pass, and
# detection cost scales with this value. 256 is RapidOCR's own commonly-used lower
# preset for short/simple text lines; still well above what large printed digits need.
_HEADER_OCR_ENGINE = None


def _get_header_ocr_engine():
    """Reuse the PP-OCRv5 engine for header-strip detection.

    The previous version created a second RapidOCR session here. With the new
    PaddleOCR 3.x stack that would waste VRAM and, on Windows, would also require
    a second OCR runtime. The header contains large title/parcel text, so using the
    already-loaded PP-OCRv5 pipeline is both simpler and safer.
    """
    return _get_paddle_ocr_engine()


# Full-width digits and various dash-like punctuation glyphs (fullwidth/em/en dash,
# katakana long-sound mark, etc.) all show up in real OCR output for what's printed as a
# plain ASCII "0242-0000" on the page - every 地號/建號 regex below only recognizes
# ASCII digits and a literal "-", so a page that happens to OCR as "０２４２－００００"
# silently produced no match at all (case ended up "偵測失敗" / 建物坐落地號 blank, and
# the batch import couldn't auto-match a case that visibly has the right 地號). Folding
# these to ASCII right after OCR fixes every downstream regex at once instead of having
# to special-case each one.
_FULLWIDTH_DIGIT_MAP = str.maketrans("０１２３４５６７８９", "0123456789")
_DASH_VARIANTS = "－—–─﹣ｰ"


def _normalize_ocr_text(text: str) -> str:
    text = text.translate(_FULLWIDTH_DIGIT_MAP)
    for ch in _DASH_VARIANTS:
        text = text.replace(ch, "-")
    # This OCR engine frequently drops 「範」 out of 「權利範圍」, printing 「權利圍」
    # instead - the extraction prompt looks for the literal "權利範圍:" label to find each
    # owner's ownership_numerator/denominator, so a page full of "權利圍:" matches never
    # gets recognized as that field at all and silently falls back to a fabricated-looking
    # 1分之1 default instead of the real fraction. "權利圍" never legitimately appears in
    # these documents on its own, so it's safe to deterministically restore it here rather
    # than relying on the model to notice the dropped character on its own.
    text = text.replace("權利圍", "權利範圍")
    # 「住　址：」 is printed with a wide gap between 住 and 址, which wrecks the label
    # on OCR: spurious chars get inserted between the two (住劵滘址 / 住二址 / 住_址)
    # AND 住 itself is routinely misread (崔昇址 / 往址 / 位址 / 佳址). 址 survives
    # reliably, and inside an owner block a short run ending in 「址：」 (or 「址」 right
    # before an address) is only ever the address label - so normalise it back to the
    # canonical 「住址：」 so every downstream 住址-line regex can anchor on it.
    text = re.sub(r"(?m)^[ 　\t]{0,4}[^\n：:]{0,3}?址[ 　\t]*[:：]", "住址：", text)
    # Other frequent misreads of the same three critical labels. The extraction prompt
    # keys off these literal strings to locate 權利範圍 / 前次移轉現值或原規定地價 /
    # 當期申報地價; a garbled label means the whole field is silently skipped and an
    # owner ends up with a fabricated 1分之1 or a null value. None of the wrong forms
    # below ever legitimately appear in a 謄本, so restoring them deterministically is
    # safe. 圍=圍 園=園 圈=圈 ; 值=值 直=直 植=植
    for wrong in ("權利範園", "權利範圈", "權利軛圍", "榷利範圍", "権利範圍", "權利範圓"):
        text = text.replace(wrong, "權利範圍")
    # This OCR engine also drops 「範圍」 entirely, printing just 「權利：」 before the
    # fraction. Only 「權利範圍：」 is ever followed by a 「*…分之…」 share, so it is safe
    # to restore in that context (「他項權利：」 etc. never are).
    text = re.sub(r"權\s*利\s*[:：]\s*(?=[*＊\s]*\d+\s*分\s*之)", "權利範圍：", text)
    # 「權狀字號」 with 狀 misread as the simplified 状 - restore so it still works as an
    # address-line stop boundary and as a label.
    text = re.sub(r"權\s*[狀状]\s*字\s*號", "權狀字號", text)
    # 「地號」 with 號 misread as 琥/唬 - the per-地號 section splitter in
    # _backfill_owners_from_raw keys off the literal 「NNNN-NNNN 地號」 page header, so a
    # garbled 號 there collapses a batch deed into one section and lets owners from
    # different 地號 (which reuse 登記次序) overwrite each other.
    text = re.sub(r"(\d{3,5}-\d{3,5}\s*)地\s*[琥唬]", r"\1地號", text)
    for wrong in ("前次移轉現直", "前次移轉現植", "前次移轉現偵", "前次移轉現稙"):
        text = text.replace(wrong, "前次移轉現值")
    for wrong in ("原規定地慣", "原規定地憤", "原規定地債"):
        text = text.replace(wrong, "原規定地價")
    text = re.sub(r"當期申報地[慣憤債]", "當期申報地價", text)
    # OCR often reads 「分之」 as 「分乂」/「分文」/「分之」 between the two fraction numbers.
    text = re.sub(r"(?<=\d)\s*分[乂文乀丶之]\s*(?=\d)", "分之", text)
    return text


def _ocr_header_text(content: bytes) -> str:
    """OCR the cropped page header with the shared PP-OCRv5 pipeline."""
    img = Image.open(io.BytesIO(content)).convert("RGB")
    engine = _get_header_ocr_engine()
    if engine is None:
        return ""
    try:
        with _gpu_process_lock(), _GPU_OCR_LOCK, _PADDLE_RUN_LOCK:
            result = engine.predict(np.array(img))
        texts, _scores = _parse_paddle_ocr_result(result)
        return _normalize_ocr_text("\n".join(texts))
    except Exception as exc:
        print(f"[_ocr_header_text] PP-OCRv5 header OCR failed ({exc})", flush=True)
        return ""


# Appended to EXTRACTION_PROMPT when the caller already knows which section(s) a batch
# contains (the frontend asks the user upfront) - telling the model to not even attempt
# the excluded type is more reliable than extracting both and discarding one, because it
# stops the model from ever conjuring a spurious entry of the excluded type out of
# misread/ambiguous content in the first place (e.g. a land page's parcel_number
# bleeding into a fabricated buildings entry).
_RECORD_TYPE_INSTRUCTIONS = {
    "land": "\n\n這一批文件主要為土地謄本,請完整抽取地號與土地所有權人。若文中有建物資料亦可適度呈現,切勿因為無建物而清空土地資料。",
    "building": "\n\n這一批文件主要為建物謄本,請完整抽取建號與建物所有權人。若文中有土地資料亦可適度呈現,切勿因為無土地而清空建物資料。",
    "both": "",
}



def _print_page_ocr_diagnostics(page_results, page_start_number=1):
    """Print page-by-page OCR quality so later-page degradation is visible."""
    for local_index, (page_text, confidence) in enumerate(page_results):
        page_no = page_start_number + local_index
        compact = re.sub(r"\s+", "", page_text or "")
        conf_text = f"{confidence:.3f}" if confidence is not None else "N/A"

        reasons = []
        if confidence is not None and confidence < SMART_RESCAN_CONFIDENCE:
            reasons.append("低信心")
        if len(compact) < 250:
            reasons.append("文字量低")
        if not re.search(r"地號|建號|所有權|標示部|他項權利|登記次序", page_text or ""):
            reasons.append("缺謄本標籤")

        suffix = f"  ⚠️ {'、'.join(reasons)}" if reasons else ""
        print(
            f"[OCR_PAGE] 第{page_no:02d}頁 | confidence={conf_text} | "
            f"text={len(compact)}字{suffix}",
            flush=True,
        )


def _ocr_chunk_pages(
    files: list[tuple[bytes, str | None]],
    high_accuracy: bool = False,
    claim_rescan_budget: Callable[[int], int] | None = None,
    page_start_number: int = 1,
    text_overrides: list[str | None] | None = None,
) -> tuple[list[str], float, int]:
    # Pages are OCR'd locally first (see _ocr_page_text) instead of sending the raw
    # images to a vision model - a dedicated OCR engine reads dense small print (parcel
    # numbers, ID numbers, ownership fractions) far more reliably than a vision LLM
    # skimming a downsized page image. The model's job here is purely to organize and
    # sanity-check already-recognized text, not to also read characters off pixels.
    #
    # Kept as its own function, called sequentially per chunk from extract_title_deed
    # (unlike the OpenAI call below, which is safe to fan out across chunks) - the
    # underlying onnxruntime CUDA session isn't safe to hit from many chunks' worth of
    # concurrent page-level thread pools at once. Running 3 chunks' OCR passes at the
    # same time (each already spinning up its own up-to-8-way page thread pool) measured
    # out to a real crash: "CUDNN_BACKEND_API_FAILED" from onnxruntime, most likely GPU
    # resource exhaustion from too many concurrent CUDA calls on one session. The
    # existing per-chunk page-level parallelism below was already safe on its own and is
    # untouched; only chunk-vs-chunk concurrency for this GPU-bound phase was the problem.
    #
    # high_accuracy mode is capped independently
    # of _HEADER_OCR_WORKERS. On CPU it was measured at 1 worker ~57s/page, 2 ~52s/page,
    # 4 ~44s/page - each extra worker helping less than linearly since the model's own
    # internal compute already contends with itself, so 4 was picked as roughly where
    # the returns flatten out. On a GPU (see use_cuda on the engine) a single page drops
    # to ~2s, so this cap matters much less either way now, but is left at 4 rather than
    # re-tuned for GPU concurrency (untested) since it's not causing any known problem.
    started_at = time.time()
    workers = 1 if high_accuracy else _HEADER_OCR_WORKERS
    weak_pages: list[tuple[float, int]] = []
    if files:
        # Pages whose text already came from a PDF text layer (see
        # _pdf_text_layer_overrides) are treated as perfectly recognised - confidence
        # 1.0 - and never OCR'd or flagged for a weak-page re-scan.
        ov = list(text_overrides) if text_overrides else [None] * len(files)
        if len(ov) != len(files):
            ov = [None] * len(files)
        page_results: list[tuple[str, float | None]] = [
            (o, 1.0) if o else ("", None) for o in ov
        ]
        ocr_idx = [i for i, o in enumerate(ov) if not o]
        if ocr_idx:
            with ThreadPoolExecutor(max_workers=min(workers, len(ocr_idx))) as pool:
                ocr_out = list(pool.map(lambda i: _ocr_page_text(files[i][0], high_accuracy), ocr_idx))
            for i, res in zip(ocr_idx, ocr_out):
                page_results[i] = res
        if len(ocr_idx) < len(files):
            print(
                f"[_ocr_chunk_pages] {len(files) - len(ocr_idx)} page(s) used PDF text layer, OCR skipped",
                flush=True,
            )
        _print_page_ocr_diagnostics(page_results, page_start_number=page_start_number)
        page_texts = [text for text, _confidence in page_results]
        quality_flags = _ocr_quality_flags(page_texts)
        if quality_flags:
            print(f"[_ocr_chunk_pages] quality flags: {quality_flags}", flush=True)

        # Smart mode: fast OCR handles every page. Re-scan at most the two lowest-
        # confidence pages, so one poor photo does not turn an entire batch into the
        # slow all-pages high-accuracy path. Users can still explicitly opt into that
        # full path with high_accuracy=True.
        if not high_accuracy and claim_rescan_budget:
            candidate_weak_pages = sorted(
                (
                    (confidence if confidence is not None else 0.0, i)
                    for i, (text, confidence) in enumerate(page_results)
                    if (confidence is not None and confidence < SMART_RESCAN_CONFIDENCE)
                    or len(re.sub(r"\s+", "", text or "")) < 120
                    or not re.search(r"地號|建號|所有權|登記次序|標示部", text or "")
                ),
                key=lambda item: item[0],
            )
            # Chunks run sequentially through this OCR phase (see above), but the budget
            # is still claimed atomically since a future caller could parallelize this
            # again - cheap correctness insurance, not needed for today's sequential use.
            claimed = claim_rescan_budget(len(candidate_weak_pages))
            weak_pages = candidate_weak_pages[:claimed]
            if weak_pages:
                def _rescan_weak_page(index: int) -> tuple[int, str]:
                    try:
                        return index, _ocr_page_text(files[index][0], high_accuracy=True)[0]
                    except Exception as exc:
                        print(f"[_ocr_chunk_pages] smart re-scan skipped for page {index + 1}: {exc}", flush=True)
                        return index, page_texts[index]

                with ThreadPoolExecutor(max_workers=1) as pool:
                    for index, rescanned_text in pool.map(lambda item: _rescan_weak_page(item[1]), weak_pages):
                        if rescanned_text:
                            page_texts[index] = rescanned_text
                print(f"[_ocr_chunk_pages] smart re-scanned {len(weak_pages)} low-confidence page(s)", flush=True)
    else:
        page_texts = []
    return page_texts, time.time() - started_at, len(weak_pages)


def _call_openai_for_chunk(
    page_texts: list[str],
    record_type: str = "both",
    validation_focus: str | None = None,
    page_images: list[tuple[bytes, str | None]] | None = None,
) -> tuple[dict, float]:
    # Full OCR text contains personal data and is intentionally not logged.
    pages_block = "\n\n".join(
        f"----- 第 {i + 1} 頁 OCR 文字 -----\n{text or '(本頁 OCR 沒有讀到文字)'}"
        for i, text in enumerate(page_texts)
    )
    prompt = EXTRACTION_PROMPT + _RECORD_TYPE_INSTRUCTIONS.get(record_type, "")
    # Targeted instruction for the second pass: when the raw OCR contains an
    # encumbrance-section marker, the model must actively search that section and
    # populate parcel-level encumbrances when the right applies to one parcel.
    if validation_focus == "encumbrance":
        prompt += (
            "\n\n【第二次校正重點：土地／建物他項權利部，請逐欄位重讀影像】"
            "這一段版面很密、欄位很多,上一輪很容易挑錯行、漏筆或錯位。請對「他項權利部」裡的**每一個登記次序區塊**各產生一筆 encumbrance,"
            "依原文由上到下的順序,一筆都不可略過、不可合併、不可調換順序,一律以影像為準:\n"
            "• 每個他項權利區塊的開頭是「(流水號)登記次序:XXXX-XXX」(例如「(0001)登記次序:0005-000」「(0002)登記次序:0006-000」)。"
            "務必連號逐一產出:0005-000、0006-000、0007-000…中間任何一筆都不能跳過。若某頁最後一筆寫「(續次頁)」,表示該筆延續到下一頁,請合併兩頁後再輸出這一筆。\n"
            "• registration_order:就是該區塊開頭那個「登記次序:XXXX-XXX」。"
            "【嚴禁】拿區塊中間的「標的登記次序:0007」來當 registration_order——「標的登記次序」是指這筆抵押權設定在哪一位所有權人身上,不是這筆抵押權自己的次序。\n"
            "• right_type:「權利種類:」那一行(例如「最高限額抵押權」)。不要用「登記原因:設定」。\n"
            "• right_holder:「權　利　人:」那一行後面的名稱(銀行/公司全名或個人姓名)。"
            "【嚴禁】填成「字　號:」(像「信義字第201500號」)、「收件年期:」「登記日期:」「統一編號:」「住址:」「證明書字號:」的內容。讀不到就填空字串。\n"
            "• debtor_info:只填「債權額比例:」或「債務額比例:」那一行的「N分之M」分數(例如「1分之1」)。"
            "【嚴禁】填成「設定權利範圍:4分之1」(那是設定在標的所有權人持分中的比例,不是 debtor_info)、「擔保債權總金額:新臺幣6,210,000元正」、「擔保債權種類及範圍」「擔保債權確定期日」「利息」「遲延利息」「違約金」「債務人:」姓名。找不到就填空字串。\n"
            "• applies_to_parcels:依「共同擔保地號/建號」或該頁標題地號填,通常就是本地號。\n"
            "義務人、債務人、權利人只能留在 encumbrance,不可混進 owners。"
            "只對應單一地號的放 land_parcels[].encumbrances;橫跨多筆或寫「全部」才放最外層 encumbrances。"
            "原始 OCR 若出現「他項權利事項/抵押權」關鍵字但上一輪是空的,務必補齊,不得回傳空陣列。"
        )
    elif validation_focus == "completeness":
        prompt += "\n\n【第二次校正重點：漏列所有權人／登記次序】上一輪的 JSON 漏掉了原文中出現的部分「登記次序」。請重新逐頁、逐列點名每一個「登記次序」的登記名義人：土地／建物所有權部的每一筆登記次序都要對應一位 owner，他項權利部的每一筆登記次序都要對應一筆 encumbrance，一筆都不可略過。長串繼承共有人(常一筆地號十幾位、橫跨數頁)特別容易漏，請確認每一位都在 owners 裡。寧可多列、由人工刪除，也不要漏列。不要因為上一輪結果而沿用其缺漏。"
    elif validation_focus == "right_holder":
        prompt += "\n\n【第二次校正重點：他項權利人】上一輪把某筆他項權利的 right_holder 填成了「收件字號」(長得像「信義字第028163號」),那是錯的。請回到影像,找「權　利　人:」那一行,把後面的**名稱**(銀行/公司全名如「台北富邦商業銀行股份有限公司」,或個人姓名)填進 right_holder;「字　號:」「收件字號:」「收件年期:」「登記日期:」的內容一律不可放進 right_holder。讀不到名稱就填空字串,不要用字號頂替。"
    elif validation_focus == "address":
        prompt += "\n\n【第二次校正重點：所有權人住址】上一輪有所有權人的 address 是空的。請回到影像,對每一位所有權人找到其底下那一行「住　址:」(字中間可能有全形空白),把後面完整的地址填進 address;地址若換行才接完,要把下一行的門牌部分(如「48號二十八樓之2」)一起接起來,直到遇到「權利範圍:」「權狀字號:」「當期申報地價:」或下一筆「登記次序」為止。只要原文有「住　址:」這一行,address 就不可以留空、不可以是 null、不可以是「(空白)」;「(空白)」只屬於「其他登記事項」,不是住址。第二類謄本的住址通常完整印出(只有身分證字號被遮成 F220****6),不要因為是第二類就不填。"
    elif validation_focus == "share_value":
        prompt += "\n\n【第二次校正重點：權利範圍與原規定地價】上一輪部分所有權人的「權利範圍」持分加總明顯不足 100%，或分數像是預設值，很可能漏讀或讀錯。請回到影像,對每一位所有權人找出其「獨立一行」的「權利範圍:X分之Y」(不是「歷次取得權利範圍」),完整、正確填入 ownership_numerator / ownership_denominator;同一筆地號所有『分別共有』人的持分加總應接近 1(公同共有除外)。同時逐一確認每位的「前次移轉現值或原規定地價」年月與金額有沒有讀到、有沒有誤抓成「當期申報地價」。不要沿用上一輪的錯誤數字。"

    # The local OCR engine only ever produces a flat stream of text - column alignment,
    # and therefore which 地址/持分/統編 belongs to which 所有權人, is lost. Sending the
    # page image alongside the OCR text lets the (vision-capable) model use the OCR text
    # as a hint but read ambiguous characters and table structure off the picture
    # itself, which is the single biggest accuracy win for these dense tabular deeds.
    user_content: list | str
    if page_images:
        parts: list = [{"type": "text", "text": f"{prompt}\n\n{pages_block}"}]
        for i, (img_bytes, _mime) in enumerate(page_images):
            if not img_bytes:
                continue
            try:
                vision_bytes = downscale_for_preview(img_bytes, max_dimension=2200, quality=82)
            except Exception:
                vision_bytes = img_bytes
            b64 = base64.b64encode(vision_bytes).decode("ascii")
            parts.append({"type": "text", "text": f"----- 第 {i + 1} 頁原始影像(以此為準,OCR 文字僅供參考)-----"})
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
            })
        user_content = parts
    else:
        user_content = f"{prompt}\n\n{pages_block}"

    payload = {
        "model": settings.OPENAI_MODEL,
        "messages": [{"role": "user", "content": user_content}],
        # Field extraction must be deterministic - the default temperature (1.0) makes
        # the model paraphrase/guess on borderline reads. 0 keeps it anchored to what is
        # actually printed.
        "temperature": 0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "title_deed_extraction", "strict": True, "schema": RESPONSE_SCHEMA},
        },
        # Batch title deeds can contain dozens of parcels/buildings, each with many
        # co-owners - the resulting JSON can be far larger than a single-parcel
        # extraction, so raise the cap to avoid a truncated (invalid) response.
        "max_tokens": 16384,
    }
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}

    # A single chunk occasionally times out, or the model occasionally returns a
    # truncated/malformed response, under load even though most calls complete cleanly
    # well under a minute - retry the whole request once before giving up, rather than
    # failing the whole (possibly multi-chunk) job over one bad call. A 429 (rate
    # limit) gets a longer backoff since OpenAI's per-minute token windows take real
    # time to free up - a same-instant retry just hits the same wall.
    openai_started_at = time.time()
    last_error: OcrError | None = None
    for attempt in (1, 2):
        try:
            resp = httpx.post(OPENAI_ENDPOINT, headers=headers, json=payload, timeout=OCR_OPENAI_TIMEOUT_SECONDS)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            try:
                detail = exc.response.json().get("error", {}).get("message", detail)
            except ValueError:
                pass
            if exc.response.status_code == 429 and attempt == 1:
                last_error = OcrError(f"呼叫 OpenAI 服務失敗:{detail}")
                time.sleep(20.0)
                continue
            raise OcrError(f"呼叫 OpenAI 服務失敗:{detail}") from exc
        except httpx.HTTPError as exc:
            last_error = OcrError(f"呼叫 OpenAI 服務失敗:{exc}")
            continue

        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            last_error = OcrError("OpenAI 未回傳結果")
            continue

        finish_reason = choices[0].get("finish_reason")
        text = (choices[0].get("message") or {}).get("content") or ""
        if not text:
            last_error = OcrError("OpenAI 回傳內容為空")
            continue
        if finish_reason == "length":
            last_error = OcrError("OpenAI 回傳內容被截斷(超過長度上限)")
            continue

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            last_error = OcrError(f"無法解析 OpenAI 回傳的 JSON:{exc}")
            continue

        result = _post_process_extracted_data({
            "land_parcels": parsed.get("land_parcels") or [],
            "encumbrances": parsed.get("encumbrances") or [],
            "buildings": parsed.get("buildings") or [],
        })
        # Person names are deliberately exempted from the s2twp traditional-conversion
        # backstop above - it's meant for addresses/place names/legal terms, where the
        # mapping is unambiguous. A rare/uncommon character actually printed in someone's
        # real name can coincide with s2twp's simplified->traditional dictionary and get
        # silently "corrected" into a different (wrong) character, which is worse than
        # leaving whatever the model itself already read. Restore each owner_name from
        # the pre-conversion model output after every other field has gone through the
        # normal cleanup passes.
        for parcel, raw_parcel in zip(result["land_parcels"], parsed.get("land_parcels") or []):
            for owner, raw_owner in zip(parcel.get("owners", []), raw_parcel.get("owners", []) or []):
                if raw_owner.get("owner_name"):
                    owner["owner_name"] = raw_owner["owner_name"]
        for building, raw_building in zip(result["buildings"], parsed.get("buildings") or []):
            for owner, raw_owner in zip(building.get("owners", []), raw_building.get("owners", []) or []):
                if raw_owner.get("owner_name"):
                    owner["owner_name"] = raw_owner["owner_name"]
        return result, time.time() - openai_started_at

    raise last_error


# ---- Auto-grouping via the "續次頁" (continued on next page) marker ----
#
# Taiwan land/building registry printouts mark the bottom of every page with either
# 「續次頁」(this 地號/建號's record continues onto the next page) or nothing/a terminal
# marker like 「本謄本列印完畢」(printing complete). That's a reliable, document-native
# signal for exactly where one parcel/building's record ends - reusing it to
# pre-compute page groups is far more trustworthy than asking a model to guess parcel
# boundaries while also trying to transcribe everything in the same pass.

# Every page has a 「頁次:000001」-style field near the top (next to 「列印時間」) that
# counts pages *within the current 地號/建號's own record* - it resets to 000001 every
# time a new 地號/建號's data starts. That's a more reliable signal than the 「續次頁」
# text marker (whose position on the page varies with how much content that page has)
# because it's a fixed-format field in a fixed location: crop to the top strip, check
# whether 頁次 reads 000001, and a page that does is the start of a new group.
PAGE_SEQUENCE_PROMPT = """以下是同一份台灣土地/建物登記謄本依照順序排列的頁面。每一頁最上方,「列印時間」\
旁邊會印著「頁次:XXXXXX」這個欄位(6 位數字)。這個頁次是「目前這一筆地號/建號自己的內部頁碼」,每次\
換到新的一筆地號/建號,頁次就會重新從 000001 開始算。

請針對每一頁,讀出「頁次:」後面的 6 位數字,判斷是不是「000001」,依照頁面順序回傳一個布林值陣列\
(true=頁次是 000001、這頁是新一筆地號/建號的第一頁,false=頁次不是 000001、這頁接續前一頁同一筆記錄),\
陣列長度必須跟頁數一樣多。"""

PAGE_SEQUENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_first_page": {"type": "array", "items": {"type": "boolean"}},
    },
    "required": ["is_first_page"],
    "additionalProperties": False,
}


def _call_openai_structured(payload: dict) -> dict:
    """POSTs to OpenAI chat completions and returns the parsed JSON content, retrying
    once on a 429 (rate limit) after a real pause - OpenAI's per-minute token budget
    needs actual time to free up, so an instant retry just hits the same wall. Used by
    the lightweight per-page detection helpers below; the main extraction path
    (_call_openai_for_chunk) has its own copy of this same pattern inline."""
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
    payload.setdefault("temperature", 0)
    last_error: OcrError | None = None
    for attempt in (1, 2):
        try:
            resp = httpx.post(OPENAI_ENDPOINT, headers=headers, json=payload, timeout=120.0)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429 and attempt == 1:
                last_error = OcrError(exc.response.text)
                time.sleep(20.0)
                continue
            raise OcrError(f"呼叫 OpenAI 服務失敗:{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            last_error = OcrError(f"呼叫 OpenAI 服務失敗:{exc}")
            continue

        data = resp.json()
        text = (((data.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
        if not text:
            last_error = OcrError("OpenAI 回傳內容為空")
            continue
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            last_error = OcrError(f"無法解析 OpenAI 回傳的 JSON:{exc}")
            continue

    raise last_error


def _detect_page_sequence_chunk(files: list[tuple[bytes, str | None]]) -> list[bool] | None:
    """Returns None (rather than a guessed value) if detection fails after retrying -
    the caller must treat that as "unknown", not silently merge it into whatever group
    happened to be current. A wrong guess here is what let 99 pages that actually
    covered several different 地號/建號 silently collapse into one group with no visible
    sign anything had gone wrong."""
    content_parts = [{"type": "text", "text": PAGE_SEQUENCE_PROMPT}]
    for content, mime_type in files:
        cropped = _crop_top_strip(content)
        b64 = base64.b64encode(cropped).decode("ascii")
        content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})

    payload = {
        "model": settings.OPENAI_MODEL,
        "messages": [{"role": "user", "content": content_parts}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "page_sequence_detection", "strict": True, "schema": PAGE_SEQUENCE_SCHEMA},
        },
        "max_tokens": 2048,
    }

    try:
        parsed = _call_openai_structured(payload)
    except OcrError:
        return None

    flags = parsed.get("is_first_page") or []
    if len(flags) != len(files):
        flags = (flags + [True] * len(files))[: len(files)]
    return flags


def detect_page_groups(pages: list[tuple[bytes, str | None]]) -> tuple[list[int], str | None]:
    """Returns (1-based group number per page, optional warning). Group numbers are
    computed from the 「頁次:000001」 field near the top of each page: a page whose 頁次
    reads 000001 starts a new group (it's the first page of a new 地號/建號's own
    record); any other 頁次 value continues the current group. If detection fails for
    some pages even after retrying, those pages are forced to start their own group
    (visible as an odd boundary) rather than silently merged into the current one, and
    a warning is returned naming which pages need manual review. This is only a
    suggestion either way - the wizard's grouping step still lets the user review and
    override every page's group number before OCR runs."""
    if not settings.OPENAI_API_KEY or not pages:
        return [1] * len(pages), None

    chunks = [pages[i : i + PAGES_PER_CHUNK] for i in range(0, len(pages), PAGES_PER_CHUNK)]
    flags: list[bool] = []
    failed_ranges = []
    for i, chunk in enumerate(chunks):
        result = _detect_page_sequence_chunk(chunk)
        if result is None:
            result = [True] * len(chunk)
            start = i * PAGES_PER_CHUNK + 1
            failed_ranges.append(f"第{start}-{start + len(chunk) - 1}頁")
        flags.extend(result)

    groups = []
    group = 1
    for i, is_first in enumerate(flags):
        if i > 0 and is_first:
            group += 1
        groups.append(group)
    warning = f"{'、'.join(failed_ranges)}自動分組偵測失敗,已強制獨立成一組,請務必手動確認分組" if failed_ranges else None
    return groups, warning


# ---- Auto-grouping by 都更案件 (urban renewal case) via the page title ----
#
# Every page's title has two lines: the document type (「土地登記第三類謄本(地號全部)」
# or 「建物登記第三類謄本(建物全部)」), then 「XX區XX段XX小段XX地號/建號」. In this system a
# "案件" is one 地號/建號, not one whole urban-renewal project area - a batch upload
# routinely contains several different 地號 that all sit in the same 鄉鎮市區+段+小段
# (e.g. 0223-0000, 0229-0001, 0229-0002 all under 信義區祥和段三小段), so the location
# text alone can't tell them apart. The signal used here is the same one
# detect_page_groups() uses one level down: a change in the specific 地號/建號 number
# starts a new group - except here it's read via regex off locally-OCR'd text (see
# _parse_case_header) instead of asking a vision model, because both the title and the
# 頁次 field are in a fixed, rigid printed format that doesn't need an LLM to parse, and
# doing it locally means no OpenAI call (no per-page cost, no shared-quota rate limit -
# a batch of a few dozen pages was routinely blowing through the org's 200k
# tokens-per-minute cap and silently losing whole chunks of pages to "detection
# failed").
#
# The title and the 頁次 field live in the same fixed header area at the very top of
# every page (unlike the old 續次頁-marker approach, whose position on the page varied
# with how much content that page had), so cropping to a small top strip before OCR
# keeps each page's OCR pass fast without losing either field.
TOP_STRIP_CROP_FRACTION = 0.15


# Caps the crop's width before OCR - the title/頁次 text is large, clear print, so it
# stays perfectly legible well below the ~1654px a 200-DPI page comes in at, and a
# smaller input measurably speeds up RapidOCR's detection pass (fewer pixels to scan),
# which matters a lot on underpowered hardware like the NAS this batch step often runs
# on (a dual-core Celeron, much weaker than a dev machine).
#
# Was 900, dropped to 640 after a real NAS run logged this header-crop OCR pass taking
# ~5s/page (149s for 27 pages) - detection compute scales roughly with pixel count, so
# a further ~30% smaller input is a meaningful chunk of that. Still comfortably above
# what large-clear-print title/頁次 text needs to stay legible; if pages ever come in
# narrower than this (e.g. a smaller original scan), the resize in _crop_top_strip only
# ever shrinks, so this is a ceiling, not a forced upscale.
TOP_STRIP_MAX_WIDTH = 640


def _decode_image(content: bytes) -> Image.Image | None:
    """Decodes page bytes into a PIL Image once. A ~200-DPI scanned page is a few
    megapixels, and decoding that JPEG is itself real CPU work on weak hardware - not
    the crop/resize afterward, which operates on already-decoded pixels and is cheap by
    comparison. Several steps in a batch-import request (header-crop OCR, the building
    parcel-number crop, the preview thumbnail) each used to independently re-decode the
    same page bytes from scratch; callers here can decode once per page and pass the
    result to all of them instead - see detect_case_groups()'s decoded_images return
    value. Returns None if the bytes aren't a decodable raster image."""
    try:
        img = Image.open(io.BytesIO(content))
        img.load()
        return img
    except Exception:
        return None


def _crop_top_strip(content: bytes, fraction: float = TOP_STRIP_CROP_FRACTION, decoded: Image.Image | None = None) -> bytes:
    img = decoded if decoded is not None else _decode_image(content)
    if img is None:
        return content  # not a decodable raster image - fall back to sending it whole
    width, height = img.size
    cropped = img.crop((0, 0, width, max(1, int(height * fraction))))
    if cropped.width > TOP_STRIP_MAX_WIDTH:
        scale = TOP_STRIP_MAX_WIDTH / cropped.width
        cropped = cropped.resize((TOP_STRIP_MAX_WIDTH, max(1, int(cropped.height * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    cropped.convert("RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue()


# Matches titles like 「信義區祥和段三小段0249-0000地號」or 「板橋區松雲段00102-000建號」.
# 小段 is optional - many 謄本 don't have one. 地號/建號 also matches with the simplified
# 号 glyph (「地号」/「建号」), which some pages get OCR'd as instead of 號.
_CASE_TITLE_PATTERN = re.compile(
    r"(?P<location>[一-鿿]{1,4}(?:市|區|鄉|鎮)[一-鿿]{1,8}段(?:[一-鿿]{1,6}小段)?)"
    r"(?P<number>\d{3,6}-\d{3,6})\s*(?:地[號号]|建[號号])"
)
_DIGITS_PATTERN = re.compile(r"(\d{4,6})")
# Anchors on the 列印時間 line's own date/time digits (「115年04月10日」) rather than the
# 「列印時間」label text - real OCR output showed that label getting misread in several
# different, unpredictable ways (「列」->「岁」, 「間」->「周」, or missing entirely), while
# the digits next to 年/月/日 came through correctly every time across dozens of real
# pages. 年/月/日 are common, visually distinct characters unlikely to all get misread
# together, making this a much sturdier anchor than the label text was.
_PRINT_TIME_LINE_PATTERN = re.compile(r"\d{2,3}年\d{1,2}月\d{1,2}日")


def _find_page_sequence(text: str) -> int | None:
    """Finds the 頁次 field's numeric value by position: it's always printed on the line
    immediately after 列印時間 (located via _PRINT_TIME_LINE_PATTERN - see its comment for
    why), so this pulls the first run of digits off that next line regardless of what
    頁次's own label got misread as (「頁」->「真」, 「次」->「欠」, or garbled beyond
    recognition). Returns None if no 列印時間 line (or no digits on the line after it) was
    found - the caller treats that as "unknown", not "definitely page 1"."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if _PRINT_TIME_LINE_PATTERN.search(line) and i + 1 < len(lines):
            match = _DIGITS_PATTERN.search(lines[i + 1])
            return int(match.group(1)) if match else None
    return None


def _parse_case_header(text: str) -> tuple[str, str, int | None]:
    """Pulls this page's (地點, 地號/建號, 頁次) straight out of its OCR'd header text.
    The 頁次 value (None if unreadable - see _find_page_sequence) is what
    detect_case_groups() uses to decide group boundaries - comparing 地號/建號 strings
    directly was tried first and turned out too fragile: a single misread digit in a
    multi-digit 地號 (e.g. a vision model conflating the adjacent 頁次 field and reading
    "0230-0000"/"000003" as if "0230-0003" was the parcel number) silently fractured one
    real group into two. location and sample_number are kept both for suggesting a
    readable case name/code, and (since detect_case_groups() below now falls back to
    them when 頁次 is unreadable) as a secondary boundary signal."""
    # OCR sometimes splits the title across two detected lines right at the 小段
    # boundary (e.g. 「信義區祥和段」 / 「小段0250-0000地號」as separate lines) - flatten
    # newlines before matching so the title pattern still catches it as one string.
    # _find_page_sequence below needs the original line structure, so this flattened
    # copy is only used for the title search.
    flattened = text.replace("\n", "")
    location, sample_number = "", ""
    for match in _CASE_TITLE_PATTERN.finditer(flattened):
        # Skip 「共同保地號:」/「共同保建號:」cross-reference lines lower in the header -
        # they're a different parcel/building than this page's own title and can appear
        # without a 市/區/鄉/鎮 prefix, but guard anyway in case a document's OCR text
        # ever lines them up in a way that matches.
        prefix = flattened[max(0, match.start() - 6) : match.start()]
        if "共同" in prefix:
            continue
        location, sample_number = match.group("location"), match.group("number")
        break

    return location, sample_number, _find_page_sequence(text)


def detect_case_groups(
    pages: list[tuple[bytes, str | None]],
) -> tuple[list[tuple[int, str, str]], str | None, list[Image.Image | None]]:
    """Returns ([(1-based case group number, detected location label, sample 地號/建號),
    ...], optional warning, decoded_images). A "案件" here is one 地號/建號: a page whose
    頁次 reads 000001 starts a new group; any other 頁次 value continues whatever group is
    current. location/sample_number play no part in the boundary - they're only carried
    along to suggest a readable case name/code. Detection runs entirely locally (OCR +
    regex, see _parse_case_header) - no OpenAI call, no per-page cost, no shared rate
    limit. If a page's header can't be parsed (OCR failure or unexpected format), that
    page is forced to start its own new group instead of being silently merged into
    whatever group was current, and a warning names which pages need manual review. Only
    a suggestion either way - the batch-import review step lets the user move pages
    between groups and rename each group before any project gets created.

    decoded_images is each page's already-decoded PIL Image (None for any page that
    failed to decode), aligned index-for-index with `pages` - callers doing further work
    on the same pages right after this (building the preview thumbnails, the building
    batch's parcel-number crop) should pass these along instead of re-decoding the same
    JPEG bytes from scratch; see _decode_image()."""
    if not pages:
        return [], None, []

    def _ocr_one_page(i: int, content: bytes) -> tuple[str, tuple[str, str, int | None], Image.Image | None]:
        try:
            decoded = _decode_image(content)
            text = _ocr_header_text(_crop_top_strip(content, decoded=decoded))
            return text, _parse_case_header(text), decoded
        except Exception as exc:
            print(f"[detect_case_groups] page {i + 1} OCR/parse failed: {exc}", flush=True)
            return "", ("(偵測失敗)", "", None), None

    with ThreadPoolExecutor(max_workers=min(_HEADER_OCR_WORKERS, len(pages))) as pool:
        page_results = list(pool.map(lambda args: _ocr_one_page(*args), enumerate(content for content, _mime_type in pages)))

    entries: list[tuple[str, str, int | None]] = [entry for _text, entry, _decoded in page_results]
    decoded_images: list[Image.Image | None] = [decoded for _text, _entry, decoded in page_results]
    failed_pages: list[int] = [i + 1 for i, entry in enumerate(entries) if entry[0] == "(偵測失敗)"]

    grouped: list[tuple[int, str, str]] = []
    group = 1
    prev_sample_number = ""
    for i, (label, sample_number, seq) in enumerate(entries):
        if i > 0:
            if label == "(偵測失敗)":
                is_new_group = True  # OCR/parse blew up - can't trust anything about this page, so isolate it
            elif seq == 1:
                is_new_group = True  # explicit 頁次:000001 - trust it over everything else
            elif seq is None:
                # 頁次 line itself couldn't be read (garbled 列印時間 line, odd layout,
                # ...) - rather than defaulting to "new group" (which silently fractured
                # a single real 地號/建號's pages into two groups sharing the same
                # detected code whenever this happened, and then made batch-create 409
                # on the second one's duplicate project_code), fall back to comparing
                # this page's own 地號/建號 against the group we're currently in: same
                # code very likely means "still the same case, 頁次 just didn't OCR
                # cleanly", different code (or none) means a real new case starts here.
                is_new_group = not (sample_number and sample_number == prev_sample_number)
            else:
                is_new_group = False  # 頁次 > 1 - definitely a continuation page
            if is_new_group:
                group += 1
        grouped.append((group, label, sample_number))
        if label != "(偵測失敗)":
            prev_sample_number = sample_number

    # One line per page, not the full raw OCR text dump this used to include - that was
    # useful while actively diagnosing the grouping-boundary bug (now fixed, see the
    # is_new_group fallback above), but printing 2+ lines of full raw OCR text per page
    # on every single batch forever is a lot of unnecessary log I/O for no ongoing
    # benefit, and on a NAS where disk/log I/O is already a scarce resource that's worth
    # trimming. Kept as one compact summary line so which-page-went-to-which-group is
    # still visible in the log if something looks off.
    summary = " ".join(f"{i + 1}:g{group_no}" for i, (group_no, _l, _s) in enumerate(grouped))
    print(f"[detect_case_groups] {len(grouped)} page(s) -> groups: {summary}", flush=True)

    warning = (
        f"第{'、'.join(str(p) for p in failed_pages)}頁自動分案偵測失敗,已強制獨立成一組,請務必手動確認分組"
        if failed_pages
        else None
    )
    return grouped, warning, decoded_images


# Building deeds print "建物坐落地號:XX段XX小段0223-0000" as one of the first lines of the
# 建物標示部 body, just below the page's own "...建號" title - close enough to the top
# that a slightly taller local-OCR crop (instead of the narrow title-only strip
# detect_case_groups uses) reliably catches it. This lets the batch building-import's
# case-detect step match each group to an existing 地號 project locally (no OpenAI call),
# the same way detect_case_groups() itself avoids the API - full AI extraction (for
# owners/address/floors) is deferred to whichever group the user actually confirms and
# imports, instead of running it for every group up front.
BUILDING_BODY_CROP_FRACTION = 0.35


# Real samples show the field printed as "建物坐落地址:祥和段三小段0242-0000" - a label
# *prefix* (地址, not 地號) with the location+number run directly after it and no
# trailing 地號/建號 suffix at all, unlike the 地號-suffixed 「共同保地號」cross-reference
# style _CASE_TITLE_PATTERN was built for. So this can't reuse that suffix-matching
# approach and needs its own label-anchored pattern instead. 坐/座 and 號/号/址 are all
# accepted since which glyph a given deed template (or OCR) uses varies.
_BUILDING_PARCEL_LABEL_PATTERN = re.compile(
    r"建物[坐座]落地[號号址]\s*[:：﹕]?\s*[^0-9\n]{0,20}?(?P<number>\d{3,6}-\d{3,6})"
)


def _find_building_parcel_number(text: str) -> str:
    """Scans locally-OCR'd text (see BUILDING_BODY_CROP_FRACTION) for the 建物坐落地址/
    建物坐落地號 field's parcel number. Tries the label-anchored pattern first (see
    _BUILDING_PARCEL_LABEL_PATTERN for why - this is the format real deeds actually use),
    then falls back to the older 地[號号]-suffixed style in case some deed templates print
    it that way instead. Returns "" if neither matches."""
    flattened = text.replace("\n", "")
    label_match = _BUILDING_PARCEL_LABEL_PATTERN.search(flattened)
    if label_match:
        return label_match.group("number")
    for match in _CASE_TITLE_PATTERN.finditer(flattened):
        prefix = flattened[max(0, match.start() - 6) : match.start()]
        if "共同" in prefix:
            continue
        suffix = match.group(0)[-2:]
        if suffix in ("地號", "地号"):
            return match.group("number")
    return ""


def detect_building_parcel_numbers(
    pages: list[tuple[bytes, str | None]],
    first_page_indices: list[int],
    decoded_images: list[Image.Image | None] | None = None,
) -> dict[int, str]:
    """For each given page index (expected to be the first page of a detected 建號 group),
    locally OCRs a taller top crop and returns {index: 建物坐落地號} for whichever ones a
    地號-suffixed match was found on. No OpenAI call. Pass decoded_images (see
    detect_case_groups()'s return value) to reuse each page's already-decoded image
    instead of re-decoding the same JPEG bytes a second time."""
    def _ocr_one_group(i: int) -> tuple[int, str]:
        page_start = time.monotonic()
        try:
            decoded = decoded_images[i] if decoded_images else None
            text = _ocr_header_text(_crop_top_strip(pages[i][0], fraction=BUILDING_BODY_CROP_FRACTION, decoded=decoded))
            parcel_number = _find_building_parcel_number(text)
            # Kept as a permanent (not TEMP DEBUG) log, not just for slow-page failures -
            # a real incident on the NAS showed this step going quiet for 5+ minutes with
            # no other signal at all about whether it was still working or stuck, since
            # the previous debug logging here had already been removed. Per-page timing
            # is cheap and is the only way to tell "still grinding through weak NAS CPU"
            # apart from "actually hung" after the fact from the log alone.
            print(f"[detect_building_parcel_numbers] page {i + 1}: {time.monotonic() - page_start:.2f}s parcel_number={parcel_number!r}", flush=True)
            return i, parcel_number
        except Exception as exc:
            print(f"[detect_building_parcel_numbers] page {i + 1} OCR/parse failed after {time.monotonic() - page_start:.2f}s: {exc}", flush=True)
            return i, ""

    result: dict[int, str] = {}
    if not first_page_indices:
        return result
    start = time.monotonic()
    print(f"[detect_building_parcel_numbers] starting {len(first_page_indices)} group(s)", flush=True)
    with ThreadPoolExecutor(max_workers=min(_HEADER_OCR_WORKERS, len(first_page_indices))) as pool:
        for i, parcel_number in pool.map(_ocr_one_group, first_page_indices):
            if parcel_number:
                result[i] = parcel_number
    print(f"[detect_building_parcel_numbers] done: {len(first_page_indices)} group(s) in {time.monotonic() - start:.2f}s", flush=True)
    return result
