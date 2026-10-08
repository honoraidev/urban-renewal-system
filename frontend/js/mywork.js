"use strict";

const MWN_ICON = {
  cal: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="3" fill="currentColor"/><rect x="2" y="6" width="20" height="16" rx="1" fill="currentColor"/><g fill="#fff"><rect x="4" y="9" width="3" height="3"/><rect x="8.5" y="9" width="3" height="3"/><rect x="13" y="9" width="3" height="3"/><rect x="17.5" y="9" width="2.5" height="3"/><rect x="4" y="13.5" width="3" height="3"/><rect x="8.5" y="13.5" width="3" height="3"/><rect x="13" y="13.5" width="3" height="3"/><rect x="17.5" y="13.5" width="2.5" height="3"/><rect x="4" y="18" width="3" height="2.5"/><rect x="8.5" y="18" width="3" height="2.5"/><rect x="13" y="18" width="3" height="2.5"/></g></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21a8.5 6.5 0 0 1 17 0z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z"/></svg>`,
};
const MWN_TIME_OPTS = (() => {
  // 每 15 分鐘一格(00:00 ~ 23:45)
  let h = "";
  for (let i = 0; i < 96; i++) {
    const hh = Math.floor(i / 4), mm = String((i % 4) * 15).padStart(2, "0");
    const label = `${hh < 12 ? "上午" : "下午"} ${String(hh % 12 === 0 ? 12 : hh % 12).padStart(2, "0")}:${mm}`;
    h += `<option value="${String(hh).padStart(2, "0")}:${mm}">${label}</option>`;
  }
  return h;
})();

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

// 當日行事曆:左邊視窗列出當天事項 + 「新增行事曆活動」鈕;按新增 / 編輯 → 右邊並排開表單視窗
function openMyWorkDay(dateIso, events) {
  const opts = myWorkState.data.project_options || [];
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  const dow = WD[new Date(`${dateIso}T00:00:00`).getDay()];
  const p2 = (n) => String(n).padStart(2, "0");

  const cardHtml = (e) => {
    const t = fmtEventTime(e.event_time);
    const range = t ? `${t}${e.event_end_time ? " - " + fmtEventTime(e.event_end_time) : ""}` : "全天";
    const head = e.title || e.content;
    const body = e.title && e.content && e.content !== e.title ? e.content : "";
    return `<div class="mwd2-card" data-ev-id="${e.id}">
      <div class="mwd2-top">
        <span class="mwd2-ico">${MWN_ICON.cal}</span>
        <div class="mwd2-main">
          <div class="mwd2-t">${e.is_important ? "⭐ " : ""}${escapeHtml(head)}</div>
          ${body ? `<div class="mwd2-b">${escapeHtml(body)}</div>` : ""}
        </div>
        <span class="mwd2-tag${e.project_name ? " proj" : ""}">${e.project_name ? escapeHtml(e.project_name) : "個人"}</span>
      </div>
      <div class="mwd2-time"><span class="mwd2-clock">${MWN_ICON.clock}</span>${escapeHtml(range)}${e.notify ? ' <span class="mwd2-push">📲 LINE 推播</span>' : ""}<span class="mwd2-by">${e.created_by_name ? escapeHtml(e.created_by_name) : ""}</span></div>
      <div class="mwd2-foot">
        ${e.can_edit ? `<span class="mwd2-act"><a href="#" data-mw-edit="${e.id}">編輯</a><a href="#" class="del" data-mw-del="${e.id}">刪除</a></span>` : ""}
      </div>
    </div>`;
  };

  openModal(
    `<span class="mwn-title"><span class="mwn-title-ic">${MWN_ICON.cal}</span>當日行事曆</span>`,
    `<div class="mwd2">
      <div class="mwd2-head"><span class="mwd2-date">${dateIso} (${dow})</span><span class="mwd2-count">${events.length} 筆事項</span></div>
      <div class="mwd2-list">${events.length ? events.map(cardHtml).join("") : '<div class="mwd2-empty">這天還沒有待辦</div>'}</div>
      <button type="button" class="mwd2-add" id="mw-day-add"><span>＋</span> 新增行事曆活動</button>
    </div>`,
    { width: "440px" }
  );

  // ---- 右側表單視窗(新增 / 編輯共用)----
  const openForm = (cur) => {
    const editing = !!cur;
    const projectSelect = `<select id="mw-ev-project" ${editing ? "disabled" : ""}>
      <option value="">個人（只有自己看得到）</option>
      ${opts.map((p) => `<option value="${p.id}" ${editing && cur.project_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}（案件成員共用）</option>`).join("")}
    </select>`;
    const panel = openSidePanel(
      `<span class="mwn-title"><span class="mwn-title-ic">${MWN_ICON.cal}</span>${editing ? "編輯行事曆活動" : "新增行事曆活動"}</span>`,
      `<div class="mwn">
        <div class="mwn-date">${dateIso} (${dow})</div>
        <div class="mwn-time">
          <span class="mwn-ic">${MWN_ICON.clock}</span>
          <input type="time" id="mw-ev-start" class="mwn-sel" step="60">
          <span class="mwn-dash">-</span>
          <input type="time" id="mw-ev-end" class="mwn-sel" step="60">
          <label class="mwn-allday"><input type="checkbox" id="mw-ev-allday"> 全天</label>
        </div>
        <div class="mwn-label">標題</div>
        <input id="mw-ev-title" class="mwn-title-in" maxlength="120" placeholder="請輸入標題..." autocomplete="off" value="${editing ? escapeHtml(cur.title || "") : ""}">
        <div class="mwn-label">這天要做什麼</div>
        <textarea id="mw-ev-text" rows="4" placeholder="請輸入內容...">${editing ? escapeHtml(cur.content && cur.content !== cur.title ? cur.content : cur.title ? "" : cur.content) : ""}</textarea>
        <div class="mwn-proj"><span class="mwn-ic">${MWN_ICON.person}</span>${projectSelect}</div>
        <label class="mwn-notify">
          <input type="checkbox" id="mw-ev-notify" ${editing && cur.notify ? "checked" : ""}>
          <span>需要 <b>官方LINE</b> 推播 <small>(每天早上 9 點推播今日待辦;當天才新增的,在設定時間前 2 小時推播)</small></span>
        </label>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" id="mw-ev-cancel">取消</button>
          <button type="button" class="btn-primary" id="mw-ev-save">${editing ? "儲存" : "新增"}</button>
        </div>
      </div>`,
      { width: "460px" }
    );

    // 「重要」星號放在視窗標題列、叉叉左邊(原本的「標記為重要」)
    let important = editing ? !!cur.is_important : false;
    const x = panel.querySelector("#modal-side-close-btn");
    x.style.display = "none"; // 右側表單視窗不要叉叉,關閉只靠下方「取消」
    x.insertAdjacentHTML("beforebegin", `<button type="button" class="mwn-star${important ? " on" : ""}" id="mw-ev-star" aria-pressed="${important}" title="標記為重要(會出現在今日重要待辦鈴鐺提醒)">${MWN_ICON.star}</button>`);
    panel.querySelector("#mw-ev-star").onclick = (e) => {
      important = !important;
      e.currentTarget.classList.toggle("on", important);
      e.currentTarget.setAttribute("aria-pressed", String(important));
    };
    panel.querySelector("#mw-ev-cancel").onclick = () => closeSidePanel();

    const startSel = panel.querySelector("#mw-ev-start");
    const endSel = panel.querySelector("#mw-ev-end");
    const allDay = panel.querySelector("#mw-ev-allday");
    const hhmm = (m) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
    if (editing) {
      if (cur.event_time) {
        startSel.value = fmtEventTime(cur.event_time);
        endSel.value = cur.event_end_time ? fmtEventTime(cur.event_end_time) : "";
      } else allDay.checked = true;
    } else {
      // 預設帶入「現在時間」當開始,結束 = 開始 + 1 小時(最晚 23:59)
      const n = new Date();
      const s = n.getHours() * 60 + n.getMinutes();
      startSel.value = hhmm(s);
      endSel.value = hhmm(Math.min(s + 60, 23 * 60 + 59));
    }
    const syncAllDay = () => {
      startSel.disabled = endSel.disabled = allDay.checked;
      panel.querySelector(".mwn-time").classList.toggle("off", allDay.checked);
    };
    allDay.onchange = syncAllDay;
    syncAllDay();
    startSel.onchange = () => {
      if (!endSel.value || endSel.value <= startSel.value) {
        const [h, m] = startSel.value.split(":").map(Number);
        endSel.value = hhmm(Math.min(h * 60 + m + 60, 23 * 60 + 59));
      }
    };

    panel.querySelector("#mw-ev-save").onclick = async () => {
      const evTitle = panel.querySelector("#mw-ev-title").value.trim();
      const content = panel.querySelector("#mw-ev-text").value.trim() || evTitle;
      if (!content) { toast("請輸入標題或內容", "error"); return; }
      if (!allDay.checked && !startSel.value) { toast("請選擇開始時間,或勾選全天", "error"); return; }
      const eventTime = allDay.checked ? null : startSel.value;
      const eventEndTime = allDay.checked ? null : endSel.value || null;
      if (eventTime && eventEndTime && eventEndTime <= eventTime) { toast("結束時間必須晚於開始時間", "error"); return; }
      const wantNotify = panel.querySelector("#mw-ev-notify").checked;
      try {
        if (editing) {
          await api(`/dashboard/calendar/${cur.id}`, {
            method: "PATCH",
            body: {
              title: evTitle,
              content,
              is_important: important,
              notify: wantNotify,
              ...(eventTime ? { event_time: eventTime, event_end_time: eventEndTime } : { clear_event_time: true }),
            },
          });
          toast("已更新", "success");
        } else {
          const pidRaw = panel.querySelector("#mw-ev-project").value;
          await api("/dashboard/calendar", {
            method: "POST",
            body: {
              event_date: dateIso,
              event_time: eventTime,
              event_end_time: eventEndTime,
              title: evTitle || null,
              content,
              project_id: pidRaw ? Number(pidRaw) : null,
              is_important: important,
              notify: wantNotify,
            },
          });
          toast("已新增", "success");
        }
        closeModal();
        await loadMyWork();
        if (typeof refreshReminderBell === "function") refreshReminderBell();
      } catch (e) {}
    };
  };

  document.getElementById("mw-day-add").onclick = () => openForm(null);

  document.querySelectorAll("[data-mw-edit]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const cur = events.find((x) => String(x.id) === a.dataset.mwEdit);
      if (cur) openForm(cur);
    });
  });

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
