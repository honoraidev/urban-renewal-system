"use strict";

// 全站頂端鈴鐺 - 今天、標「重要」的待辦提醒(跟工作看板行事曆同一份 calendar_events
// 資料,is_important=true 才會出現在這裡,一般備註太多了全部推播沒人想看)。
// 登入後開始輪詢(見 auth.js loadCurrentUser),登出停止(見 doLogout)。

const remindersState = { pollTimer: null, items: [] };

function remindersEnsureStyle() {
  if (document.getElementById("reminders-style")) return;
  const s = document.createElement("style");
  s.id = "reminders-style";
  s.textContent = `
    .nav-bell-wrap { position: relative; }
    .nav-bell-btn { position: relative; }
    .nav-bell-badge {
      position: absolute; top: -4px; right: -4px; background: var(--danger); color: #fff;
      font-size: 10px; font-weight: 800; line-height: 1; padding: 3px 4px; border-radius: 999px;
      min-width: 15px; text-align: center; border: 1.5px solid var(--surface);
    }
    .nav-bell-dropdown {
      position: fixed; z-index: 60; width: min(300px, calc(100vw - 24px)); max-height: 360px;
      overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: var(--shadow-modal, 0 12px 32px rgba(0,0,0,.18)); padding: 8px;
    }
    .nav-bell-dropdown-head { font-size: 12.5px; font-weight: 800; color: var(--text-muted); padding: 6px 8px 8px; }
    .nav-bell-item { display: block; width: 100%; text-align: left; border: none; background: none; cursor: pointer;
      padding: 8px; border-radius: 8px; }
    .nav-bell-item:hover { background: var(--surface-2); }
    .nav-bell-item-text { font-size: 13px; color: var(--text); line-height: 1.4; }
    .nav-bell-item-proj { font-size: 11.5px; color: var(--brand-dark, var(--brand)); font-weight: 700; margin-top: 3px; }
    .nav-bell-empty { padding: 16px 8px; text-align: center; font-size: 12.5px; color: var(--text-muted); }
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
    <div class="nav-bell-dropdown-head">🔔 今日重要待辦</div>
    ${items.length
      ? items
          .map(
            (it) => `<button type="button" class="nav-bell-item" data-bell-item="${it.id}" data-bell-project="${it.project_id ?? ""}">
              <div class="nav-bell-item-text">${escapeHtml(it.content)}</div>
              <div class="nav-bell-item-proj">${it.project_name ? "📁 " + escapeHtml(it.project_name) : "👤 個人"}</div>
            </button>`
          )
          .join("")
      : `<div class="nav-bell-empty">今天沒有標記重要的待辦</div>`
    }`;
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
      dd.style.bottom = `${Math.max(8, window.innerHeight - r.top + 10)}px`;
      dd.style.top = "auto";
      dd.classList.remove("hidden");
    }
  });
  dd.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeBellDropdown);

  // 案件詳情頁右上角的「+」(見 index.html #pd-add-todo-btn)- 預帶目前案件。
  document.getElementById("pd-add-todo-btn")?.addEventListener("click", () => {
    const pid = state.currentProjectId;
    if (!pid) return;
    const name = state.currentProject?.name || `案件 ${pid}`;
    openAddReminderModal(pid, [{ id: pid, name }]);
  });
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
function openAddReminderModal(defaultProjectId, projectOptions, onDone) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const opts = projectOptions || [];
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
  document.getElementById("reminder-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pidRaw = fd.get("project_id");
    try {
      await api("/dashboard/calendar", {
        method: "POST",
        body: {
          event_date: fd.get("event_date"),
          content: fd.get("content"),
          project_id: pidRaw ? Number(pidRaw) : null,
          is_important: fd.get("is_important") === "on",
        },
      });
      closeModal();
      toast("已新增", "success");
      refreshReminderBell();
      if (typeof onDone === "function") onDone();
    } catch (err) { }
  });
}
