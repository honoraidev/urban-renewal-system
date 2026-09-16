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

function encumbranceRowHtml(enc) {
  return `<tr>
    <td>${escapeHtml(enc.registration_order) || "-"}</td>
    <td>${encumbranceParcelsCellHtml(enc)}</td>
    <td>${escapeHtml(enc.property_address) || "-"}</td>
    <td>${escapeHtml(enc.right_type) || "-"}</td>
    <td>${escapeHtml(enc.right_holder) || "-"}</td>
    <td>${escapeHtml(encumbranceObligorsSummary(enc)) || "-"}</td>
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
    <div class="tab-bar" id="enc-kind-tabs" style="margin-bottom:14px">
      <button type="button" class="tab-btn ${encActiveKind === "land" ? "active" : ""}" data-enc-kind="land">地號 (${landCount})</button>
      <button type="button" class="tab-btn ${encActiveKind === "building" ? "active" : ""}" data-enc-kind="building">建號 (${buildingCount})</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>登記次序</th><th>對應地號/建號</th><th>門牌地址</th><th>權利種類</th><th>他項權利人</th><th>義務人(債務額比例)</th><th style="text-align:right">擔保債權總金額</th>
          ${isEditor() ? "<th>操作</th>" : ""}
        </tr></thead>
        <tbody id="encumbrance-tbody">${renderEncumbranceTbody(currentList())}</tbody>
      </table>
    </div>
  `;

  function renderEncumbranceTbody(list) {
    return list.length
      ? list.map(encumbranceRowHtml).join("")
      : `<tr><td colspan="${isEditor() ? 8 : 7}" class="empty-state" style="border:none">${encActiveKind === "land" ? "尚無地號他項權利資料" : "尚無建號他項權利資料"}</td></tr>`;
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
            <option value="land" ${e.parcel_kind === "land" ? "selected" : ""}>地號</option>
            <option value="building" ${e.parcel_kind === "building" ? "selected" : ""}>建號</option>
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
        <label>義務人(可填多位,各自標債務額比例)</label>
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
