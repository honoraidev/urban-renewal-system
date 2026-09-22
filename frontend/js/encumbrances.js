"use strict";

function parseSecuredAmount(v) {
  if (v === null || v === undefined) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function formatSecuredAmount(v) {
  const n = parseSecuredAmount(v);
  return n === null ? "" : n.toLocaleString("en-US");
}

// 義務人清單(有人名+各自比例)是新資料的正式欄位;debtor_info 是舊資料/OCR謄本
// 匯入精靈還在用的單一整體比例文字(沒有人名) - 顯示時 obligors 有值就優先用它,
// 沒有才退回顯示 debtor_info,兩者不會同時有值。
function encumbranceObligorsSummary(enc) {
  if (enc.obligors && enc.obligors.length) {
    return enc.obligors
      .map((o) => {
        const ratio = o.numerator && o.denominator ? `(${o.denominator}分之${o.numerator})` : "";
        return `${o.name || "(未填姓名)"}${ratio}`;
      })
      .join("、");
  }
  return enc.debtor_info || "";
}

const PARCEL_KIND_LABEL = { land: "地號", building: "建號" };

// 浮動下拉面板(共N戶/共N筆 ▾)的通用產生器 + 定位邏輯 - 原本用 <details>/<summary>
// 內建的 position:absolute,面板巢狀在 .table-wrap(overflow-x:auto)裡面,瀏覽器會
// 把 overflow-y 也一併視為 auto,面板沒辦法真的「浮出」容器,而是被硬夾在容器可視
// 範圍內、跑到奇怪的位置(甚至疊到分頁列上面)。改成點擊時用 JS 算觸發按鈕的螢幕
// 座標、把面板用 position:fixed 直接掛到 document.body,徹底脫離表格容器的
// overflow 限制。面板內容存在旁邊一個不會顯示的 <template>,點擊當下才讀出來塞進
// 浮動面板,不用每個按鈕各自綁一份內容。
let _encDdSeq = 0;
function encDropdownHtml(triggerHtml, panelInnerHtml) {
  const id = `enc-dd-${++_encDdSeq}`;
  return `<span style="position:relative;display:inline-flex">
      <button type="button" class="enc-addr-toggle" data-enc-dd-toggle="${id}">${triggerHtml}</button>
    </span><template id="${id}-tpl">${panelInnerHtml}</template>`;
}
function _closeEncDd() {
  document.getElementById("enc-dd-panel")?.remove();
}
function wireEncDropdowns(container) {
  container.querySelectorAll("[data-enc-dd-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.encDdToggle;
      const already = document.getElementById("enc-dd-panel");
      const wasOpenForThis = already && already.dataset.forId === id;
      _closeEncDd();
      if (wasOpenForThis) return; // 再點一次同一顆 = 關閉
      const tpl = document.getElementById(`${id}-tpl`);
      if (!tpl) return;
      const rect = btn.getBoundingClientRect();
      const panel = document.createElement("div");
      panel.id = "enc-dd-panel";
      panel.className = "enc-addr-dd-panel";
      panel.dataset.forId = id;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.left = `${rect.left}px`;
      panel.innerHTML = tpl.innerHTML;
      document.body.appendChild(panel);
      // 面板可能超出視窗右邊,往左移到剛好貼齊視窗邊緣。
      const overflowRight = panel.getBoundingClientRect().right - window.innerWidth;
      if (overflowRight > 0) panel.style.left = `${rect.left - overflowRight - 8}px`;
    });
  });
}
// 這個全域點擊監聽只需要掛一次(不是每次 renderBody 都掛),放在 module 層級靠
// IIFE 執行一次即可,重複掛一堆同樣的監聽器沒有意義還浪費效能。
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-enc-dd-toggle]") && !e.target.closest("#enc-dd-panel")) _closeEncDd();
});

// 純地址字串裡抓「幾樓/地下幾層」- 跟 landowners.js 的 _floorLabelOf 邏輯一樣,但
// 那個吃的是完整 building_record 物件(優先讀 .floor 欄位),這裡手上只有從
// property_address 拆出來的地址片段,沒有結構化欄位可以先讀,只能從文字裡撈。
function _floorFromAddrString(addr) {
  const a = String(addr || "").replace(/[０-９]/g, (d) => "０１２３４５６７８９".indexOf(d));
  const m = a.match(/地下[一二三四五六七八九十\d]+層|\d+\s*樓/);
  return m ? m[0].replace(/\s+/g, "") : "";
}

// 地號/建號欄:applies_to_parcels 是空白隔開的多筆(共同擔保好幾個地號/建號很常見,
// 見 utils/ocr.py _normalize_applies_to_parcels),超過 1 筆就跟門牌地址欄同一套
// 「共N筆 ▾」浮動下拉收合,不然共同擔保一多這欄會被撐成一長串。
function encumbranceParcelsCellHtml(enc) {
  const tokens = (enc.applies_to_parcels || "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return "-";
  // 只有1筆也用膠囊(mini-badge)顯示,跟多筆時的樣式統一,不要單筆是純文字、
  // 多筆才是膠囊的不一致外觀。
  if (tokens.length === 1) return `<span class="mini-badge">${escapeHtml(tokens[0])}</span>`;
  const panelHtml = tokens.map((t) => `<div class="enc-addr-panel-row">${escapeHtml(t)}</div>`).join("");
  return `<div class="enc-addr-cell">
      <div class="enc-addr-line">
        <span class="mini-badge">${escapeHtml(tokens[0])}</span>
        ${encDropdownHtml(`共${tokens.length}筆 ▾`, panelHtml)}
      </div>
    </div>`;
}

// 地號本身沒有門牌 - 後端(見 backend routers/encumbrances.py)查地號分頁缺門牌時,
// 會自動補蓋在這塊地上的建物門牌,每筆編碼成「地址::建號」、用「、」串成一個字串
// 回來。這裡拆開,比照整合清冊的門牌欄各自簡化(_shortDoorAddr,定義在
// landowners.js)、補上樓層(_floorFromAddrString,同一戶門牌可能對應好幾個不同
// 樓層的建號,樓層才是真正分辨「這筆他項權利設定在哪一戶」的關鍵資訊,只看門牌
// 號碼會以為好幾筆都是同一戶)、地下室/車位持分建號一樣標灰色「(地下持分)」,
// 同時把建號標出來方便對照是哪一棟。一整棟大樓的地號常常底下蓋了幾十戶,每戶又
// 對到好幾個建號(樓層/車位各自登記),不收起來的話這欄會被撐成一長串,所以:
//   1. 每戶的建號超過 2 個就只顯示前 2 個 + 「共N筆」,完整清單放 title 提示裡。
//   2. 戶數超過 1 戶就整體收合成「共N戶 ▾」,預設只看第一戶,點開才看全部。
function encumbrancePropertyAddressCellHtml(enc) {
  if (!enc.property_address) return "-";
  const addrMap = new Map(); // label -> { shared, buildingNumbers: Set }
  enc.property_address.split("、").forEach((raw) => {
    const [addrPart, buildingNumber] = raw.split("::");
    const base = _shortDoorAddr(addrPart);
    if (!base) return;
    const floor = _floorFromAddrString(addrPart);
    const label = floor ? `${base} ${floor}` : base;
    const shared = /房屋地下/.test(addrPart);
    if (!addrMap.has(label)) addrMap.set(label, { shared, buildingNumbers: new Set() });
    if (buildingNumber) addrMap.get(label).buildingNumbers.add(buildingNumber);
  });
  const entries = [...addrMap.entries()];
  if (!entries.length) return escapeHtml(enc.property_address);

  // 一戶 = 門牌徽章(只放簡化後的門牌,短短一顆) + 底下一行灰字建號;建號多了只列前 2 個
  // + 「等N筆」,完整清單放 title。徽章跟建號拆開,才不會整顆膠囊被拉得又長又擠。
  const badgeOnly = ([a, info]) =>
    info.shared
      ? `<span class="mini-badge mini-badge-shared-door" title="依持分比例登記的地下室/車位建號,非專屬住家門牌">${escapeHtml(a)}(地下持分)</span>`
      : `<span class="mini-badge">${escapeHtml(a)}</span>`;
  const bnHtml = (info) => {
    const bns = [...info.buildingNumbers];
    if (!bns.length) return "";
    const text = `建號 ${bns.slice(0, 2).join("、")}${bns.length > 2 ? ` 等${bns.length}筆` : ""}`;
    return `<div class="enc-addr-bn"${bns.length > 2 ? ` title="建號:${escapeHtml(bns.join("、"))}"` : ""}>${escapeHtml(text)}</div>`;
  };

  if (entries.length === 1) {
    return `<div class="enc-addr-cell"><div class="enc-addr-line">${badgeOnly(entries[0])}</div>${bnHtml(entries[0][1])}</div>`;
  }
  const panelHtml = entries
    .map((e) => `<div class="enc-addr-panel-row">${badgeOnly(e)}${bnHtml(e[1])}</div>`)
    .join("");
  return `
    <div class="enc-addr-cell">
      <div class="enc-addr-line">
        ${badgeOnly(entries[0])}
        ${encDropdownHtml(`共${entries.length}戶 ▾`, panelHtml)}
      </div>
      ${bnHtml(entries[0][1])}
    </div>`;
}

// 義務人不只一位時,格子裡只先顯示第一位,其餘用一顆「共N位 ▾」按鈕點下拉才看到
// 完整名單 - 不然共有人一多,這欄會被撐得比其他欄都寬,整張表版面跟著跑掉。只有
// 一位就直接顯示,不用多一層點開的動作。
function encumbranceObligorsCellHtml(enc) {
  const list =
    enc.obligors && enc.obligors.length
      ? enc.obligors.map((o) => {
          const ratio = o.numerator && o.denominator ? `(${o.denominator}分之${o.numerator})` : "";
          return `${o.name || "(未填姓名)"}${ratio}`;
        })
      : enc.debtor_info
        ? [enc.debtor_info]
        : [];
  if (!list.length) return "-";
  if (list.length === 1) return escapeHtml(list[0]);
  return `
    <div class="enc-obligor-cell">
      <span class="enc-obligor-first">${escapeHtml(list[0])}</span>
      <button type="button" class="enc-obligor-toggle" data-obligor-toggle>共${list.length}位 ▾</button>
      <div class="enc-obligor-dd-list hidden">${list.map((s) => `<div>${escapeHtml(s)}</div>`).join("")}</div>
    </div>`;
}

function encumbranceRowHtml(enc) {
  return `<tr>
    <td>${escapeHtml(enc.registration_order) || "-"}</td>
    <td>${encumbranceParcelsCellHtml(enc)}</td>
    <td>${encumbrancePropertyAddressCellHtml(enc)}</td>
    <td>${encRightTypeBadgeHtml(enc.right_type)}</td>
    <td>${escapeHtml(enc.right_holder) || "-"}</td>
    <td>${encumbranceObligorsCellHtml(enc)}</td>
    <td style="text-align:right;white-space:nowrap">${formatSecuredAmount(enc.secured_amount) || "-"}</td>
    ${isEditor()
      ? `<td class="actions-cell">
            <button type="button" class="tinted-icon-btn" data-edit-encumbrance="${enc.id}" title="編輯">✏️</button>
            <button type="button" class="tinted-icon-btn tinted-icon-btn-danger" data-delete-encumbrance="${enc.id}" title="刪除">🗑</button>
          </td>`
      : ""
    }
  </tr>`;
}

function encumbranceMatchesQuery(enc, q) {
  if (!q) return true;
  const haystack = [
    enc.registration_order,
    enc.applies_to_parcels,
    PARCEL_KIND_LABEL[enc.parcel_kind],
    enc.property_address,
    enc.right_type,
    enc.right_holder,
    encumbranceObligorsSummary(enc),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

// 分地號/建號兩個子分頁瀏覽 - parcel_kind 是近期才加的欄位,舊資料多半沒填,沒填的
// 一律歸到「地號」分頁(都更他項權利登記本來就以地號為主),不會讓舊資料憑空消失。
let encActiveKind = "land";
// 分頁狀態跨次渲染保留,不放在 renderEncumbrancesTab 內部 - 不然每次重畫這個分頁
// 都會被重設回第 1 頁,使用者翻到一半的頁碼就白翻了。
let encUi = { page: 1, pageSize: 20, rightType: "" };

function encumbranceKindOf(enc) {
  return enc.parcel_kind === "building" ? "building" : "land";
}

// 權利種類只認「最高限額抵押權」「抵押權」兩種標準值(見 ocr_wizard.js 的
// ENCUMBRANCE_RIGHT_TYPE_OPTIONS),其餘手動輸入的自由文字一律歸類成「其他」,
// 統計卡片跟篩選下拉才不會因為使用者亂打字而長出幾十種不重複的分類。
function encRightTypeCategory(type) {
  if (type === "最高限額抵押權") return "最高限額抵押權";
  if (type === "抵押權") return "抵押權";
  return type ? "其他" : "";
}

const ENC_RIGHT_TYPE_TONE = { "最高限額抵押權": "opposed", "抵押權": "info", "其他": "other" };

function encRightTypeBadgeHtml(type) {
  if (!type) return `<span style="color:var(--text-muted)">-</span>`;
  const tone = ENC_RIGHT_TYPE_TONE[encRightTypeCategory(type)] || "other";
  return `<span class="mini-badge enc-type-badge enc-type-${tone}">${escapeHtml(type)}</span>`;
}

function encumbranceExportCsv(list) {
  if (!list.length) {
    toast("目前沒有可匯出的資料", "error");
    return;
  }
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["登記次序", "地號/建號", "門牌地址", "權利種類", "他項權利人", "義務人", "擔保債權總金額"];
  const lines = [head.map(esc).join(",")];
  list.forEach((enc) => {
    lines.push(
      [
        enc.registration_order || "", enc.applies_to_parcels || "", (enc.property_address || "").replace(/::[^、]*/g, ""),
        enc.right_type || "", enc.right_holder || "", encumbranceObligorsSummary(enc), formatSecuredAmount(enc.secured_amount) || "",
      ].map(esc).join(",")
    );
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `他項權利部_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function renderEncumbrancesTab(el) {
  const pid = state.currentProjectId;
  const encumbrances = await api(`/projects/${pid}/encumbrances`);
  state.projectCache[pid].encumbrances = encumbrances;
  const landCount = encumbrances.filter((e) => encumbranceKindOf(e) === "land").length;
  const buildingCount = encumbrances.length - landCount;
  const totalSecured = encumbrances.reduce((s, e) => s + (parseSecuredAmount(e.secured_amount) || 0), 0);
  const rightTypeCats = [...new Set(encumbrances.map((e) => encRightTypeCategory(e.right_type)).filter(Boolean))];
  if (encUi.rightType && !rightTypeCats.includes(encUi.rightType)) encUi.rightType = "";

  function currentKindList() {
    return encumbrances.filter((e) => encumbranceKindOf(e) === encActiveKind);
  }
  function currentFiltered() {
    const q = (document.getElementById("encumbrance-search")?.value || "").trim().toLowerCase();
    return currentKindList().filter(
      (enc) => encumbranceMatchesQuery(enc, q) && (!encUi.rightType || encRightTypeCategory(enc.right_type) === encUi.rightType)
    );
  }

  const statTile = (icon, tone, label, valueHtml) => `
    <div class="enc-stat-tile enc-stat-${tone}">
      <div class="enc-stat-icon">${icon}</div>
      <div><div class="enc-stat-lbl">${label}</div><div class="enc-stat-val">${valueHtml}</div></div>
    </div>`;

  el.innerHTML = `
    <div class="section-toolbar" style="flex-wrap:wrap;gap:12px">
      <h3 class="section-hero-title"><span class="hero-ic">📋</span>他項權利部 (${encumbrances.length})</h3>
      <div class="hero-search">${BV_ICON.search}<input type="search" id="encumbrance-search" placeholder="搜尋地號/門牌/權利種類/權利人..."></div>
      ${rightTypeCats.length
      ? `<details class="integ-filter" style="position:relative">
              <summary style="list-style:none;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);white-space:nowrap;font-size:13px">🔽 更多篩選 ▾</summary>
              <div style="position:absolute;z-index:20;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:160px;right:0">
                <div style="font-size:11px;color:var(--text-muted);font-weight:700;margin-bottom:4px">權利種類</div>
                ${rightTypeCats
        .map(
          (t) =>
            `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;white-space:nowrap"><input type="radio" name="enc-right-type" value="${escapeHtml(t)}" style="width:auto"${encUi.rightType === t ? " checked" : ""}>${escapeHtml(t)}</label>`
        )
        .join("")}
                <label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;white-space:nowrap;border-top:1px solid var(--border);margin-top:4px;padding-top:6px"><input type="radio" name="enc-right-type" value="" style="width:auto"${encUi.rightType ? "" : " checked"}>全部</label>
              </div>
            </details>`
      : ""
    }
      <div style="margin-left:auto;display:flex;gap:8px">
        <button type="button" class="btn-secondary btn-sm" id="enc-export-btn">⬆ 匯出 Excel</button>
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-encumbrance-btn">+ 新增他項權利</button>` : ""}
      </div>
    </div>
    <div class="helper-text" style="margin:-4px 0 14px">管理土地與建物之他項權利資料,支援搜尋、篩選與編輯作業。</div>
    <div class="enc-stat-row">
      ${statTile("🌱", "land", "土地他項權利", `${landCount} <small>筆</small>`)}
      ${statTile("🏢", "building", "建物他項權利", `${buildingCount} <small>筆</small>`)}
      ${statTile("🏦", "type", "權利種類", `${rightTypeCats.length} <small>種</small><div class="enc-stat-sub">${rightTypeCats.join(" / ") || "-"}</div>`)}
      ${statTile("💰", "amount", "擔保債權總金額", `${totalSecured.toLocaleString()} <small>元</small>`)}
    </div>
    <div class="enc-kind-toggle" id="enc-kind-tabs">
      <button type="button" class="enc-kind-btn ${encActiveKind === "land" ? "active" : ""}" data-enc-kind="land">🌱 土地 (${landCount})</button>
      <button type="button" class="enc-kind-btn ${encActiveKind === "building" ? "active" : ""}" data-enc-kind="building">🏢 建物 (${buildingCount})</button>
    </div>
    <div class="table-wrap">
      <table class="enc-table">
        <thead><tr>
          <th>登記次序</th><th>${encActiveKind === "building" ? "建號" : "地號"}</th><th>門牌地址</th><th>權利種類</th><th>他項權利人</th><th>債權額比例</th><th style="text-align:right">擔保債權總金額</th>
          ${isEditor() ? "<th>操作</th>" : ""}
        </tr></thead>
        <tbody id="encumbrance-tbody"></tbody>
      </table>
    </div>
    <div class="lv-foot" id="encumbrance-foot"></div>
  `;

  function renderBody() {
    const filtered = currentFiltered();
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / encUi.pageSize));
    if (encUi.page > pages) encUi.page = pages;
    const start = (encUi.page - 1) * encUi.pageSize;
    const slice = filtered.slice(start, start + encUi.pageSize);

    const tbody = document.getElementById("encumbrance-tbody");
    tbody.innerHTML = slice.length
      ? slice.map(encumbranceRowHtml).join("")
      : `<tr><td colspan="${isEditor() ? 8 : 7}" class="empty-state" style="border:none">${encActiveKind === "land" ? "尚無土地他項權利資料" : "尚無建物他項權利資料"}</td></tr>`;
    wireRowButtons();
    wireEncDropdowns(tbody);

    const pageBtn = (label, n, opts = {}) =>
      `<button type="button" class="lv-pg${opts.active ? " active" : ""}${opts.arrow ? " lv-pg-arrow" : ""}" data-enc-page="${n}"${opts.disabled ? " disabled" : ""}${opts.aria ? ` aria-label="${opts.aria}"` : ""}>${label}</button>`;
    const items = lttPageItems(encUi.page, pages)
      .map((n) => (n === "…" ? `<span class="lv-pg-gap">…</span>` : pageBtn(n, n, { active: n === encUi.page })))
      .join("");
    document.getElementById("encumbrance-foot").innerHTML = `
      <div class="lv-foot-info">${total ? `顯示 ${start + 1} - ${start + slice.length} 筆,共 ${total} 筆` : "共 0 筆"}</div>
      <div class="lv-pager">
        ${pageBtn(LTT_ICON.chevLeft, encUi.page - 1, { arrow: true, disabled: encUi.page <= 1, aria: "上一頁" })}
        ${items}
        ${pageBtn(LTT_ICON.chevRight, encUi.page + 1, { arrow: true, disabled: encUi.page >= pages, aria: "下一頁" })}
      </div>
      <div class="lv-foot-size"><span>每頁顯示</span>
        <select class="lv-select lv-select-sm" id="encumbrance-page-size">${[10, 20, 50, 100].map((n) => `<option value="${n}"${n === encUi.pageSize ? " selected" : ""}>${n}</option>`).join("")}</select>
      </div>`;
  }

  function wireRowButtons() {
    el.querySelectorAll("[data-delete-encumbrance]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除此筆他項權利嗎?")) return;
        try {
          await api(`/projects/${pid}/encumbrances/${btn.dataset.deleteEncumbrance}`, { method: "DELETE" });
          toast("已刪除", "success");
          renderTab("encumbrances");
        } catch (err) { }
      });
    });
    el.querySelectorAll("[data-edit-encumbrance]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const enc = encumbrances.find((e) => e.id === Number(btn.dataset.editEncumbrance));
        if (enc) openEncumbranceFormModal(enc);
      });
    });
    el.querySelectorAll("[data-obligor-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.nextElementSibling?.classList.toggle("hidden");
      });
    });
  }

  renderBody();

  el.querySelectorAll("[data-enc-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      encActiveKind = btn.dataset.encKind;
      encUi.page = 1;
      renderTab("encumbrances");
    });
  });

  document.getElementById("encumbrance-search")?.addEventListener("input", () => {
    encUi.page = 1;
    renderBody();
  });

  el.querySelectorAll('input[name="enc-right-type"]').forEach((r) => {
    r.addEventListener("change", () => {
      encUi.rightType = r.value;
      encUi.page = 1;
      renderBody();
    });
  });
  // 一次只開一個篩選面板
  const encDetails = [...el.querySelectorAll("details.integ-filter")];
  encDetails.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open) encDetails.forEach((o) => { if (o !== d) o.open = false; });
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".integ-filter")) encDetails.forEach((d) => (d.open = false));
  });

  document.getElementById("encumbrance-foot").addEventListener("click", (e) => {
    const pg = e.target.closest("[data-enc-page]");
    if (pg && !pg.disabled) {
      encUi.page = Number(pg.dataset.encPage);
      renderBody();
    }
  });
  document.getElementById("encumbrance-foot").addEventListener("change", (e) => {
    if (e.target.id === "encumbrance-page-size") {
      encUi.pageSize = Number(e.target.value);
      encUi.page = 1;
      renderBody();
    }
  });

  document.getElementById("enc-export-btn")?.addEventListener("click", () => encumbranceExportCsv(currentFiltered()));
  const addBtn = document.getElementById("add-encumbrance-btn");
  if (addBtn) addBtn.addEventListener("click", () => openEncumbranceFormModal(null, encActiveKind));
}

function openEncumbranceFormModal(encumbrance, defaultKind) {
  const isEdit = !!encumbrance;
  const e = encumbrance || {
    registration_order: "",
    applies_to_parcels: "",
    parcel_kind: defaultKind || "",
    property_address: "",
    right_type: "",
    right_holder: "",
    secured_amount: null,
  };
  openModal(
    isEdit ? "編輯他項權利" : "新增他項權利",
    `
    <form id="encumbrance-form">
      <div class="field-row">
        <div class="field"><label>登記次序</label><input name="registration_order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
        <div class="field" style="flex:0 0 120px">
          <label>類型</label>
          <select name="parcel_kind">
            <option value="" ${!e.parcel_kind ? "selected" : ""}>不分類</option>
            <option value="land" ${e.parcel_kind === "land" ? "selected" : ""}>土地</option>
            <option value="building" ${e.parcel_kind === "building" ? "selected" : ""}>建物</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>對應地號/建號<span class="helper-text" style="font-weight:400">(共同擔保好幾筆時,每筆換行分開填,不用自己空格隔開)</span></label>
        <textarea name="applies_to_parcels" rows="2" style="font-family:inherit;resize:vertical" autocomplete="off">${escapeHtml((e.applies_to_parcels || "").split(/\s+/).filter(Boolean).join("\n"))}</textarea>
      </div>
      <div class="field">
        <label>門牌地址<span class="helper-text" style="font-weight:400">(好幾戶時用頓號、分開,每戶各自一行看比較清楚)</span></label>
        <textarea name="property_address" rows="3" style="font-family:inherit;resize:vertical" autocomplete="off">${escapeHtml((e.property_address || "").split("、").filter(Boolean).join("\n"))}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label>權利種類</label>
          <select name="right_type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
        </div>
        <div class="field"><label>他項權利人</label><input name="right_holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
      </div>
      <div class="field" style="max-width:260px">
        <label>擔保債權總金額(元)</label>
        <input name="secured_amount" inputmode="numeric" value="${escapeHtml(formatSecuredAmount(e.secured_amount))}" placeholder="例:3,600,000" autocomplete="off">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">${isEdit ? "儲存" : "新增"}</button>
      </div>
    </form>`
  );

  document.getElementById("encumbrance-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    // textarea 裡改成一行一筆是給使用者看的排版,存回資料庫前要還原成原本的分隔
    // 格式(地號/建號空白隔開、門牌地址頓號隔開),後端跟其他地方讀取的格式才不會變。
    const parcelsLines = (fd.get("applies_to_parcels") || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const addressLines = (fd.get("property_address") || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const payload = {
      registration_order: (fd.get("registration_order") || "").trim() || null,
      applies_to_parcels: parcelsLines.join(" ") || null,
      parcel_kind: (fd.get("parcel_kind") || "").trim() || null,
      property_address: addressLines.join("、") || null,
      right_type: (fd.get("right_type") || "").trim() || null,
      right_holder: (fd.get("right_holder") || "").trim() || null,
      secured_amount: parseSecuredAmount(fd.get("secured_amount")),
    };
    try {
      if (isEdit) {
        await api(`/projects/${state.currentProjectId}/encumbrances/${encumbrance.id}`, { method: "PATCH", body: payload });
      } else {
        await api(`/projects/${state.currentProjectId}/encumbrances`, { method: "POST", body: payload });
      }
      closeModal();
      toast(isEdit ? "已更新" : "已新增", "success");
      renderTab("encumbrances");
    } catch (err) { }
  });
}
