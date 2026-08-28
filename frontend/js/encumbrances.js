"use strict";

async function renderEncumbrancesTab(el) {
  const pid = state.currentProjectId;
  const encumbrances = await api(`/projects/${pid}/encumbrances`);
  state.projectCache[pid].encumbrances = encumbrances;

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>他項權利部 (${encumbrances.length})</h3>
      ${isEditor() ? `<button class="btn-primary btn-sm" id="add-encumbrance-btn">+ 新增他項權利</button>` : ""}
    </div>
    ${encumbrances.length
      ? `<div class="table-wrap">
            <table>
              <thead><tr>
                <th>登記次序</th><th>對應地號/建號</th><th>權利種類</th><th>他項權利人</th><th>債務額比例</th>
                ${isEditor() ? "<th>操作</th>" : ""}
              </tr></thead>
              <tbody>
                ${encumbrances
        .map(
          (enc) => `<tr>
                      <td>${escapeHtml(enc.registration_order) || "-"}</td>
                      <td>${escapeHtml(enc.applies_to_parcels) || "-"}</td>
                      <td>${escapeHtml(enc.right_type) || "-"}</td>
                      <td>${escapeHtml(enc.right_holder) || "-"}</td>
                      <td>${escapeHtml(enc.debtor_info) || "-"}</td>
                      ${isEditor()
              ? `<td class="actions-cell">
                              <button class="btn-secondary btn-sm" data-edit-encumbrance="${enc.id}">編輯</button>
                              <button class="btn-danger btn-sm" data-delete-encumbrance="${enc.id}">刪除</button>
                            </td>`
              : ""
            }
                    </tr>`
        )
        .join("")}
              </tbody>
            </table>
          </div>`
      : `<div class="empty-state">尚無他項權利資料</div>`
    }
  `;

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
  const addBtn = document.getElementById("add-encumbrance-btn");
  if (addBtn) addBtn.addEventListener("click", () => openEncumbranceFormModal(null));
}

function openEncumbranceFormModal(encumbrance) {
  const isEdit = !!encumbrance;
  const e = encumbrance || { registration_order: "", applies_to_parcels: "", right_type: "", right_holder: "", debtor_info: "" };
  const ratio = parseDebtorRatio(e.debtor_info);
  openModal(
    isEdit ? "編輯他項權利" : "新增他項權利",
    `
    <form id="encumbrance-form">
      <div class="field-row">
        <div class="field"><label>登記次序</label><input name="registration_order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
        <div class="field"><label>對應地號/建號</label><input name="applies_to_parcels" value="${escapeHtml(e.applies_to_parcels)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>權利種類</label>
          <select name="right_type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
        </div>
        <div class="field"><label>他項權利人</label><input name="right_holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
      </div>
      <div class="field">
        <label>債務額比例</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input name="debtor_num" type="number" value="${escapeHtml(ratio.numerator)}" placeholder="分子" style="width:90px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input name="debtor_den" type="number" value="${escapeHtml(ratio.denominator)}" placeholder="分母" style="width:90px" autocomplete="off">
        </div>
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
    const numerator = (fd.get("debtor_num") || "").trim();
    const denominator = (fd.get("debtor_den") || "").trim();
    const payload = {
      registration_order: (fd.get("registration_order") || "").trim() || null,
      applies_to_parcels: (fd.get("applies_to_parcels") || "").trim() || null,
      right_type: (fd.get("right_type") || "").trim() || null,
      right_holder: (fd.get("right_holder") || "").trim() || null,
      debtor_info: numerator && denominator ? `${denominator}分之${numerator}` : null,
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
