"use strict";

async function renderContactsTab(el) {
  const pid = state.currentProjectId;
  const [landowners, alerts] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/alerts`),
  ]);
  state.projectCache[pid].landowners = landowners;

  if (!landowners.length) {
    el.innerHTML = `<div class="empty-state">請先建立地主資料</div>`;
    return;
  }

  const selectedId = state.selectedContactLandownerId && landowners.some((o) => o.id === state.selectedContactLandownerId)
    ? state.selectedContactLandownerId
    : landowners[0].id;
  state.selectedContactLandownerId = selectedId;

  el.innerHTML = `
    ${alerts.length
      ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
            <h3 style="margin-top:0">⚠ 需跟進地主 (${alerts.length})</h3>
            <div class="table-wrap" style="box-shadow:none;border:none">
              <table>
                <thead><tr><th>姓名</th><th>聯絡狀態</th><th>最後聯絡</th><th>未聯絡天數</th></tr></thead>
                <tbody>
                  ${alerts
        .map(
          (a) => `<tr>
                        <td>${escapeHtml(a.landowner_name)}</td>
                        <td><span class="contact-status-badge cs-${a.contact_status}">${CONTACT_STATUS_LABEL[a.contact_status]}</span></td>
                        <td>${a.last_contact_date ? fmtDateTime(a.last_contact_date) : "尚無紀錄"}</td>
                        <td>${a.days_since_last_contact ?? "-"}</td>
                      </tr>`
        )
        .join("")}
                </tbody>
              </table>
            </div>
          </div>`
      : ""
    }
    <div class="section-toolbar">
      <h3>聯絡紀錄</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <select id="contact-landowner-select" style="width:auto">
          ${landowners.map((o) => `<option value="${o.id}" ${o.id === selectedId ? "selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-contact-btn">+ 新增紀錄</button>` : ""}
      </div>
    </div>
    <div id="contact-log-list"></div>
  `;

  document.getElementById("contact-landowner-select").addEventListener("change", (e) => {
    state.selectedContactLandownerId = Number(e.target.value);
    loadContactLogList();
  });
  const addBtn = document.getElementById("add-contact-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddContactModal(state.selectedContactLandownerId));

  await loadContactLogList();
}

async function loadContactLogList() {
  const pid = state.currentProjectId;
  const lid = state.selectedContactLandownerId;
  const listEl = document.getElementById("contact-log-list");
  if (!listEl) return;
  listEl.innerHTML = `<div class="empty-state">載入中...</div>`;
  const logs = await api(`/projects/${pid}/landowners/${lid}/contacts`);
  if (!logs.length) {
    listEl.innerHTML = `<div class="empty-state">尚無聯絡紀錄</div>`;
    return;
  }
  listEl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>日期</th><th>方式</th><th>結果</th><th>備註</th><th>下次跟進</th></tr></thead>
        <tbody>
          ${logs
      .map(
        (c) => `<tr>
                <td>${fmtDateTime(c.contact_date)}</td>
                <td>${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</td>
                <td><span class="consent-status-badge cs-${c.contact_result === "agreed" ? "agreed" : c.contact_result === "opposed" ? "opposed" : "pending"}">${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span></td>
                <td>${escapeHtml(c.notes) || "-"}</td>
                <td>${fmtDate(c.next_follow_up_date)}</td>
              </tr>`
      )
      .join("")}
        </tbody>
      </table>
    </div>`;
}

function openAddContactModal(landownerId) {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(
    "新增聯絡紀錄",
    `
    <form id="contact-form">
      <div class="field-row">
        <div class="field"><label>聯絡時間</label><input type="datetime-local" name="contact_date" value="${localIso}" required></div>
        <div class="field"><label>聯絡方式</label>
          <select name="contact_method">
            ${Object.entries(CONTACT_METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>聯絡結果</label>
        <select name="contact_result">
          ${Object.entries(CONTACT_RESULT_LABEL).map(([k, v]) => `<option value="${k}" ${k === "undecided" ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>備註</label><textarea name="notes" rows="2"></textarea></div>
      </div>
      <div class="field"><label>下次跟進日期(選填)</label><input type="date" name="next_follow_up_date"></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      landowner_id: landownerId,
      contact_date: new Date(data.contact_date).toISOString(),
      contact_method: data.contact_method,
      contact_result: data.contact_result,
      notes: data.notes || null,
      next_follow_up_date: data.next_follow_up_date || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, { method: "POST", body: payload });
      closeModal();
      toast("聯絡紀錄已新增", "success");
      renderTab("contacts");
    } catch (err) { }
  });
}
