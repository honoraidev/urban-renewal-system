"use strict";

// 系統公告:L0 系統管理員在工作看板發布(伺服器維修等),所有登入者在工作看板頂端看到有效公告。
const ANN_LEVEL = {
  info: { label: "一般公告", icon: "📢" },
  warning: { label: "注意", icon: "⚠️" },
  urgent: { label: "緊急", icon: "🚨" },
};

let _annGroupOpen = false;

async function loadAnnouncementBanner() {
  const box = document.getElementById("mywork-ann");
  if (!box) return;
  let rows = [];
  try {
    rows = await api("/announcements", { silent: true });
  } catch (e) {
    return;
  }
  // 單列:左側色條 + 標題 + 公告人 + 「查看」膠囊;顏色跟著公告類型走(一般=藍、注意=橘、緊急=紅)
  const rowHtml = (a) => {
    const tone = a.level === "urgent" ? "red" : a.level === "warning" ? "amber" : "blue";
    return `<button type="button" class="mwd-ann-item ann-tone-${tone}" data-ann-id="${a.id}" title="點擊查看公告內容">
      <span class="mwd-ann-main"><div class="mwd-ann-t">${escapeHtml(a.title)}</div><div class="mwd-ann-d">${escapeHtml(fmtDateTime(a.created_at))}</div></span>
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  };
  window._annRows = rows;
  const cnt = document.getElementById("mwd-ann-count");
  if (cnt) cnt.textContent = rows.length ? `共 ${rows.length} 則` : "";
  // 公告卡空間夠,不再收合:有幾則就直接列幾則(太多時卡片內捲動)
  box.innerHTML = rows.length ? rows.map(rowHtml).join("") : `<div class="mwd-empty">目前沒有公告</div>`;
  box.querySelectorAll("[data-ann-id]").forEach((el) => {
    el.onclick = () => openAnnouncementDetail(rows.find((r) => String(r.id) === el.dataset.annId));
  });
}

function openAnnouncementDetail(a) {
  if (!a) return;
  document.getElementById("ann-detail")?.remove();
  const tone = a.level === "urgent" ? "red" : a.level === "warning" ? "amber" : "blue";
  const wrap = document.createElement("div");
  wrap.id = "ann-detail";
  wrap.className = `ann-d-overlay ann-tone-${tone}`;
  wrap.innerHTML = `
    <div class="ann-d-box" role="dialog" aria-modal="true">
      <div class="ann-d-head">
        <span class="ann-d-title">公告內容</span>
        <button type="button" class="ann-d-x" aria-label="關閉">&times;</button>
      </div>
      <div class="ann-d-body">
        <div class="ann-d-card">
          <div class="ann-d-card-title">${escapeHtml(a.title)}</div>
          ${a.content ? `<div class="ann-d-card-content">${escapeHtml(a.content)}</div>` : ""}
          <div class="ann-d-meta">
            <span>公告人:${escapeHtml(a.created_by_name || "系統管理員")}</span><i></i>
            <span>發布時間:${escapeHtml(fmtDateTime(a.created_at))}</span>${a.expires_at ? `<i></i><span>顯示至:${escapeHtml(fmtDateTime(a.expires_at))}</span>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    wrap.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey, true);
  wrap.querySelector(".ann-d-x").onclick = close;
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
}

function setupAnnouncementButton() {
  // 工作看板頂端橫幅(問候 + 即時天氣 + 管理員的「發布公告」鈕)見 weather_hero.js
  if (typeof renderWorkHero === "function") renderWorkHero();
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
  // 發布公告的系統管理員自己不用被彈窗打擾(頂端公告列仍看得到)
  if (isSystemAdmin()) return;
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
      <div class="ann-popup-head">
        <div>
          <div class="ann-popup-h1">系統公告</div>
          <div class="ann-popup-h2">重要資訊,請留意最新消息</div>
        </div>
        <button type="button" class="ann-popup-x" id="ann-x-btn" aria-label="關閉" title="請先看完公告並勾選「我已閱讀」">&times;</button>
      </div>
      <div class="ann-popup-body">
        ${unread
          .map((a, i) => `<div class="ann-card ann-card-${escapeHtml(a.level)}" data-ann-page="${i}"${i ? " hidden" : ""}>
            <div class="ann-card-title">${escapeHtml(a.title)}</div>
            ${a.content ? `<div class="ann-card-content">${escapeHtml(a.content)}</div>` : ""}
            <div class="ann-card-meta">
              <span>發布者:${escapeHtml(a.created_by_name || "系統管理員")}</span><i></i>
              <span>發布時間:${escapeHtml(fmtDateTime(a.created_at))}</span>${a.expires_at ? `<i></i><span>顯示至:${escapeHtml(fmtDateTime(a.expires_at))}</span>` : ""}
            </div>
          </div>`)
          .join("")}
      </div>
      <div class="ann-popup-foot">
        <label class="ann-read"${unread.length > 1 ? " hidden" : ""}>
          <input type="checkbox" id="ann-read-chk">
          <span><b>我已閱讀${unread.length > 1 ? "以上公告" : "此公告"}</b><small>下次將不再自動顯示${unread.length > 1 ? "這些公告" : "此公告"}</small></span>
        </label>
        <div class="ann-pager"${unread.length > 1 ? "" : " hidden"}><button type="button" class="btn-secondary btn-sm" id="ann-prev-btn" disabled>‹ 上一筆</button><span id="ann-page-no">1 / ${unread.length}</span></div>
        <button type="button" class="btn-primary ann-close" id="ann-next-btn"${unread.length > 1 ? "" : " hidden"}>下一筆 ›</button>
        <button type="button" class="btn-primary ann-close" id="ann-close-btn" disabled${unread.length > 1 ? " hidden" : ""}>關閉</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const chk = wrap.querySelector("#ann-read-chk");
  const btn = wrap.querySelector("#ann-close-btn");
  const xBtn = wrap.querySelector("#ann-x-btn");
  chk.onchange = () => { btn.disabled = !chk.checked; };
  // 多則公告:一次顯示一則,按「下一筆」逐則看;看到最後一則才出現「我已閱讀」勾選與關閉
  const cards = [...wrap.querySelectorAll("[data-ann-page]")];
  const prevBtn = wrap.querySelector("#ann-prev-btn");
  const nextBtn = wrap.querySelector("#ann-next-btn");
  const pageNo = wrap.querySelector("#ann-page-no");
  let page = 0;
  const showPage = (n) => {
    page = Math.max(0, Math.min(cards.length - 1, n));
    cards.forEach((c, i) => { c.hidden = i !== page; });
    const last = page === cards.length - 1;
    prevBtn.disabled = page === 0;
    pageNo.textContent = `${page + 1} / ${cards.length}`;
    if (cards.length > 1) {
      nextBtn.hidden = last;
      btn.hidden = !last;
      chk.closest(".ann-read").hidden = !last;
    }
    wrap.querySelector(".ann-popup-body").scrollTop = 0;
  };
  prevBtn.onclick = () => showPage(page - 1);
  nextBtn.onclick = () => showPage(page + 1);
  xBtn.onclick = () => {
    if (cards.length > 1 && page < cards.length - 1) {
      nextBtn.classList.remove("nudge");
      void nextBtn.offsetWidth;
      nextBtn.classList.add("nudge");
    } else if (chk.checked) btn.click();
    else {
      const lab = chk.closest(".ann-read");
      lab.classList.remove("nudge");
      void lab.offsetWidth;
      lab.classList.add("nudge");
      chk.focus();
    }
  };
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
  if (cards.length === 1) chk.focus(); else nextBtn.focus();
}

// 「查看全部」:列出目前有效的全部公告,點一則看詳細內容
function openAnnouncementList() {
  const rows = window._annRows || [];
  const html = rows.length
    ? `<div class="mwd-ann-list-modal">${rows
        .map((a) => {
          const tone = a.level === "urgent" ? "red" : a.level === "warning" ? "amber" : "blue";
          return `<button type="button" class="mwd-ann-item ann-tone-${tone}" data-ann-all="${a.id}"><span class="mwd-ann-main"><div class="mwd-ann-t">${escapeHtml(a.title)}</div><div class="mwd-ann-d">${escapeHtml(a.created_by_name || "系統管理員")}・${escapeHtml(fmtDateTime(a.created_at))}</div></span></button>`;
        })
        .join("")}</div>`
    : `<div class="mwd-empty">目前沒有公告</div>`;
  const root = openModal("公告", html, { width: "480px" });
  root.querySelectorAll("[data-ann-all]").forEach((el) => {
    el.onclick = () => openAnnouncementDetail(rows.find((r) => String(r.id) === el.dataset.annAll));
  });
}
