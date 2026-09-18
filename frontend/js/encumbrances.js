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

function encumbranceParcelsCellHtml(enc) {
  const value = escapeHtml(enc.applies_to_parcels) || "-";
  const kindLabel = PARCEL_KIND_LABEL[enc.parcel_kind];
  return kindLabel ? `<span class="mini-badge">${kindLabel}</span> ${value}` : value;
}

// 地號本身沒有門牌 - 後端(見 backend routers/encumbrances.py)查地號分頁缺門牌時,
// 會自動補蓋在這塊地上的建物門牌,每筆編碼成「地址::建號」、用「、」串成一個字串
// 回來。這裡拆開,比照整合清冊的門牌欄各自簡化(_shortDoorAddr,定義在
// landowners.js)、地下室/車位持分建號一樣標灰色「(地下持分)」,同時把建號標出來
// 方便對照是哪一棟。一整棟大樓的地號常常底下蓋了幾十戶,每戶又對到好幾個建號
// (樓層/車位各自登記),不收起來的話這欄會被撐成一長串,所以:
//   1. 每戶的建號超過 2 個就只顯示前 2 個 + 「共N筆」,完整清單放 title 提示裡。
//   2. 戶數超過 1 戶就整體收合成「共N戶 ▾」,預設只看第一戶,點開才看全部。
function encumbrancePropertyAddressCellHtml(enc) {
  if (!enc.property_address) return "-";
  const addrMap = new Map(); // label -> { shared, buildingNumbers: Set }
  enc.property_address.split("、").forEach((raw) => {
    const [addrPart, buildingNumber] = raw.split("::");
    const label = _shortDoorAddr(addrPart);
    if (!label) return;
    const shared = /房屋地下/.test(addrPart);
    if (!addrMap.has(label)) addrMap.set(label, { shared, buildingNumbers: new Set() });
    if (buildingNumber) addrMap.get(label).buildingNumbers.add(buildingNumber);
  });
  const entries = [...addrMap.entries()];
  if (!entries.length) return escapeHtml(enc.property_address);

  const badgeHtml = ([a, info]) => {
    const bns = [...info.buildingNumbers];
    const bnText = bns.length ? `(建號${bns.slice(0, 2).join("、")}${bns.length > 2 ? `等${bns.length}筆` : ""})` : "";
    const titleAttr = bns.length > 2 ? ` title="建號:${escapeHtml(bns.join("、"))}"` : "";
    const label = `${escapeHtml(a)}${escapeHtml(bnText)}`;
    return info.shared
      ? `<span class="mini-badge mini-badge-shared-door"${titleAttr || ' title="依持分比例登記的地下室/車位建號,非專屬住家門牌"'}>${label}(地下持分)</span>`
      : `<span class="mini-badge"${titleAttr}>${label}</span>`;
  };
  const badgesWrap = (list) => `<div style="display:flex;flex-wrap:wrap;gap:4px">${list.map(badgeHtml).join("")}</div>`;

  if (entries.length === 1) return badgesWrap(entries);
  return `
    <div class="enc-obligor-cell">
      ${badgesWrap([entries[0]])}
      <button type="button" class="enc-obligor-toggle" data-obligor-toggle>共${entries.length}戶 ▾</button>
      <div class="enc-obligor-dd-list hidden">${badgesWrap(entries)}</div>
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
    <td>${escapeHtml(enc.right_type) || "-"}</td>
    <td>${escapeHtml(enc.right_holder) || "-"}</td>
    <td>${encumbranceObligorsCellHtml(enc)}</td>
    <td style="text-align:right;white-space:nowrap">${formatSecuredAmount(enc.secured_amount) || "-"}</td>
    ${isEditor()
      ? `<td class="actions-cell">
            <button class="btn-secondary btn-sm" data-edit-encumbrance="${enc.id}">編輯</button>
            <button class="btn-danger btn-sm" data-delete-encumbrance="${enc.id}">刪除</button>
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

function encumbranceKindOf(enc) {
  return enc.parcel_kind === "building" ? "building" : "land";
}

async function renderEncumbrancesTab(el) {
  const pid = state.currentProjectId;
  const encumbrances = await api(`/projects/${pid}/encumbrances`);
  state.projectCache[pid].encumbrances = encumbrances;
  const landCount = encumbrances.filter((e) => encumbranceKindOf(e) === "land").length;
  const buildingCount = encumbrances.length - landCount;

  function currentList() {
    return encumbrances.filter((e) => encumbranceKindOf(e) === encActiveKind);
  }

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>他項權利部 (${encumbrances.length})</h3>
      <input type="search" id="encumbrance-search" class="search-input-pill" style="max-width:260px" placeholder="搜尋地號/門牌/權利種類/權利人...">
      ${isEditor() ? `<button class="btn-primary btn-sm" id="add-encumbrance-btn">+ 新增他項權利</button>` : ""}
    </div>
    <div class="enc-kind-toggle" id="enc-kind-tabs">
      <button type="button" class="enc-kind-btn ${encActiveKind === "land" ? "active" : ""}" data-enc-kind="land">土地 (${landCount})</button>
      <button type="button" class="enc-kind-btn ${encActiveKind === "building" ? "active" : ""}" data-enc-kind="building">建物 (${buildingCount})</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>登記次序</th><th>${encActiveKind === "building" ? "建號" : "地號"}</th><th>門牌地址</th><th>權利種類</th><th>他項權利人</th><th>債權額比例</th><th style="text-align:right">擔保債權總金額</th>
          ${isEditor() ? "<th>操作</th>" : ""}
        </tr></thead>
        <tbody id="encumbrance-tbody">${renderEncumbranceTbody(currentList())}</tbody>
      </table>
    </div>
  `;

  function renderEncumbranceTbody(list) {
    return list.length
      ? list.map(encumbranceRowHtml).join("")
      : `<tr><td colspan="${isEditor() ? 8 : 7}" class="empty-state" style="border:none">${encActiveKind === "land" ? "尚無土地他項權利資料" : "尚無建物他項權利資料"}</td></tr>`;
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
  wireRowButtons();

  el.querySelectorAll("[data-enc-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      encActiveKind = btn.dataset.encKind;
      renderTab("encumbrances");
    });
  });

  const searchInput = document.getElementById("encumbrance-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = currentList().filter((enc) => encumbranceMatchesQuery(enc, q));
      const tbody = document.getElementById("encumbrance-tbody");
      if (tbody) {
        tbody.innerHTML = renderEncumbranceTbody(filtered);
        wireRowButtons();
      }
    });
  }

  const addBtn = document.getElementById("add-encumbrance-btn");
  if (addBtn) addBtn.addEventListener("click", () => openEncumbranceFormModal(null, encActiveKind));
}

function obligorRowHtml(o) {
  o = o || { name: "", numerator: "", denominator: "" };
  return `
    <div class="field-row obligor-row" style="align-items:center">
      <div class="field" style="flex:1 1 160px;margin-bottom:0"><input class="obligor-name" placeholder="義務人姓名" value="${escapeHtml(o.name || "")}" autocomplete="off"></div>
      <div class="field" style="flex:0 0 70px;margin-bottom:0"><input class="obligor-num" type="number" placeholder="分子" value="${escapeHtml(o.numerator || "")}" autocomplete="off"></div>
      <span style="color:var(--text-muted)">/</span>
      <div class="field" style="flex:0 0 70px;margin-bottom:0"><input class="obligor-den" type="number" placeholder="分母" value="${escapeHtml(o.denominator || "")}" autocomplete="off"></div>
      <button type="button" class="btn-danger btn-sm obligor-remove-btn" title="刪除這位義務人">✕</button>
    </div>`;
}

function wireObligorRows(wrap) {
  wrap.querySelectorAll(".obligor-remove-btn").forEach((btn) => {
    btn.onclick = () => {
      const rows = wrap.querySelectorAll(".obligor-row");
      if (rows.length <= 1) {
        btn.closest(".obligor-row").querySelectorAll("input").forEach((inp) => (inp.value = ""));
        return;
      }
      btn.closest(".obligor-row").remove();
    };
  });
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
    obligors: [],
    secured_amount: null,
  };
  const obligors = e.obligors && e.obligors.length ? e.obligors : [{ name: "", numerator: "", denominator: "" }];
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
        <div class="field"><label>對應地號/建號</label><input name="applies_to_parcels" value="${escapeHtml(e.applies_to_parcels)}" autocomplete="off"></div>
      </div>
      <div class="field"><label>門牌地址</label><input name="property_address" value="${escapeHtml(e.property_address)}" autocomplete="off"></div>
      <div class="field-row">
        <div class="field">
          <label>權利種類</label>
          <select name="right_type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
        </div>
        <div class="field"><label>他項權利人</label><input name="right_holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
      </div>
      <div class="field">
        <label>義務人(可填多位,各自標債權額比例)</label>
        <div id="obligor-rows">${obligors.map(obligorRowHtml).join("")}</div>
        <button type="button" class="btn-secondary btn-sm" id="obligor-add-btn" style="margin-top:6px">+ 新增義務人</button>
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

  const rowsWrap = document.getElementById("obligor-rows");
  wireObligorRows(rowsWrap);
  document.getElementById("obligor-add-btn").addEventListener("click", () => {
    rowsWrap.insertAdjacentHTML("beforeend", obligorRowHtml(null));
    wireObligorRows(rowsWrap);
  });

  document.getElementById("encumbrance-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const obligorPayload = [...rowsWrap.querySelectorAll(".obligor-row")]
      .map((row) => ({
        name: row.querySelector(".obligor-name").value.trim(),
        numerator: row.querySelector(".obligor-num").value.trim() || null,
        denominator: row.querySelector(".obligor-den").value.trim() || null,
      }))
      .filter((o) => o.name);
    const payload = {
      registration_order: (fd.get("registration_order") || "").trim() || null,
      applies_to_parcels: (fd.get("applies_to_parcels") || "").trim() || null,
      parcel_kind: (fd.get("parcel_kind") || "").trim() || null,
      property_address: (fd.get("property_address") || "").trim() || null,
      right_type: (fd.get("right_type") || "").trim() || null,
      right_holder: (fd.get("right_holder") || "").trim() || null,
      obligors: obligorPayload,
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
