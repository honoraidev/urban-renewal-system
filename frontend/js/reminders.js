"use strict";

// 全站頂端鈴鐺 - 緊急且重要的待辦提醒:後端自動判斷(逾期/快到期且重要的行事曆備註、
// 案件延遲時這階段未完成的 SOP 項目,規則見 backend utils/todo_priority.py),加上
// 今天手動標「重要」的備註(跟工作看板行事曆同一份 calendar_events 資料)。
// 登入後開始輪詢(見 auth.js loadCurrentUser),登出停止(見 doLogout)。

const remindersState = {
  pollTimer: null,
  items: [],
  readIds: _loadBellIdSet("bellReadIds"),
  hiddenIds: _loadBellIdSet("bellHiddenIds"),
};

// 鈴鐺的「已讀」「刪除」都只是自己這邊不想再看到/不想再被算進未讀數字,不是真的要
// 對應那筆行事曆備註做什麼 - 案件裡其他成員也看得到同一筆備註,不能因為我按了
// 已讀/刪除就影響到別人那邊的鈴鐺(這也是為什麼「刪除」故意不打後端 DELETE API)。
// 兩個狀態都只存在這個瀏覽器分頁的 sessionStorage,換一台裝置或重新登入都會還原,
// 這是刻意的行為,不是要做成跨裝置同步的已讀狀態。
// - 已讀:訊息還留在清單裡,只有未讀數字不算它。
// - 刪除:整筆從「自己這邊」的清單裡拿掉,其他人的鈴鐺完全不受影響。
function _loadBellIdSet(key) {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(key) || "[]"));
  } catch (e) {
    return new Set();
  }
}
function _saveBellIdSet(key, set) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...set]));
  } catch (e) { }
}
function _bellVisibleItems() {
  return remindersState.items.filter((it) => !remindersState.hiddenIds.has(it.id));
}
function _bellUnreadCount() {
  return _bellVisibleItems().filter((it) => !remindersState.readIds.has(it.id)).length;
}

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
    .nav-bell-head-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .nav-bell-bulk-btn { border: none; background: var(--surface-2); color: var(--text-muted); font-size: 11px;
      font-weight: 700; padding: 3px 8px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
    .nav-bell-bulk-btn:hover { background: var(--border); color: var(--text); }
    .nav-bell-bulk-delete:hover { background: var(--danger-light); color: var(--danger); }
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
    /* 行事曆備註類鈴鐺項目(kind=todo)可以右滑露出「已讀/刪除」- 只有這種背後有
       真實 calendar_events 資料列,SOP 自動彙整項每次都重新算出來,沒有資料列可以
       操作,不給滑。 */
    .nav-bell-row { position: relative; border-radius: 8px; overflow: hidden; }
    /* 進場動畫(bell-item-in)只套在 .nav-bell-item 本身,不影響它底下的
       .nav-bell-swipe-actions - 淡入還沒跑完時 item 還是半透明,底下已經全不透明的
       已讀/刪除色塊會透出來,滑鼠移上去看到的「影子」就是這個。有滑動功能的列直接
       關掉這個進場動畫,避免兩者打架。 */
    .nav-bell-row-swipe .nav-bell-item { position: relative; z-index: 1; background: var(--surface); touch-action: pan-y;
      transition: transform .18s ease; user-select: none; -webkit-user-select: none; animation: none; opacity: 1; }
    /* 寬度只要剛好包住兩顆按鈕就好,不能用 inset:0 撐滿整列 - 不然「滑開一半」的
       判斷基準(revealWidth) 會變成整列寬度,要滑超過一半列寬才會判定成「開」,
       手感會像完全沒反應。 */
    .nav-bell-swipe-actions { position: absolute; left: 0; top: 0; bottom: 0; width: max-content; z-index: 0;
      display: flex; align-items: stretch; }
    .nav-bell-swipe-btn { border: none; cursor: pointer; color: #fff; font-size: 12px; font-weight: 800;
      padding: 0 16px; display: flex; align-items: center; white-space: nowrap; }
    .nav-bell-swipe-read { background: #2f9e6e; }
    .nav-bell-swipe-delete { background: var(--danger); }
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
  const items = _bellVisibleItems();
  dd.innerHTML = `
    <div class="nav-bell-dropdown-head">
      <span>🔔 緊急重要待辦</span>
      <div class="nav-bell-head-actions">
        ${_bellUnreadCount() ? `<span class="nav-bell-count">${_bellUnreadCount()}</span>` : ""}
        ${items.length
          ? `<button type="button" class="nav-bell-bulk-btn" data-bell-bulk="read">一鍵已讀</button>
             <button type="button" class="nav-bell-bulk-btn nav-bell-bulk-delete" data-bell-bulk="clear">一鍵刪除</button>`
          : ""}
      </div>
    </div>
    <div class="nav-bell-list">${items.length
      ? items
          .map((it, i) => {
            // 只有 kind=todo(真實的行事曆備註)背後有資料列可以操作,才給右滑
            // 「已讀/刪除」- SOP 自動彙整項每次都是重新算出來的,沒有東西可以刪。
            const swipeable = it.kind === "todo";
            const body = `<button type="button" class="nav-bell-item" style="--i:${i}" data-bell-item="${it.id}" data-bell-project="${it.project_id ?? ""}" data-bell-kind="${it.kind}" data-bell-stage="${it.stage ?? ""}">
              <div class="nav-bell-item-text">${it.kind && it.kind.startsWith("sop") ? "📋" : "🔥"} ${escapeHtml(it.content)}</div>
              ${it.reason ? `<div class="nav-bell-item-reason">${escapeHtml(it.reason)}</div>` : ""}
              <div class="nav-bell-item-proj">${it.project_name ? "📁 " + escapeHtml(it.project_name) : "👤 個人"}</div>
            </button>`;
            if (!swipeable) return `<div class="nav-bell-row">${body}</div>`;
            return `<div class="nav-bell-row nav-bell-row-swipe">
              <div class="nav-bell-swipe-actions">
                <button type="button" class="nav-bell-swipe-btn nav-bell-swipe-read" data-bell-read="${it.id}">已讀</button>
                <button type="button" class="nav-bell-swipe-btn nav-bell-swipe-delete" data-bell-delete="${it.id}">刪除</button>
              </div>
              ${body}
            </div>`;
          })
          .join("")
      : `<div class="nav-bell-empty"><span class="e">🔕</span>目前沒有緊急重要的待辦<br>逾期或快到期的重要事項會自動出現在這裡</div>`
    }</div>`;

  dd.querySelectorAll(".nav-bell-row:not(.nav-bell-row-swipe) [data-bell-item]").forEach((row) => {
    row.addEventListener("click", () => _bellNavigate(row));
  });
  dd.querySelectorAll(".nav-bell-row-swipe").forEach((rowWrap) => _wireBellSwipeRow(rowWrap));
  dd.querySelectorAll("[data-bell-read]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // 「已讀」只是消音,訊息本身還留著 - 不打 API 改行事曆備註,單純記在這個
      // 分頁的本地已讀清單裡,重新渲染讓右上角數字扣掉它就好。
      remindersState.readIds.add(Number(btn.dataset.bellRead));
      _saveBellIdSet("bellReadIds", remindersState.readIds);
      _renderBellBadge();
      _renderBellDropdown();
    });
  });
  dd.querySelectorAll("[data-bell-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // 這筆行事曆備註可能是案件其他成員建的、大家共用同一份資料 - 「刪除」故意
      // 不打後端 API 真的刪掉,只是從自己這邊的鈴鐺清單拿掉,不影響其他人看到的。
      remindersState.hiddenIds.add(Number(btn.dataset.bellDelete));
      _saveBellIdSet("bellHiddenIds", remindersState.hiddenIds);
      _renderBellBadge();
      _renderBellDropdown();
    });
  });
  dd.querySelectorAll("[data-bell-bulk]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // 一鍵已讀/一鍵刪除套用在「目前看得到的全部項目」,包含沒有個別滑動按鈕的
      // SOP 自動彙整項 - 跟單筆已讀/刪除同一套本地清單,一樣不影響其他人的鈴鐺。
      const targetSet = btn.dataset.bellBulk === "clear" ? remindersState.hiddenIds : remindersState.readIds;
      const storageKey = btn.dataset.bellBulk === "clear" ? "bellHiddenIds" : "bellReadIds";
      _bellVisibleItems().forEach((it) => targetSet.add(it.id));
      _saveBellIdSet(storageKey, targetSet);
      _renderBellBadge();
      _renderBellDropdown();
    });
  });
}

function _bellNavigate(row) {
  closeBellDropdown();
  const pid = row.dataset.bellProject;
  const kind = row.dataset.bellKind;
  const stageRaw = row.dataset.bellStage;
  if (pid && kind && kind.startsWith("sop") && typeof goToProjectSopStage === "function") {
    goToProjectSopStage(Number(pid), stageRaw !== "" ? Number(stageRaw) : null);
  } else if (pid && typeof goToProjectOverviewPage === "function") {
    goToProjectOverviewPage(Number(pid));
  } else if (typeof goToMyWork === "function") {
    goToMyWork();
  }
}

// 右滑露出「已讀/刪除」。故意不用 Pointer Events + setPointerCapture —— 拖曳一開始
// 就把 mousemove/mouseup 掛在 document 上(不是掛在這顆按鈕本身),不管游標之後
// 滑到哪裡(哪怕滑出這顆按鈕、滑出整個鈴鐺面板)都收得到後續事件,這是最不容易
// 因為瀏覽器/裝置差異而「滑了沒反應」的寫法。拖過一半寬度才算「滑開」,鬆手回彈
// 或定格;純點擊(沒有明顯位移)才會當一般點擊去跳轉,滑開狀態下點本體先收合、
// 不跳轉,避免手滑誤觸跳頁。
function _wireBellSwipeRow(rowWrap) {
  const item = rowWrap.querySelector(".nav-bell-item");
  const actions = rowWrap.querySelector(".nav-bell-swipe-actions");
  if (!item || !actions) return;
  let startX = 0, startY = 0, baseX = 0, currentX = 0, maxAbsDx = 0;
  let dragging = false, moved = false, open = false;
  const revealWidth = () => actions.getBoundingClientRect().width || 120;
  // 一般點擊時,滑鼠在按下到放開之間本來就會有幾 px 的手震,太小的死區(之前設 6px)
  // 常常被一次正常點擊就誤觸,滑開一點點又立刻彈回去,看起來像「點訊息時邊邊閃一下」。
  // 拉大死區減少誤判。
  const DEAD_ZONE = 12;

  function applyMove(clientX, clientY, evt) {
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (!moved) {
      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        endDrag(); // 垂直方向的滑動交給清單捲動,不當左右滑
        return;
      }
      moved = true;
    }
    if (evt && evt.cancelable) evt.preventDefault();
    maxAbsDx = Math.max(maxAbsDx, Math.abs(dx));
    currentX = Math.max(0, Math.min(revealWidth(), baseX + dx));
    item.style.transform = `translateX(${currentX}px)`;
  }
  function onMouseMove(e) {
    applyMove(e.clientX, e.clientY, e);
  }
  function onTouchMove(e) {
    const t = e.touches[0];
    if (t) applyMove(t.clientX, t.clientY, e);
  }
  function detach() {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", endDrag);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", endDrag);
    document.removeEventListener("touchcancel", endDrag);
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    detach();
    if (!moved) {
      item.style.transition = "";
      return;
    }
    open = currentX > revealWidth() / 2;
    // 從沒真的滑開過(距離一直很小,只是誤觸死區)就直接歸零不要播動畫 - 不然
    // 即使死區拉大了,萬一還是被誤判成一次極小的拖曳,彈回去的動畫本身還是會
    // 讓人看到那一閃而過的邊角。真的有滑開過的才需要動畫收合,手感比較順。
    item.style.transition = maxAbsDx < revealWidth() / 2 ? "none" : "";
    item.style.transform = `translateX(${open ? revealWidth() : 0}px)`;
  }

  item.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    maxAbsDx = 0;
    startX = e.clientX;
    startY = e.clientY;
    baseX = open ? revealWidth() : 0;
    // .nav-bell-item 有進場動畫(animation: bell-item-in ... both),fill-mode both
    // 會讓動畫跑完後繼續「霸占」transform 這個屬性、蓋掉底下任何用 JS 設的
    // style.transform - 這才是滑了完全沒有視覺移動的真正原因(不是事件綁定的問題),
    // 開始拖曳時把動畫關掉,transform 才能真的交回給拖曳邏輯控制。
    item.style.animation = "none";
    item.style.transition = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", endDrag);
  });
  item.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (!t) return;
      dragging = true;
      moved = false;
      maxAbsDx = 0;
      startX = t.clientX;
      startY = t.clientY;
      baseX = open ? revealWidth() : 0;
      item.style.animation = "none";
      item.style.transition = "none";
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", endDrag);
      document.addEventListener("touchcancel", endDrag);
    },
    { passive: true }
  );

  item.addEventListener("click", (e) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
      return;
    }
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      item.style.transform = "translateX(0)";
      return;
    }
    _bellNavigate(item);
  });
}

function closeBellDropdown() {
  document.getElementById("nav-bell-dropdown")?.classList.add("hidden");
}

async function refreshReminderBell() {
  remindersState.items = await _loadTodayImportant();
  _renderBellBadge();
  const dd = document.getElementById("nav-bell-dropdown");
  if (dd && !dd.classList.contains("hidden")) _renderBellDropdown();
}

function _renderBellBadge() {
  const badge = document.getElementById("nav-bell-badge");
  if (!badge) return;
  const n = _bellUnreadCount();
  document.getElementById("nav-bell-btn")?.classList.toggle("has-items", n > 0);
  if (n) {
    badge.textContent = n > 9 ? "9+" : String(n);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
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
