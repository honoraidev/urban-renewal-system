"use strict";

// 建物登記分頁把「地主」顯示成「屋主」比較符合語感 - 地主/屋主背後是同一張 landowners
// 資料表,只是名稱用哪個字依目前分頁而定,所以用一個模組層級變數記住目前該用哪個字,而不是
// 把 isLand 一路傳進每個共用的 modal 函式。
let currentLandownerLabel = "地主";

async function renderLandownersTypeTab(el, type) {
  const pid = state.currentProjectId;
  const isLand = type === "land";
  currentLandownerLabel = isLand ? "地主" : "屋主";
  const [allLandowners, documents, alerts, contactSummary] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/documents`),
    api(`/projects/${pid}/alerts`),
    api(`/projects/${pid}/contact-summary`),
  ]);
  state.projectCache[pid].landowners = allLandowners;
  const contactByOwner = new Map(contactSummary.map((c) => [c.landowner_id, c]));

  const landowners = allLandowners.filter((o) => (isLand ? o.land_records : o.building_records).length > 0);
  const landownerIds = new Set(landowners.map((o) => o.id));

  const signedIds = new Set(
    documents.filter((d) => d.doc_type === "contract" && landownerIds.has(d.landowner_id)).map((d) => d.landowner_id)
  );
  const willingIds = new Set(
    documents.filter((d) => d.doc_type === "willingness_form_template" && landownerIds.has(d.landowner_id)).map((d) => d.landowner_id)
  );
  const alertIds = new Set(alerts.filter((a) => landownerIds.has(a.landowner_id)).map((a) => a.landowner_id));

  el.innerHTML = `
    <div class="dashboard-stat-row" style="margin-bottom:20px">
      <div class="dashboard-stat-item accent-brand" data-stat-filter="all" role="button" tabindex="0">
        <div class="dashboard-stat-icon">👥</div>
        <div><div class="dashboard-stat-num">${landowners.length}</div><div class="dashboard-stat-lbl">總${currentLandownerLabel}人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-success" data-stat-filter="signed" role="button" tabindex="0">
        <div class="dashboard-stat-icon">✅</div>
        <div><div class="dashboard-stat-num">${signedIds.size}</div><div class="dashboard-stat-lbl">已簽約人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-info" data-stat-filter="willing" role="button" tabindex="0">
        <div class="dashboard-stat-icon">📋</div>
        <div><div class="dashboard-stat-num">${willingIds.size}</div><div class="dashboard-stat-lbl">已意願書人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-danger" data-stat-filter="alert" role="button" tabindex="0">
        <div class="dashboard-stat-icon">🔔</div>
        <div><div class="dashboard-stat-num">${alertIds.size}</div><div class="dashboard-stat-lbl">待聯繫提醒</div></div>
      </div>
    </div>
    <div class="section-toolbar">
      <h3>${isLand ? "土地登記清冊" : "建物登記清冊"} (${landowners.length})</h3>
      ${isEditor() || canOcr()
      ? `<div style="display:flex;gap:8px">
              ${canOcr() ? `<button class="btn-secondary btn-sm" id="scan-title-deed-btn">${isLand ? "土地登記匯入" : "建物登記匯入"}</button>` : ""}
              ${isEditor() ? `<button class="btn-primary btn-sm" id="add-landowner-btn">+ 新增${currentLandownerLabel}</button>` : ""}
            </div>`
      : ""
    }
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>編號</th><th>姓名</th><th>門牌地址</th><th>${isLand ? "土地" : "建物"}持分</th>
          <th>意願狀態</th><th>聯繫狀態</th><th>最近聯繫</th>
          ${isEditor() ? "<th>操作</th>" : ""}
        </tr></thead>
        <tbody>
          ${landowners
      .map((o) => {
        const records = isLand ? o.land_records : o.building_records;
        const shareLabel = records.length
          ? `${records[0].ownership_numerator}/${records[0].ownership_denominator}${records.length > 1 ? ` 等${records.length}筆` : ""}`
          : "-";
        const contact = contactByOwner.get(o.id);
        return `
            <tr data-row-owner="${o.id}">
              <td>${escapeHtml(o.roster_code) || "-"}</td>
              <td>${escapeHtml(o.name)}</td>
              <td>${escapeHtml(o.address) || "-"}</td>
              <td>${shareLabel}
                <div><button class="btn-link btn-sm" data-detail="${o.id}">查看明細</button></div>
              </td>
              <td><span class="agreement-status-badge as-${o.agreement_status}">${AGREEMENT_STATUS_LABEL[o.agreement_status]}</span></td>
              <td>${contact && contact.is_overdue
            ? `<span class="contact-overdue-flag">⚠ 提醒</span>`
            : `<span class="contact-status-badge cs-${o.contact_status}">${CONTACT_STATUS_LABEL[o.contact_status]}</span>`
          }</td>
              <td>${contact && contact.last_contact_date ? fmtDate(contact.last_contact_date) : "-"}</td>
              ${isEditor()
            ? `<td class="actions-cell">
                      <button class="btn-secondary btn-sm" data-edit="${o.id}">編輯</button>
                      <button class="btn-danger btn-sm" data-delete="${o.id}">刪除</button>
                    </td>`
            : ""
          }
            </tr>
            <tr class="detail-row hidden" id="detail-row-${o.id}"><td colspan="10">
              <div class="sub-detail">
                <div class="section-toolbar" style="margin-bottom:8px">
                  <strong>土地資料</strong>
                  ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-land="${o.id}">+ 新增土地</button>` : ""}
                </div>
                ${o.land_records.length
            ? `<table>
                        <thead><tr><th>地號</th><th>地段</th><th>面積</th><th>持分</th><th>持有面積</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.land_records
              .map(
                (lr) => `<tr>
                                <td>${escapeHtml(lr.parcel_number)}</td>
                                <td>${escapeHtml(lr.section) || "-"}</td>
                                <td>${lr.total_area_sqm}m²</td>
                                <td>${lr.ownership_numerator}/${lr.ownership_denominator}</td>
                                <td>${lr.owned_area_sqm ?? "-"}m² (${lr.ownership_share_pct ?? "-"}%)</td>
                                ${isEditor()
                    ? `<td class="actions-cell">
                                        <button class="btn-secondary btn-sm" data-edit-land="${lr.id}" data-owner="${o.id}">編輯</button>
                                        <button class="btn-danger btn-sm" data-delete-land="${lr.id}" data-owner="${o.id}">刪除</button>
                                      </td>`
                    : ""
                  }
                              </tr>`
              )
              .join("")}
                        </tbody>
                      </table>`
            : `<div class="helper-text">尚無土地資料</div>`
          }
                <div class="section-toolbar" style="margin:16px 0 8px">
                  <strong>建物資料</strong>
                  ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-building="${o.id}">+ 新增建物</button>` : ""}
                </div>
                ${o.building_records.length
            ? `<table>
                        <thead><tr><th>建號</th><th>座落地號</th><th>樓層</th><th>面積</th><th>持分</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.building_records
              .map(
                (br) => `<tr>
                                <td>${escapeHtml(br.building_number) || "-"}</td>
                                <td>${escapeHtml((o.land_records.find((lr) => lr.id === br.land_record_id) || {}).parcel_number) || "-"}</td>
                                <td>${escapeHtml(br.floor) || "-"}</td>
                                <td>${br.total_area_sqm}m²</td>
                                <td>${br.ownership_numerator}/${br.ownership_denominator} (${br.ownership_share_pct}%)</td>
                                ${isEditor()
                    ? `<td class="actions-cell">
                                        <button class="btn-secondary btn-sm" data-edit-building="${br.id}" data-owner="${o.id}">編輯</button>
                                        <button class="btn-danger btn-sm" data-delete-building="${br.id}" data-owner="${o.id}">刪除</button>
                                      </td>`
                    : ""
                  }
                              </tr>`
              )
              .join("")}
                        </tbody>
                      </table>`
            : `<div class="helper-text">尚無建物資料</div>`
          }
              </div>
            </td></tr>
          `;
      })
      .join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!landowners.length) {
    el.querySelector(".table-wrap").outerHTML = `<div class="empty-state">${isLand ? "尚無土地登記資料" : "尚無建物登記資料"}</div>`;
  }

  {
    const statFilterSets = { signed: signedIds, willing: willingIds, alert: alertIds };
    const statCards = el.querySelectorAll("[data-stat-filter]");
    const applyStatFilter = (filter) => {
      statCards.forEach((card) => card.classList.toggle("active", card.dataset.statFilter === filter));
      const matchSet = filter === "all" ? null : statFilterSets[filter];
      el.querySelectorAll("[data-row-owner]").forEach((row) => {
        const ownerId = Number(row.dataset.rowOwner);
        const visible = !matchSet || matchSet.has(ownerId);
        row.classList.toggle("hidden", !visible);
        if (!visible) {
          const detailRow = document.getElementById(`detail-row-${ownerId}`);
          if (detailRow) detailRow.classList.add("hidden");
        }
      });
    };
    statCards.forEach((card) => {
      card.addEventListener("click", () => applyStatFilter(card.dataset.statFilter));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          applyStatFilter(card.dataset.statFilter);
        }
      });
    });
  }

  el.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`detail-row-${btn.dataset.detail}`).classList.toggle("hidden");
    });
  });
  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditLandownerModal(Number(btn.dataset.edit)));
  });
  el.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLandowner(Number(btn.dataset.delete)));
  });
  const addBtn = document.getElementById("add-landowner-btn");
  if (addBtn) addBtn.addEventListener("click", openAddLandownerModal);
  const scanBtn = document.getElementById("scan-title-deed-btn");
  if (scanBtn) scanBtn.addEventListener("click", isLand ? openTitleDeedWizard : openBuildingTitleDeedWizard);

  el.querySelectorAll("[data-add-land]").forEach((btn) => {
    btn.addEventListener("click", () => openAddLandRecordModal(Number(btn.dataset.addLand)));
  });
  el.querySelectorAll("[data-add-building]").forEach((btn) => {
    btn.addEventListener("click", () => openAddBuildingRecordModal(Number(btn.dataset.addBuilding)));
  });
  el.querySelectorAll("[data-edit-land]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const owner = landowners.find((o) => o.id === Number(btn.dataset.owner));
      const record = owner?.land_records.find((r) => r.id === Number(btn.dataset.editLand));
      if (record) openEditLandRecordModal(owner.id, record);
    });
  });
  el.querySelectorAll("[data-delete-land]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLandRecord(Number(btn.dataset.owner), Number(btn.dataset.deleteLand)));
  });
  el.querySelectorAll("[data-edit-building]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const owner = landowners.find((o) => o.id === Number(btn.dataset.owner));
      const record = owner?.building_records.find((r) => r.id === Number(btn.dataset.editBuilding));
      if (record) openEditBuildingRecordModal(owner.id, record);
    });
  });
  el.querySelectorAll("[data-delete-building]").forEach((btn) => {
    btn.addEventListener("click", () =>
      deleteBuildingRecord(Number(btn.dataset.owner), Number(btn.dataset.deleteBuilding))
    );
  });
}

function landRecordRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>地號</label><input class="lr-parcel"></div>
      <div class="field"><label>地段</label><input class="lr-section"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>總面積(m²)</label><input class="lr-area" type="number" step="0.01"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input class="lr-num" type="number" placeholder="分子" value="1">
          <input class="lr-den" type="number" placeholder="分母" value="1">
        </div>
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-row-btn">刪除此筆</button>`;
}

function buildingRecordRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>建號</label><input class="br-number"></div>
      <div class="field"><label>樓層</label><input class="br-floor"></div>
    </div>
    <div class="field"><label>建物地址</label><input class="br-address"></div>
    <div class="field-row">
      <div class="field"><label>主建物面積(m²)</label><input class="br-structure" type="number" step="0.01" value="0"></div>
      <div class="field"><label>附屬建物面積(m²)</label><input class="br-auxiliary" type="number" step="0.01" value="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>共有部分面積(m²)</label><input class="br-common" type="number" step="0.01" value="0"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input class="br-num" type="number" placeholder="分子" value="1">
          <input class="br-den" type="number" placeholder="分母" value="1">
        </div>
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-row-btn">刪除此筆</button>`;
}

function addLandRecordRow(container, prefill = {}) {
  const row = document.createElement("div");
  row.className = "record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px";
  row.innerHTML = landRecordRowHtml();
  if (prefill.parcel_number) row.querySelector(".lr-parcel").value = prefill.parcel_number;
  if (prefill.section) row.querySelector(".lr-section").value = prefill.section;
  if (prefill.total_area_sqm) row.querySelector(".lr-area").value = prefill.total_area_sqm;
  if (prefill.ownership_numerator) row.querySelector(".lr-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".lr-den").value = prefill.ownership_denominator;
  row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function addBuildingRecordRow(container, prefill = {}) {
  const row = document.createElement("div");
  row.className = "record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px";
  row.innerHTML = buildingRecordRowHtml();
  if (prefill.building_number) row.querySelector(".br-number").value = prefill.building_number;
  if (prefill.floor) row.querySelector(".br-floor").value = prefill.floor;
  if (prefill.address) row.querySelector(".br-address").value = prefill.address;
  if (prefill.structure_area_sqm) row.querySelector(".br-structure").value = prefill.structure_area_sqm;
  if (prefill.auxiliary_area_sqm) row.querySelector(".br-auxiliary").value = prefill.auxiliary_area_sqm;
  if (prefill.common_area_sqm) row.querySelector(".br-common").value = prefill.common_area_sqm;
  if (prefill.ownership_numerator) row.querySelector(".br-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".br-den").value = prefill.ownership_denominator;
  row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function readLandRecordRows(container) {
  return [...container.querySelectorAll(".record-row")]
    .map((row) => ({
      parcel_number: row.querySelector(".lr-parcel").value.trim(),
      section: row.querySelector(".lr-section").value.trim() || null,
      total_area_sqm: Number(row.querySelector(".lr-area").value) || 0,
      ownership_numerator: Number(row.querySelector(".lr-num").value) || 1,
      ownership_denominator: Number(row.querySelector(".lr-den").value) || 1,
    }))
    .filter((r) => r.parcel_number);
}

function readBuildingRecordRows(container) {
  return [...container.querySelectorAll(".record-row")]
    .map((row) => ({
      building_number: row.querySelector(".br-number").value.trim() || null,
      floor: row.querySelector(".br-floor").value.trim() || null,
      address: row.querySelector(".br-address").value.trim() || null,
      structure_area_sqm: Number(row.querySelector(".br-structure").value) || 0,
      auxiliary_area_sqm: Number(row.querySelector(".br-auxiliary").value) || 0,
      common_area_sqm: Number(row.querySelector(".br-common").value) || 0,
      ownership_numerator: Number(row.querySelector(".br-num").value) || 1,
      ownership_denominator: Number(row.querySelector(".br-den").value) || 1,
    }))
    .filter((r) => r.building_number || r.address);
}

function openAddLandownerModal() {
  openModal(
    `新增${currentLandownerLabel}`,
    `
    <form id="landowner-form">
      <div class="field-row">
        <div class="field"><label>姓名</label><input name="name" required></div>
        <div class="field"><label>電話</label><input name="phone"></div>
      </div>
      <div class="field"><label>地址</label><input name="address"></div>
      <label><input type="checkbox" name="is_representative" style="width:auto;display:inline-block;margin-right:6px"> 為土地/建物代表人</label>
      <div class="field" style="margin-top:10px"><label>備註</label><textarea name="notes" rows="2"></textarea></div>
      <fieldset>
        <legend>土地資料(選填,可新增多筆)</legend>
        <div id="land-records-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-land-row-btn">+ 新增一筆土地</button>
      </fieldset>
      <fieldset>
        <legend>建物資料(選填,可新增多筆)</legend>
        <div id="building-records-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-building-row-btn">+ 新增一筆建物</button>
      </fieldset>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`
  );

  const landList = document.getElementById("land-records-list");
  const buildingList = document.getElementById("building-records-list");
  addLandRecordRow(landList);

  document.getElementById("add-land-row-btn").addEventListener("click", () => addLandRecordRow(landList));
  document.getElementById("add-building-row-btn").addEventListener("click", () => addBuildingRecordRow(buildingList));

  document.getElementById("landowner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      name: data.name,
      id_number: data.id_number || null,
      phone: data.phone || null,
      address: data.address || null,
      is_representative: fd.has("is_representative"),
      notes: data.notes || null,
      land_records: readLandRecordRows(landList),
      building_records: readBuildingRecordRows(buildingList),
    };
    try {
      await api(`/projects/${state.currentProjectId}/landowners`, { method: "POST", body: payload });
      closeModal();
      toast(`${currentLandownerLabel}已新增`, "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

function openEditLandownerModal(landownerId) {
  const owner = state.projectCache[state.currentProjectId].landowners.find((o) => o.id === landownerId);
  if (!owner) return;
  openModal(
    `編輯${currentLandownerLabel}`,
    `
    <form id="landowner-edit-form">
      <div class="field-row">
        <div class="field"><label>姓名</label><input name="name" value="${escapeHtml(owner.name)}" required></div>
        <div class="field"><label>電話</label><input name="phone" value="${escapeHtml(owner.phone) || ""}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>聯絡狀態</label>
          <select name="contact_status">
            ${Object.entries(CONTACT_STATUS_LABEL)
              .map(([k, v]) => `<option value="${k}" ${owner.contact_status === k ? "selected" : ""}>${v}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field"><label>地址</label><input name="address" value="${escapeHtml(owner.address) || ""}"></div>
      </div>
      <div class="field"><label>意願狀態</label>
        <select name="agreement_status">
          ${Object.entries(AGREEMENT_STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${owner.agreement_status === k ? "selected" : ""}>${v}</option>`)
      .join("")}
        </select>
      </div>
      <div class="field"><label>備註</label><textarea name="notes" rows="2">${escapeHtml(owner.notes) || ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("landowner-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: payload });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

async function deleteLandowner(id) {
  if (!confirm(`確定要刪除此${currentLandownerLabel}嗎?`)) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${id}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) { }
}

function landRecordFormFields(record) {
  const r = record || {};
  return `
    <div class="field-row">
      <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(r.parcel_number) || ""}" required></div>
      <div class="field"><label>地段</label><input name="section" value="${escapeHtml(r.section) || ""}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>總面積(m²)</label><input name="total_area_sqm" type="number" step="0.01" value="${r.total_area_sqm ?? 0}"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}">
          <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}">
        </div>
      </div>
    </div>`;
}

function readLandRecordForm(fd) {
  const data = Object.fromEntries(fd.entries());
  return {
    parcel_number: data.parcel_number,
    section: data.section || null,
    total_area_sqm: Number(data.total_area_sqm) || 0,
    ownership_numerator: Number(data.ownership_numerator) || 1,
    ownership_denominator: Number(data.ownership_denominator) || 1,
  };
}

function openAddLandRecordModal(landownerId) {
  openModal(
    "新增土地資料",
    `<form id="land-record-form">
      ${landRecordFormFields()}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("land-record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records`, {
        method: "POST",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("土地資料已新增", "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

function openEditLandRecordModal(landownerId, record) {
  openModal(
    "編輯土地資料",
    `<form id="land-record-edit-form">
      ${landRecordFormFields(record)}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("land-record-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${record.id}`, {
        method: "PATCH",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

async function deleteLandRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆土地資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) { }
}

function buildingRecordFormFields(record) {
  const r = record || {};
  return `
    <div class="field-row">
      <div class="field"><label>建號</label><input name="building_number" value="${escapeHtml(r.building_number) || ""}"></div>
      <div class="field"><label>樓層</label><input name="floor" value="${escapeHtml(r.floor) || ""}"></div>
    </div>
    <div class="field"><label>建物地址</label><input name="address" value="${escapeHtml(r.address) || ""}"></div>
    <div class="field-row">
      <div class="field"><label>主建物面積(m²)</label><input name="structure_area_sqm" type="number" step="0.01" value="${r.structure_area_sqm ?? 0}"></div>
      <div class="field"><label>附屬建物面積(m²)</label><input name="auxiliary_area_sqm" type="number" step="0.01" value="${r.auxiliary_area_sqm ?? 0}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>共有部分面積(m²)</label><input name="common_area_sqm" type="number" step="0.01" value="${r.common_area_sqm ?? 0}"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}">
          <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}">
        </div>
      </div>
    </div>`;
}

function readBuildingRecordForm(fd) {
  const data = Object.fromEntries(fd.entries());
  return {
    building_number: data.building_number || null,
    floor: data.floor || null,
    address: data.address || null,
    structure_area_sqm: Number(data.structure_area_sqm) || 0,
    auxiliary_area_sqm: Number(data.auxiliary_area_sqm) || 0,
    common_area_sqm: Number(data.common_area_sqm) || 0,
    ownership_numerator: Number(data.ownership_numerator) || 1,
    ownership_denominator: Number(data.ownership_denominator) || 1,
  };
}

function openAddBuildingRecordModal(landownerId) {
  openModal(
    "新增建物資料",
    `<form id="building-record-form">
      ${buildingRecordFormFields()}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("building-record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records`, {
        method: "POST",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("建物資料已新增", "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

function openEditBuildingRecordModal(landownerId, record) {
  openModal(
    "編輯建物資料",
    `<form id="building-record-edit-form">
      ${buildingRecordFormFields(record)}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("building-record-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${record.id}`, {
        method: "PATCH",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) { }
  });
}

async function deleteBuildingRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆建物資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) { }
}

function relationsShareSum(owners) {
  return owners.reduce((sum, ow) => sum + (Number(ow.numerator) || 0) / (Number(ow.denominator) || 1), 0);
}

async function renderRelationsTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  if (!landowners.length) {
    el.innerHTML = `<div class="empty-state">尚無資料</div>`;
    return;
  }
  const landMap = new Map();
  landowners.forEach((o) => {
    (o.land_records || []).forEach((lr) => {
      const key = `${lr.section || ""}_${lr.parcel_number}`;
      if (!landMap.has(key)) {
        landMap.set(key, { section: lr.section, parcel: lr.parcel_number, area: lr.total_area_sqm, owners: [] });
      }
      landMap.get(key).owners.push({
        name: o.name,
        numerator: lr.ownership_numerator,
        denominator: lr.ownership_denominator,
      });
    });
  });
  const items = Array.from(landMap.values()).sort((a, b) => (a.parcel || "").localeCompare(b.parcel || ""));

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>土地/地主對照關係表 (${items.length} 筆地號)</h3>
      <input type="search" id="relations-search" style="width:220px" placeholder="搜尋地號 / 地主姓名">
    </div>
    <div class="table-wrap">
      <table class="relations-table">
        <colgroup>
          <col style="width:110px"><col style="width:100px"><col style="width:100px"><col style="width:80px"><col>
        </colgroup>
        <thead><tr><th>地號</th><th>地段</th><th>面積</th><th>共有人</th><th>所有權人名單</th></tr></thead>
        <tbody id="relations-tbody">
          ${items.map(relationsRowHtml).join("")}
        </tbody>
      </table>
    </div>`;

  const searchInput = document.getElementById("relations-search");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) => item.parcel?.toLowerCase().includes(q) || item.owners.some((ow) => ow.name.toLowerCase().includes(q)))
      : items;
    document.getElementById("relations-tbody").innerHTML = filtered.length
      ? filtered.map(relationsRowHtml).join("")
      : `<tr><td colspan="5" class="empty-state" style="border:none">查無符合的地號或地主</td></tr>`;
  });
}

function relationsRowHtml(item) {
  const shareSum = relationsShareSum(item.owners);
  const shareOff = Math.abs(shareSum - 1) > 0.02;
  return `<tr>
    <td class="relations-parcel-cell">${escapeHtml(item.parcel)}</td>
    <td>${escapeHtml(item.section) || "-"}</td>
    <td>${Number(item.area).toLocaleString()} m²</td>
    <td><span class="mini-badge">${item.owners.length} 人</span></td>
    <td>
      <div class="wizard-confirm-chip-list">
        ${item.owners.map((ow) => `<span class="wizard-confirm-chip">${escapeHtml(ow.name)}<span class="relations-chip-share">${ow.numerator}/${ow.denominator}</span></span>`).join("")}
      </div>
      ${shareOff ? `<div class="relations-share-warning">⚠ 權利範圍加總為 ${(shareSum * 100).toFixed(1)}%,請核對</div>` : ""}
    </td>
  </tr>`;
}

