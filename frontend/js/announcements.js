"use strict";

// 系統公告:L0 系統管理員在工作看板發布(伺服器維修等),所有登入者在工作看板頂端看到有效公告。
const ANN_LEVEL = {
  info: { label: "一般公告", icon: "📢" },
  warning: { label: "注意", icon: "⚠️" },
  urgent: { label: "緊急", icon: "🚨" },
};

async function loadAnnouncementBanner() {
  const box = document.getElementById("mywork-ann");
  if (!box) return;
  let rows = [];
  try {
    rows = await api("/announcements", { silent: true });
  } catch (e) {
    return;
  }
  box.innerHTML = rows
    .map((a) => {
      const lv = ANN_LEVEL[a.level] || ANN_LEVEL.info;
      return `<div class="ann-banner ann-${escapeHtml(a.level)}">
        <span class="ann-ic">${lv.icon}</span>
        <div class="ann-main">
          <div class="ann-title">${escapeHtml(a.title)}</div>
          ${a.content ? `<div class="ann-content">${escapeHtml(a.content)}</div>` : ""}
          <div class="ann-meta">${escapeHtml(a.created_by_name || "系統管理員")}・${escapeHtml(fmtDateTime(a.created_at))}${a.expires_at ? `・顯示至 ${escapeHtml(fmtDateTime(a.expires_at))}` : ""}</div>
        </div>
      </div>`;
    })
    .join("");
}

function setupAnnouncementButton() {
  const holder = document.getElementById("mywork-actions");
  if (!holder) return;
  holder.innerHTML = isSystemAdmin() ? `<button type="button" class="btn-secondary" id="ann-open-btn">📢 發布公告</button>` : "";
  const btn = document.getElementById("ann-open-btn");
  if (btn) btn.onclick = openAnnouncementAdmin;
}

async function openAnnouncementAdmin() {
  const root = openModal("系統公告", `<div class="empty-state">載入中...</div>`, { width: "620px" });
  const body = root.querySelector(".modal-body");
  const render = async () => {
    let rows = [];
    try {
      rows = await api("/announcements/all");
    } catch (e) {
      body.innerHTML = `<div class="empty-state">載入失敗</div>`;
      return;
    }
    const now = Date.now();
    const isLive = (a) => a.is_active && (!a.expires_at || parseApiDate(a.expires_at).getTime() > now);
    body.innerHTML = `
      <form id="ann-form" class="ann-form">
        <div class="field"><label>標題</label><input id="ann-title" maxlength="120" placeholder="例如:伺服器維修通知" required autocomplete="off"></div>
        <div class="field"><label>內容(選填)</label><textarea id="ann-content" rows="3" maxlength="4000" placeholder="例如:10/10 22:00–23:00 進行伺服器維修,期間系統可能無法使用。"></textarea></div>
        <div class="ann-form-row">
          <div class="field"><label>類型</label>
            <select id="ann-level"><option value="info">📢 一般公告</option><option value="warning">⚠️ 注意</option><option value="urgent">🚨 緊急</option></select>
          </div>
          <div class="field"><label>顯示到(選填,過了自動下架)</label><input type="datetime-local" id="ann-exp"></div>
        </div>
        <div style="display:flex;justify-content:flex-end"><button type="submit" class="btn-primary">發布</button></div>
      </form>
      <div class="ann-list-title">已發布(${rows.length})</div>
      <div class="ann-list">
        ${rows.length
          ? rows
              .map((a) => {
                const lv = ANN_LEVEL[a.level] || ANN_LEVEL.info;
                const live = isLive(a);
                return `<div class="ann-row${live ? "" : " off"}">
                  <div class="ann-row-main">
                    <div class="ann-row-title">${lv.icon} ${escapeHtml(a.title)} <span class="ann-state ${live ? "on" : ""}">${live ? "顯示中" : a.is_active ? "已過期" : "已下架"}</span></div>
                    <div class="ann-row-meta">${escapeHtml(fmtDateTime(a.created_at))}${a.expires_at ? `・至 ${escapeHtml(fmtDateTime(a.expires_at))}` : ""}</div>
                  </div>
                  <button type="button" class="btn-secondary btn-sm" data-ann-toggle="${a.id}" data-active="${a.is_active ? 1 : 0}">${a.is_active ? "下架" : "重新上架"}</button>
                  <button type="button" class="btn-secondary btn-sm" data-ann-del="${a.id}">刪除</button>
                </div>`;
              })
              .join("")
          : `<div class="helper-text">還沒有發布過公告</div>`}
      </div>`;
    body.querySelector("#ann-form").onsubmit = async (e) => {
      e.preventDefault();
      const exp = body.querySelector("#ann-exp").value;
      try {
        await api("/announcements", {
          method: "POST",
          body: {
            title: body.querySelector("#ann-title").value.trim(),
            content: body.querySelector("#ann-content").value.trim() || null,
            level: body.querySelector("#ann-level").value,
            // datetime-local 是使用者本地時間 → 轉成帶時區的 ISO,後端再轉 UTC
            expires_at: exp ? new Date(exp).toISOString() : null,
          },
        });
        toast("公告已發布", "success");
        await render();
        loadAnnouncementBanner();
      } catch (err) {}
    };
    body.querySelectorAll("[data-ann-toggle]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/announcements/${b.dataset.annToggle}`, { method: "PATCH", body: { is_active: b.dataset.active !== "1" } });
          await render();
          loadAnnouncementBanner();
        } catch (err) {}
      };
    });
    body.querySelectorAll("[data-ann-del]").forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmDialog("確定刪除這則公告?", { title: "刪除公告", confirmText: "刪除", danger: true }))) return;
        try {
          await api(`/announcements/${b.dataset.annDel}`, { method: "DELETE" });
          await render();
          loadAnnouncementBanner();
        } catch (err) {}
      };
    });
  };
  await render();
}

// ===== 彈跳視窗:有尚未閱讀的有效公告就跳出,必須勾「我已閱讀」才能關閉 =====
// 已閱讀的公告 id 存伺服器(user_prefs.annReadIds),換裝置 / 換網址也不會重複跳。
async function checkAnnouncementPopup() {
  if (document.getElementById("ann-popup")) return;
  let rows, readIds;
  try {
    rows = await api("/announcements", { silent: true });
    const pref = await api("/me/prefs/annReadIds", { silent: true });
    readIds = Array.isArray(pref && pref.value) ? pref.value : [];
  } catch (e) {
    return;
  }
  const unread = rows.filter((a) => !readIds.includes(a.id));
  if (!unread.length || document.getElementById("ann-popup")) return;

  const wrap = document.createElement("div");
  wrap.id = "ann-popup";
  wrap.className = "ann-popup-overlay";
  wrap.setAttribute("role", "alertdialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.innerHTML = `
    <div class="ann-popup">
      <div class="ann-popup-head">📢 系統公告</div>
      <div class="ann-popup-body">
        ${unread
          .map((a) => {
            const lv = ANN_LEVEL[a.level] || ANN_LEVEL.info;
            return `<div class="ann-banner ann-${escapeHtml(a.level)}">
              <span class="ann-ic">${lv.icon}</span>
              <div class="ann-main">
                <div class="ann-title">${escapeHtml(a.title)}</div>
                ${a.content ? `<div class="ann-content">${escapeHtml(a.content)}</div>` : ""}
                <div class="ann-meta">${escapeHtml(a.created_by_name || "系統管理員")}・${escapeHtml(fmtDateTime(a.created_at))}${a.expires_at ? `・顯示至 ${escapeHtml(fmtDateTime(a.expires_at))}` : ""}</div>
              </div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="ann-popup-foot">
        <label class="ann-read"><input type="checkbox" id="ann-read-chk"> 我已閱讀${unread.length > 1 ? "以上公告" : "此公告"}</label>
        <button type="button" class="btn-primary" id="ann-close-btn" disabled>關閉</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const chk = wrap.querySelector("#ann-read-chk");
  const btn = wrap.querySelector("#ann-close-btn");
  chk.onchange = () => { btn.disabled = !chk.checked; };
  // 沒勾之前不能關:點遮罩、按 Esc 都沒反應
  const onKey = (e) => { if (e.key === "Escape") e.preventDefault(); };
  document.addEventListener("keydown", onKey, true);
  btn.onclick = async () => {
    if (!chk.checked) return;
    btn.disabled = true;
    const merged = [...new Set([...readIds, ...unread.map((a) => a.id)])].slice(-200);
    try {
      await api("/me/prefs/annReadIds", { method: "PUT", body: { value: merged }, silent: true });
    } catch (e) {}
    document.removeEventListener("keydown", onKey, true);
    wrap.remove();
  };
  chk.focus();
}
