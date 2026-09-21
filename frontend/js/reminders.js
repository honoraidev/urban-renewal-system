"use strict";

// 全站頂端鈴鐺 - 緊急且重要的待辦提醒:後端自動判斷(逾期/快到期且重要的行事曆備註、
// 案件延遲時這階段未完成的 SOP 項目,規則見 backend utils/todo_priority.py),加上
// 今天手動標「重要」的備註(跟工作看板行事曆同一份 calendar_events 資料)。
// 登入後開始輪詢(見 auth.js loadCurrentUser),登出停止(見 doLogout)。

const remindersState = { pollTimer: null, items: [] };

function remindersEnsureStyle() {
  if (document.getElementById("reminders-style")) return;
  const s = document.createElement("style");
  s.id = "reminders-style";
  s.textContent = `
    .nav-bell-wrap { position: relative; }
    .nav-bell-btn { position: relative; }
    @keyframes bell-badge-pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
    .nav-bell-badge { animation: bell-badge-pop .35s cubic-bezier(.22, 1, .36, 1);
      position: absolute; top: -4px; right: -4px; background: var(--danger); color: #fff;
      font-size: 10px; font-weight: 800; line-height: 1; padding: 3px 4px; border-radius: 999px;
      min-width: 15px; text-align: center; border: 1.5px solid var(--surface);
    }
    .nav-bell-dropdown {
      position: fixed; z-index: 60; width: min(290px, calc(100vw - 24px));
      background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
      box-shadow: 0 16px 40px -12px rgba(15, 35, 38, .28), 0 4px 12px rgba(15, 35, 38, .08);
      padding: 6px; transform-origin: var(--caret-x, 30px) 100%;
      animation: bell-pop .22s cubic-bezier(.22, 1, .36, 1);
    }
    /* 底下指向鈴鐺的小三角(位置由 JS 依按鈕算好放進 --caret-x) */
    .nav-bell-dropdown::after {
      content: ""; position: absolute; bottom: -6px; left: calc(var(--caret-x, 30px) - 6px); width: 12px; height: 12px;
      background: var(--surface); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
      transform: rotate(45deg); border-bottom-right-radius: 3px;
    }
    @keyframes bell-pop {
      from { opacity: 0; transform: translateY(10px) scale(.94); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .nav-bell-dropdown-head {
      display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 800;
      color: var(--text-muted); padding: 8px 10px 8px; border-bottom: 1px solid var(--border); margin-bottom: 4px;
    }
    .nav-bell-count { font-size: 11px; font-weight: 800; background: var(--danger-light); color: var(--danger);
      border-radius: 999px; padding: 1px 8px; }
    .nav-bell-list { max-height: 260px; overflow-y: auto; }
    @keyframes bell-item-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes bell-ring {
      0%, 100% { transform: rotate(0); } 15% { transform: rotate(16deg); } 30% { transform: rotate(-14deg); }
      45% { transform: rotate(10deg); } 60% { transform: rotate(-6deg); } 75% { transform: rotate(3deg); }
    }
    .nav-bell-btn.has-items .nav-bell-icon { display: inline-block; transform-origin: 50% 8%; animation: bell-ring 1.1s ease-in-out .3s 2; }
    .nav-bell-btn:hover .nav-bell-icon { display: inline-block; transform-origin: 50% 8%; animation: bell-ring .8s ease-in-out; }
    .nav-bell-item { display: block; width: 100%; text-align: left; border: none; background: none; cursor: pointer;
      padding: 8px; border-radius: 8px; white-space: normal; word-break: break-word; }
    .nav-bell-item { animation: bell-item-in .3s cubic-bezier(.22, 1, .36, 1) both; animation-delay: calc(var(--i, 0) * 45ms + 80ms); }
    .nav-bell-item:hover { background: var(--surface-2); }
    .nav-bell-item-text { font-size: 13px; color: var(--text); line-height: 1.4; }
    .nav-bell-item-reason { font-size: 11.5px; color: var(--danger); font-weight: 600; margin-top: 2px; }
    .nav-bell-item-proj { font-size: 11.5px; color: var(--brand-dark, var(--brand)); font-weight: 700; margin-top: 3px; }
    .nav-bell-empty { padding: 22px 10px 20px; text-align: center; font-size: 12.5px; color: var(--text-muted); line-height: 1.7; }
    .nav-bell-empty .e { display: block; font-size: 26px; opacity: .55; margin-bottom: 4px; }
  `;
  document.head.appendChild(s);
}

async function _loadTodayImportant() {
  try {
    return await api("/dashboard/today-important", { silent: true });
  } catch (e) {
    return [];
  }
}

function _renderBellDropdown() {
  const dd = document.getElementById("nav-bell-dropdown");
  if (!dd) return;
  const items = remindersState.items;
  dd.innerHTML = `
    <div class="nav-bell-dropdown-head"><span>🔔 緊急重要待辦</span>${items.length ? `<span class="nav-bell-count">${items.length}</span>` : ""}</div>
    <div class="nav-bell-list">${items.length
      ? items
          .map(
            (it, i) => `<button type="button" class="nav-bell-item" style="--i:${i}" data-bell-item="${it.id}" data-bell-project="${it.project_id ?? ""}">
              <div class="nav-bell-item-text">${it.kind === "sop" ? "📋" : "🔥"} ${escapeHtml(it.content)}</div>
              ${it.reason ? `<div class="nav-bell-item-reason">${escapeHtml(it.reason)}</div>` : ""}
              <div class="nav-bell-item-proj">${it.project_name ? "📁 " + escapeHtml(it.project_name) : "👤 個人"}</div>
            </button>`
          )
          .join("")
      : `<div class="nav-bell-empty"><span class="e">🔕</span>目前沒有緊急重要的待辦<br>逾期或快到期的重要事項會自動出現在這裡</div>`
    }</div>`;
  dd.querySelectorAll("[data-bell-item]").forEach((row) => {
    row.addEventListener("click", () => {
      closeBellDropdown();
      const pid = row.dataset.bellProject;
      if (pid && typeof goToProjectOverviewPage === "function") {
        goToProjectOverviewPage(Number(pid));
      } else if (typeof goToMyWork === "function") {
        goToMyWork();
      }
    });
  });
}

function closeBellDropdown() {
  document.getElementById("nav-bell-dropdown")?.classList.add("hidden");
}

async function refreshReminderBell() {
  remindersState.items = await _loadTodayImportant();
  const badge = document.getElementById("nav-bell-badge");
  if (badge) {
    const n = remindersState.items.length;
    document.getElementById("nav-bell-btn")?.classList.toggle("has-items", n > 0);
    if (n) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
  const dd = document.getElementById("nav-bell-dropdown");
  if (dd && !dd.classList.contains("hidden")) _renderBellDropdown();
}

function initReminders() {
  remindersEnsureStyle();
  const btn = document.getElementById("nav-bell-btn");
  const dd = document.getElementById("nav-bell-dropdown");
  if (!btn || !dd) return;
  // 側欄(.sb)有 backdrop-filter,會變成 fixed 子元素的定位基準並把面板裁在側欄範圍內,
  // 所以面板搬到 body 底下,才是真正相對整個視窗定位、不會被切掉。
  document.body.appendChild(dd);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dd.classList.contains("hidden");
    if (isOpen) {
      dd.classList.add("hidden");
    } else {
      _renderBellDropdown();
      // 鈴鐺在左側欄最底下(見 .nav-user),面板要往上開、並貼齊側欄左緣 - 用 fixed 定位,
      // 才不會被側欄的窄寬度或 overflow 切掉一半(原本 right:0 往左長會超出螢幕)。
      const r = btn.getBoundingClientRect();
      dd.style.left = "12px";
      dd.style.setProperty("--caret-x", `${Math.max(18, r.left + r.width / 2 - 12)}px`);
      dd.style.bottom = `${Math.max(8, window.innerHeight - r.top + 10)}px`;
      dd.style.top = "auto";
      dd.classList.remove("hidden");
    }
  });
  dd.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeBellDropdown);
}

// 登入後立刻抓一次 + 每分鐘輪詢(見 auth.js loadCurrentUser/doLogout)。
function startReminderPolling() {
  stopReminderPolling();
  refreshReminderBell();
  remindersState.pollTimer = setInterval(refreshReminderBell, 60000);
}
function stopReminderPolling() {
  if (remindersState.pollTimer) {
    clearInterval(remindersState.pollTimer);
    remindersState.pollTimer = null;
  }
  remindersState.items = [];
  document.getElementById("nav-bell-badge")?.classList.add("hidden");
}

// 「新增重要待辦」快速表單 - 案件總覽頁的待辦事項卡片、工作看板都會用到同一個
// modal,差別只在 defaultProjectId 是否預帶(案件總覽頁帶當前案件、工作看板帶空)。
// stageChoices = { current: {index,name}, next: {index,name}|null }(給了才會出現「所屬階段」欄位,
// 而且只在選了案件時顯示 - 個人備註沒有階段)。存的是關卡編號,之後案件進到下一關,
// 原本歸「下階段」的待辦會自然變成「這階段」。
function openAddReminderModal(defaultProjectId, projectOptions, onDone, stageChoices) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const opts = projectOptions || [];
  const stageFieldHtml = stageChoices
    ? `<div class="field" id="reminder-stage-field" ${defaultProjectId ? "" : 'style="display:none"'}>
        <label>所屬階段</label>
        <select name="sop_stage">
          <option value="${stageChoices.current.index}">這階段:第${stageChoices.current.index}階段 ${escapeHtml(stageChoices.current.name || "")}</option>
          ${stageChoices.next ? `<option value="${stageChoices.next.index}">下階段:第${stageChoices.next.index}階段 ${escapeHtml(stageChoices.next.name || "")}</option>` : ""}
        </select>
      </div>`
    : "";
  openModal(
    "新增待辦事項",
    `
    <form id="reminder-add-form">
      <div class="field">
        <label>案件</label>
        <select name="project_id">
          <option value="">個人(只有自己看得到)</option>
          ${opts.map((p) => `<option value="${p.id}" ${defaultProjectId && p.id === defaultProjectId ? "selected" : ""}>${escapeHtml(p.name)}(案件成員共用)</option>`).join("")}
        </select>
      </div>
      ${stageFieldHtml}
      <div class="field"><label>日期</label><input type="date" name="event_date" value="${todayIso}" required></div>
      <div class="field"><label>內容</label><textarea name="content" rows="3" placeholder="這天要做什麼..." required></textarea></div>
      <div class="field" style="margin-bottom:0">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" name="is_important" style="width:auto">
          <span>標記為重要(會出現在今日重要待辦鈴鐺提醒)</span>
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`,
    { width: "420px" }
  );
  const addForm = document.getElementById("reminder-add-form");
  addForm.querySelector('select[name="project_id"]').addEventListener("change", (e) => {
    const field = document.getElementById("reminder-stage-field");
    if (field) field.style.display = e.target.value ? "" : "none";
  });
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pidRaw = fd.get("project_id");
    const stageRaw = fd.get("sop_stage");
    try {
      await api("/dashboard/calendar", {
        method: "POST",
        body: {
          event_date: fd.get("event_date"),
          content: fd.get("content"),
          project_id: pidRaw ? Number(pidRaw) : null,
          is_important: fd.get("is_important") === "on",
          sop_stage: pidRaw && stageRaw !== null && stageRaw !== "" ? Number(stageRaw) : null,
        },
      });
      closeModal();
      toast("已新增", "success");
      refreshReminderBell();
      if (typeof onDone === "function") onDone();
    } catch (err) { }
  });
}
