"use strict";

async function renderContactsTab(el) {
  const pid = state.currentProjectId;
  const [landowners, summary] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/contact-summary`),
  ]);
  const summaryByOwner = new Map(summary.map((s) => [s.landowner_id, s]));
  state.projectCache[pid].landowners = landowners;

  // Contacting someone is about following up on their consent as an actual owner -
  // exclude Landowner rows that only exist as an encumbrance's right_holder (a bank on
  // a mortgage, etc.), same as the alerts list above.
  const contactableLandowners = landowners.filter((o) => o.land_records.length || o.building_records.length);

  if (!contactableLandowners.length) {
    el.innerHTML = `<div class="empty-state">請先建立地主資料</div>`;
    return;
  }

  const selectedId = state.selectedContactLandownerId && contactableLandowners.some((o) => o.id === state.selectedContactLandownerId)
    ? state.selectedContactLandownerId
    : contactableLandowners[0].id;
  state.selectedContactLandownerId = selectedId;

  const overdueCount = contactableLandowners.filter((o) => summaryByOwner.get(o.id)?.is_overdue).length;
  const daysSince = (iso) => {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  };

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
      <h3 style="margin-top:0">地主聯繫狀態 (${contactableLandowners.length}) · 需跟進 ${overdueCount}</h3>
      <div class="table-wrap" style="box-shadow:none;border:none">
        <table>
          <thead><tr><th>編號</th><th>姓名</th><th>聯絡狀態</th><th>最後聯絡</th><th>未聯絡天數</th><th>聯絡紀錄</th></tr></thead>
          <tbody>
            ${contactableLandowners
        .map((o, i) => {
          const s = summaryByOwner.get(o.id);
          const d = daysSince(s && s.last_contact_date);
          return `<tr${s && s.is_overdue ? ' style="background:var(--danger-light)"' : ""}>
                        <td>${String(i + 1).padStart(3, "0")}</td>
                        <td>${escapeHtml(o.name)}</td>
                        <td>${s && s.is_overdue
              ? `<span class="contact-overdue-flag">⚠ 提醒</span>`
              : `<span class="contact-status-badge cs-${o.contact_status}">${CONTACT_STATUS_LABEL[o.contact_status]}</span>`}</td>
                        <td>${s && s.last_contact_date ? fmtDateTime(s.last_contact_date) : "尚無紀錄"}</td>
                        <td>${d ?? "-"}</td>
                        <td><button class="btn-link btn-sm" data-contact-log="${o.id}">查看</button></td>
                      </tr>`;
        })
        .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-contact-log]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.contactLog);
      const owner = contactableLandowners.find((o) => o.id === id);
      openContactLogModal(id, owner ? owner.name : "");
    });
  });
}

async function openContactLogModal(landownerId, name) {
  openModal(`聯絡紀錄 · ${escapeHtml(name || "")}`, `<div id="contact-log-list"><div class="empty-state">載入中...</div></div>`, { width: "560px" });
  await loadContactLogList(landownerId, name);
}

async function loadContactLogList(landownerId, name) {
  const pid = state.currentProjectId;
  const lid = landownerId != null ? landownerId : state.selectedContactLandownerId;
  const listEl = document.getElementById("contact-log-list");
  if (!listEl) return;
  listEl.innerHTML = `<div class="empty-state">載入中...</div>`;
  const logs = await api(`/projects/${pid}/landowners/${lid}/contacts`);
  listEl.innerHTML = logs.length
    ? `<div class="clm-list">
        ${logs
      .map((c) => {
        const rk = c.contact_result === "agreed" ? "agreed" : c.contact_result === "opposed" ? "opposed" : "pending";
        return `<div class="clm-item">
              <div class="clm-item-head">
                <span class="clm-date">${fmtDateTime(c.contact_date)}</span>
                <span class="clm-method">${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</span>
                <span class="consent-status-badge cs-${rk}">${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span>
              </div>
              ${c.notes ? `<div class="clm-row"><span class="clm-label">備註</span><span>${escapeHtml(c.notes)}</span></div>` : ""}
              ${c.next_follow_up_date ? `<div class="clm-row"><span class="clm-label">下次跟進</span><span>${fmtDate(c.next_follow_up_date)}</span></div>` : ""}
            </div>`;
      })
      .join("")}
      </div>`
    : `<div class="empty-state">尚無聯絡紀錄</div>`;
}

function openAddContactModal(landownerId, afterSave) {
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
      if (typeof afterSave === "function") {
        afterSave();
      } else {
        renderTab("contacts");
        if (typeof syncProjectAggregates === "function") syncProjectAggregates();
      }
    } catch (err) { }
  });
}
