"use strict";

const myWorkState = { month: null, data: null, scope: "personal", pollTimer: null };

function myWorkEnsureStyle() {
  if (document.getElementById("mywork-style")) return;
  const s = document.createElement("style");
  s.id = "mywork-style";
  s.textContent = `
    .mw-grid { display:grid; grid-template-columns: 1.15fr 1fr; gap:20px; align-items:start; }
    @media (max-width: 980px){ .mw-grid { grid-template-columns: 1fr; } }
    .mw-card { background:var(--surface); border:1px solid var(--border,#e5e7eb); border-radius:14px; padding:16px; }
    .mw-card h3 { margin:0 0 12px; font-size:15px; }
    .mw-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
    .mw-cal-head .t { font-weight:700; font-size:15px; }
    .mw-cal-nav { display:flex; align-items:center; gap:6px; }
    .mw-cal-nav button {
      border:1px solid var(--border,#e5e7eb); background:var(--surface); color:var(--text);
      border-radius:9px; width:30px; height:30px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      font-size:15px; font-weight:700; line-height:1; padding:0;
      transition:background .12s ease, border-color .12s ease, color .12s ease, transform .08s ease;
    }
    .mw-cal-nav button:hover { background:var(--surface-2); border-color:var(--brand,#0d9488); color:var(--brand,#0d9488); }
    .mw-cal-nav button:active { transform:scale(.92); }
    #mw-today-btn { font-size:12.5px; font-weight:800; color:var(--brand,#0d9488); border-color:rgba(13,148,136,.35); }
    #mw-today-btn:hover { background:rgba(13,148,136,.1); }
    .mw-cal { display:grid; grid-template-columns: repeat(7,1fr); gap:3px; }
    .mw-cal .dow { text-align:center; font-size:11.5px; color:var(--text-muted,#6b7280); padding:2px 0; }
    .mw-day { min-height:54px; border:1px solid var(--border,#eee); border-radius:8px; padding:4px 5px; cursor:pointer; background:var(--bg,#fff); overflow:hidden; }
    .mw-day:hover { border-color:var(--brand,#0d9488); }
    .mw-day.other { opacity:.35; }
    .mw-day.today { border-color:var(--brand,#0d9488); box-shadow:0 0 0 1px var(--brand,#0d9488) inset; }
    .mw-day .dn { font-size:11.5px; font-weight:600; }
    .mw-ev { font-size:11px; line-height:1.35; margin-top:2px; padding:1px 4px; border-radius:4px; background:#e0f2fe; color:#075985; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mw-ev.proj { background:#dcfce7; color:#15803d; }
    .mw-more { font-size:10px; color:var(--text-muted,#6b7280); margin-top:1px; }
    .mw-grid { align-items:stretch; }
    .mw-left, .mw-right { min-width:0; display:flex; flex-direction:column; }
    .mw-left .mw-tile { flex:0 0 auto; margin-bottom:0; }
    .mw-left > .mw-card:first-child { flex:1; display:flex; flex-direction:column; }
    .mw-left .mw-cal { flex:1; grid-auto-rows:minmax(54px,1fr); }
    .mw-right > .mw-pair { flex:1; display:flex; gap:14px; margin-top:16px; min-height:0; }
    .mw-pair > .mw-card { flex:1 1 0; min-width:0; padding:12px 14px; display:flex; flex-direction:column; }
    .mw-pair > .mw-card h3 { margin:0 0 8px; font-size:14px; }
    @media (max-width:640px){ .mw-right > .mw-pair { flex-direction:column; } }
    .mw-right > .mw-scope-toggle { align-self:flex-end; }
    .mw-left > .mw-card:first-child { padding:12px 14px; }
    .mw-left .mw-cal-nav button { width:26px; height:26px; font-size:13px; }
    .mw-left .mw-cal-head .t { font-size:14px; }
    .mw-left .mw-ev { font-size:10.5px; }
    .mw-follow-list { flex:1 1 0; min-height:150px; overflow-y:auto; padding-right:6px; line-height:1.45; font-size:12.5px; }
    .mw-follow-list .helper-text { font-size:12px; }
    .mw-ann-card #mywork-ann { display:flex; flex-direction:column; gap:8px; }
    .mw-ann-card .ann-group-box, .mw-ann-card .ann-row-btn { width:100%; }
    .mw-scope-toggle { display:inline-flex; padding:3px; background:var(--surface-2); border-radius:10px; margin-bottom:12px; gap:2px; }
    .mw-scope-toggle button { border:none; background:transparent; padding:6px 14px; border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; color:var(--text-muted); }
    .mw-scope-toggle button.active { background:var(--surface); color:var(--brand,#0d9488); box-shadow:0 1px 3px rgba(0,0,0,.1); }
    .mw-scope-toggle button:hover:not(.active) { color:var(--text); }
    .mw-tile { display:flex; align-items:center; gap:12px; padding:14px 16px; border:1px solid var(--border,#e5e7eb); border-radius:14px; background:var(--surface); margin-bottom:16px; }
    .mw-tile .num { font-size:30px; font-weight:800; color:var(--brand,#0d9488); line-height:1; }
    .mw-act { font-size:13px; padding:7px 0; border-bottom:1px solid var(--border,#f1f5f9); display:flex; gap:8px; align-items:flex-start; }
    .mw-act:last-child { border-bottom:none; }
    .mw-act-time { flex:0 0 auto; font-size:11.5px; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap;
      background:rgba(13,148,136,.12); color:#0d9488; }
    .mw-act-text { flex:1; min-width:0; word-break:break-word; }
    .mw-act-meta { flex:0 0 auto; text-align:right; font-size:12px; color:var(--text-muted,#6b7280); white-space:nowrap; }
    .mw-board-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; gap:10px; }
    .mw-board-head h3 { margin:0; display:flex; align-items:center; gap:6px; }
    .mw-board-head .btn-sm { padding:5px 12px; font-size:13px; }
    .mw-act-scroll { max-height:132px; overflow-y:auto; padding-right:6px; }
    .mw-act-more { margin-top:4px; text-align:center; font-size:11.5px; color:var(--text-muted,#6b7280); min-height:14px;
      white-space:nowrap; letter-spacing:normal; word-spacing:normal; }
    .mw-daydetail-ev { background:var(--surface-2); border:1px solid var(--border,#e5e7eb); border-radius:var(--radius-sm,8px); padding:10px 12px; margin-bottom:8px; transition:border-color .15s ease; }
    .mw-daydetail-ev:hover { border-color:var(--brand,#0d9488); }
    .mw-ev-content { font-size:14.5px; font-weight:600; color:var(--text); line-height:1.5; }
    .mw-daydetail-ev .meta { font-size:12px; color:var(--text-muted,#6b7280); margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .mw-ev-tag-group { display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden; }
    .mw-ev-tag { flex:0 0 auto; font-size:11.5px; font-weight:700; padding:2px 9px; border-radius:999px; background:#e0f2fe; color:#075985; white-space:nowrap; }
    .mw-ev-tag.proj { background:#dcfce7; color:#15803d; }
    .mw-ev-creator { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mw-ev-actions { flex:0 0 auto; display:flex; gap:2px; }
    .mw-ev-actions .btn-link { padding:2px 6px; font-size:12.5px; text-decoration:none; }
    .mw-ev-actions .btn-link:hover { text-decoration:underline; }
    .mw-ev-actions .mw-ev-del { color:var(--danger,#dc2626); }
    .mw-ev-time { font-size:11.5px; font-weight:700; padding:1px 7px; border-radius:6px; background:var(--surface-2,#f1f5f9); color:var(--text-muted,#6b7280); }
    .mw-add-row { display:flex; gap:8px; }
    .mw-add-row select { flex:1.5; margin-bottom:8px; }
    .mw-add-row input[type=time] { flex:1; margin-bottom:8px; }
    @media (max-width:480px) { .mw-add-row { flex-direction:column; gap:0; } }
    .mw-ev-important-row { display:flex; align-items:flex-start; gap:8px; cursor:pointer; margin-top:8px; font-size:13px; font-weight:600; color:var(--text); text-transform:none; letter-spacing:normal; }
    .mw-ev-important-row input[type=checkbox] { width:auto; margin-top:2px; accent-color:var(--brand,#0d9488); }
    .mw-ev-important-row .helper-text { font-weight:400; }
  `;
  document.head.appendChild(s);
}

async function goToMyWork() {
  setActiveNav("mywork");
  showView("view-mywork");
  myWorkEnsureStyle();
  if (!myWorkState.month) {
    const d = new Date();
    myWorkState.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  setupAnnouncementButton();
  loadAnnouncementBanner();
  await loadMyWork();
  myWorkStartPolling();
}

async function loadMyWork() {
  const body = document.getElementById("mywork-body");
  if (body && !myWorkState.data) body.innerHTML = `<div class="empty-state">載入中...</div>`;
  try {
    myWorkState.data = await api(`/dashboard/my-work?month=${myWorkState.month}&scope=${myWorkState.scope}`);
  } catch (e) {
    if (body) body.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  renderMyWork();
}

function myWorkMonthShift(delta) {
  const [y, m] = myWorkState.month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  myWorkState.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  loadMyWork();
}

function renderMyWork() {
  const body = document.getElementById("mywork-body");
  if (!body) return;
  const d = myWorkState.data;

  const eventsByDate = {};
  (d.calendar_events || []).forEach((e) => {
    (eventsByDate[e.event_date] = eventsByDate[e.event_date] || []).push(e);
  });

  const [y, m] = myWorkState.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayIso = d.today;

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const dd = new Date(y, m - 1, 1 - (startDow - i));
    cells.push({ date: dd, other: true });
  }
  for (let day = 1; day <= daysInMonth; day++) cells.push({ date: new Date(y, m - 1, day), other: false });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), other: true });
  }

  const iso = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

  const dow = ["日", "一", "二", "三", "四", "五", "六"];
  const ic = (inner, w = 2) =>
    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const IC = {
    bell: ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    people: ic('<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5.2a3.2 3.2 0 0 1 0 5.6M18.5 14a5.5 5.5 0 0 1 3 5"/>'),
    mega: ic('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/>'),
    chev: ic('<path d="M9 6l6 6-6 6"/>', 2.4),
    arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.4),
    cal: ic('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
    caret: ic('<path d="M6 9l6 6 6-6"/>', 2.4),
    left: ic('<path d="M15 6l-6 6 6 6"/>', 2.4),
  };

  const calCells = cells
    .map((c) => {
      const key = iso(c.date);
      const evs = eventsByDate[key] || [];
      const dots =
        evs.slice(0, 4).map((e) => `<i class="mwd-dot ${e.is_important ? "imp" : e.project_id ? "proj" : "me"}"></i>`).join("") +
        (evs.length > 4 ? `<b class="mwd-more">+${evs.length - 4}</b>` : "");
      const tip = evs.map((e) => `${fmtEventTime(e.event_time) ? fmtEventTime(e.event_time) + " " : ""}${e.content}`).join("\n");
      const dw = c.date.getDay();
      return `<div class="mwd-day ${c.other ? "other" : ""} ${key === todayIso ? "today" : ""} ${dw === 0 ? "sun" : dw === 6 ? "sat" : ""}" data-mw-day="${key}"${tip ? ` title="${escapeHtml(tip)}"` : ""}>
        <span class="mwd-dn">${c.date.getDate()}</span><span class="mwd-dots">${dots}</span>
      </div>`;
    })
    .join("");

  const isTeam = myWorkState.scope === "team";
  const AV = ["#14b8a6", "#3b82f6", "#8b5cf6", "#f59e0b", "#22c55e", "#ec4899"];
  const followRows = d.today_followups || [];
  const followItem = (f, i) =>
    `<div class="mwd-fi"><span class="mwd-av" style="--c:${AV[i % AV.length]}">${escapeHtml((f.landowner_name || "?").trim().charAt(0))}</span><span class="mwd-fi-name">${escapeHtml(f.landowner_name)}</span><span class="mwd-fi-sub">— ${escapeHtml(f.project_name)}${f.staff_name ? ` · ${escapeHtml(f.staff_name)}` : ""}</span></div>`;
  const followList = followRows.map(followItem).join("") || `<div class="mwd-empty">${isTeam ? "今天團隊還沒有聯絡紀錄" : "今天還沒有聯絡紀錄"}</div>`;

  // 提醒事項:今天的行事曆待辦 + 各階段未完成任務。「第N階段」的 N 當成左邊的編號徽章。
  const acts = d.today_activities || [];
  const actRow = (a) => {
    const mm = /第\s*(\d+)\s*階段/.exec(a.action || "");
    const isStage = !!mm;
    const timeText = fmtEventTime(a.event_time);
    const tone = a.is_important || (isStage && mm[1] === "1") ? "red" : "blue";
    return `<div class="mwd-ar">
      <span class="mwd-ar-no ${tone}">${isStage ? mm[1] : timeText ? "⏰" : "•"}</span>
      <div class="mwd-ar-main"><div class="mwd-ar-t">${a.is_important ? "⭐ " : ""}${escapeHtml(a.action)}</div>${
      a.project_name || a.user_name || timeText
        ? `<div class="mwd-ar-s">${timeText ? `${escapeHtml(timeText)} · ` : ""}${escapeHtml(a.project_name || "")}${a.user_name ? `${a.project_name ? " · " : ""}${escapeHtml(a.user_name)}` : ""}</div>`
        : ""
    }</div>
      <span class="mwd-pill ${tone}">${isStage ? "待完成" : "待辦"}</span>
    </div>`;
  };
  const actList = acts.length
    ? `<div class="mwd-scroll mwd-act-scroll">${acts.map(actRow).join("")}</div>`
    : `<div class="mwd-empty">今天沒有排定的提醒 —— 點左邊行事曆任一天新增</div>`;

  body.innerHTML = `
    <div class="mwd-grid">
      <div class="mwd-left">
        <div class="mwd-card mwd-cal-card">
          <div class="mwd-cal-head">
            <div class="mwd-cal-title">${y} 年 ${m} 月</div>
            <div class="mwd-cal-nav">
              <button type="button" id="mw-prev" aria-label="上個月">${IC.left}</button>
              <button type="button" id="mw-today-btn" title="回到本月">今天</button>
              <button type="button" id="mw-next" aria-label="下個月">${IC.chev}</button>
            </div>
            <button type="button" class="mwd-month-pick" id="mw-month-pick">${IC.cal}<span>${y} 年 ${m} 月</span>${IC.caret}<input type="month" id="mw-month-input" value="${myWorkState.month}" tabindex="-1" aria-hidden="true"></button>
          </div>
          <div class="mwd-cal">
            ${dow.map((x, i) => `<div class="mwd-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${x}</div>`).join("")}
            ${calCells}
          </div>
          <div class="mwd-legend">
            <span><i class="mwd-dot proj"></i>案件共用</span><span><i class="mwd-dot me"></i>個人</span><span><i class="mwd-dot imp"></i>重要待辦</span><span><i class="mwd-dot none"></i>無事項</span>
            <em class="mwd-tag">每一步,都是都更更近的一步<svg viewBox="0 0 160 10" aria-hidden="true"><path d="M2 7C40 1 100 1 158 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></em>
          </div>
        </div>
        <div class="mwd-card mwd-tile" id="mwd-tile">
          <span class="mwd-tile-ic">${IC.people}</span>
          <span class="mwd-tile-num">${d.today_followup_count}</span>
          <span class="mwd-tile-sep"></span>
          <div class="mwd-tile-txt"><b>今日跟進地主</b><small>${isTeam ? "今天團隊新增聯絡紀錄的地主人數" : "今天你新增聯絡紀錄的地主人數"}</small></div>
          <svg class="mwd-tile-art" viewBox="0 0 90 60" aria-hidden="true"><rect x="4" y="38" width="14" height="20" rx="3"/><rect x="26" y="26" width="14" height="32" rx="3"/><rect x="48" y="14" width="14" height="44" rx="3"/><rect x="70" y="2" width="14" height="56" rx="3"/></svg>
        </div>
      </div>
      <div class="mwd-right">
        <div class="mw-scope-toggle" id="mw-scope-toggle">
          <button type="button" data-scope="personal" class="${isTeam ? "" : "active"}">👤 個人</button>
          <button type="button" data-scope="team" class="${isTeam ? "active" : ""}">👥 案件團隊</button>
        </div>
        <div class="mwd-card mwd-act-card">
          <div class="mwd-ch"><span class="mwd-ch-ic teal">${IC.bell}</span><h3>提醒事項</h3><span class="mwd-ch-meta">今日提醒 <b>${acts.length}</b></span></div>
          ${actList}
        </div>
        <div class="mwd-pair">
          <div class="mwd-card mwd-follow-card" id="mwd-follow-card">
            <div class="mwd-ch"><span class="mwd-ch-ic teal">${IC.people}</span><h3>今日跟進名單</h3><span class="mwd-ch-meta">共 <b>${followRows.length}</b> 人</span></div>
            <div class="mwd-scroll mwd-follow-list">${followList}</div>
          </div>
          <div class="mwd-card mwd-ann-card">
            <div class="mwd-ch"><span class="mwd-ch-ic orange">${IC.mega}</span><h3>公告</h3><span class="mwd-ch-meta chip" id="mwd-ann-count"></span></div>
            <div class="mwd-scroll" id="mywork-ann"></div>
          </div>
        </div>
      </div>
    </div>`;
  if (typeof loadAnnouncementBanner === "function") loadAnnouncementBanner();

  document.getElementById("mw-scope-toggle").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.scope === myWorkState.scope) return;
      myWorkState.scope = btn.dataset.scope;
      loadMyWork();
    });
  });

  document.getElementById("mw-prev").onclick = () => myWorkMonthShift(-1);
  document.getElementById("mw-next").onclick = () => myWorkMonthShift(1);
  document.getElementById("mw-today-btn").onclick = () => {
    const n = new Date();
    myWorkState.month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    loadMyWork();
  };
  // 月份下拉:點整顆鈕就開原生月份選擇器
  const monthInput = document.getElementById("mw-month-input");
  document.getElementById("mw-month-pick").onclick = () => {
    try { monthInput.showPicker(); } catch (e) { monthInput.focus(); monthInput.click(); }
  };
  monthInput.onchange = () => {
    if (/^\d{4}-\d{2}$/.test(monthInput.value)) {
      myWorkState.month = monthInput.value;
      loadMyWork();
    }
  };
  body.querySelectorAll("[data-mw-day]").forEach((el) => {
    el.addEventListener("click", () => openMyWorkDay(el.dataset.mwDay, eventsByDate[el.dataset.mwDay] || []));
  });
}

function openMyWorkDay(dateIso, events) {
  const opts = myWorkState.data.project_options || [];
  const projectSelect = `
    <select id="mw-ev-project">
      <option value="">個人（只有自己看得到）</option>
      ${opts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（案件成員共用）</option>`).join("")}
    </select>`;

  const existing = events
    .map(
      (e) => `
    <div class="mw-daydetail-ev" data-ev-id="${e.id}">
      <div class="mw-ev-content" style="white-space:pre-wrap">${fmtEventTime(e.event_time) ? `<span class="mw-ev-time">${fmtEventTime(e.event_time)}</span> ` : ""}${e.is_important ? "⭐ " : ""}${escapeHtml(e.content)}</div>
      <div class="meta">
        <div class="mw-ev-tag-group">
          <span class="mw-ev-tag${e.project_name ? " proj" : ""}">${e.project_name ? escapeHtml(e.project_name) : "個人"}</span>
          ${e.created_by_name ? `<span class="mw-ev-creator">${escapeHtml(e.created_by_name)}</span>` : ""}
        </div>
        ${
          e.can_edit
            ? `<div class="mw-ev-actions"><a href="#" class="btn-link" data-mw-edit="${e.id}">編輯</a><a href="#" class="btn-link mw-ev-del" data-mw-del="${e.id}">刪除</a></div>`
            : ""
        }
      </div>
    </div>`
    )
    .join("");

  openModal(
    `${dateIso} 待辦`,
    `
    <div>
      ${existing || `<p class="helper-text" style="margin-top:0">這天還沒有待辦</p>`}
      <hr style="border:none;border-top:1px solid var(--border,#e5e7eb);margin:12px 0">
      <div class="field">
        <label>新增待辦</label>
        <div class="mw-add-row">
          ${projectSelect}
          <input type="time" id="mw-ev-time" title="時間(選填)">
        </div>
        <textarea id="mw-ev-text" rows="3" placeholder="這天要做什麼..."></textarea>
        <label class="mw-ev-important-row">
          <input type="checkbox" id="mw-ev-important">
          <span>標記為重要 <span class="helper-text">(會出現在今日重要待辦鈴鐺提醒)</span></span>
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">關閉</button>
        <button type="button" class="btn-primary" id="mw-ev-add">新增</button>
      </div>
    </div>`
  );

  document.getElementById("mw-ev-add").onclick = async () => {
    const content = document.getElementById("mw-ev-text").value.trim();
    if (!content) return;
    const pidRaw = document.getElementById("mw-ev-project").value;
    const isImportant = document.getElementById("mw-ev-important").checked;
    const eventTime = document.getElementById("mw-ev-time").value || null;
    try {
      await api("/dashboard/calendar", {
        method: "POST",
        body: {
          event_date: dateIso,
          event_time: eventTime,
          content,
          project_id: pidRaw ? Number(pidRaw) : null,
          is_important: isImportant,
        },
      });
      toast("已新增", "success");
      closeModal();
      await loadMyWork();
      if (typeof refreshReminderBell === "function") refreshReminderBell();
    } catch (e) {}
  };

  document.querySelectorAll("[data-mw-del]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm("確定刪除這則待辦?")) return;
      try {
        await api(`/dashboard/calendar/${a.dataset.mwDel}`, { method: "DELETE" });
        toast("已刪除", "success");
        closeModal();
        await loadMyWork();
        if (typeof refreshReminderBell === "function") refreshReminderBell();
      } catch (err) {}
    });
  });

  document.querySelectorAll("[data-mw-edit]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const wrap = a.closest(".mw-daydetail-ev");
      const cur = events.find((x) => String(x.id) === a.dataset.mwEdit);
      const box = wrap.querySelector(".mw-ev-content");
      box.innerHTML = `<input type="time" class="mw-ev-edit-time" style="margin-bottom:6px" value="${fmtEventTime(cur.event_time)}" title="時間(選填)">
        <textarea rows="3" style="width:100%">${escapeHtml(cur.content)}</textarea>
        <div style="margin-top:6px;display:flex;gap:8px">
          <button type="button" class="btn-primary btn-sm" data-mw-save="${cur.id}">儲存</button>
        </div>`;
      box.querySelector("[data-mw-save]").addEventListener("click", async () => {
        const val = box.querySelector("textarea").value.trim();
        if (!val) return;
        const timeVal = box.querySelector(".mw-ev-edit-time").value;
        try {
          await api(`/dashboard/calendar/${cur.id}`, {
            method: "PATCH",
            body: timeVal ? { content: val, event_time: timeVal } : { content: val, clear_event_time: true },
          });
          toast("已更新", "success");
          closeModal();
          await loadMyWork();
        } catch (err) {}
      });
    });
  });
}

function initMyWork() {}

// 拿掉手動「重新整理」按鈕,改成停留在這頁時每 30 秒自己默默刷新一次(有新的跟進/
// 操作紀錄不用手動點才看得到)。離開這頁(切到別的畫面)就停止輪詢,不浪費請求。
function myWorkStartPolling() {
  myWorkStopPolling();
  myWorkState.pollTimer = setInterval(() => {
    const view = document.getElementById("view-mywork");
    if (!view || view.classList.contains("hidden")) {
      myWorkStopPolling();
      return;
    }
    loadMyWork();
  }, 30000);
}
function myWorkStopPolling() {
  if (myWorkState.pollTimer) {
    clearInterval(myWorkState.pollTimer);
    myWorkState.pollTimer = null;
  }
}
