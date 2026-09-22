"use strict";

const myWorkState = { month: null, data: null, scope: "personal", pollTimer: null };

function myWorkEnsureStyle() {
  if (document.getElementById("mywork-style")) return;
  const s = document.createElement("style");
  s.id = "mywork-style";
  s.textContent = `
    .mw-grid { display:grid; grid-template-columns: 1.4fr 1fr; gap:20px; align-items:start; }
    @media (max-width: 980px){ .mw-grid { grid-template-columns: 1fr; } }
    .mw-card { background:var(--surface); border:1px solid var(--border,#e5e7eb); border-radius:14px; padding:16px; }
    .mw-card h3 { margin:0 0 12px; font-size:15px; }
    .mw-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
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
    .mw-cal { display:grid; grid-template-columns: repeat(7,1fr); gap:4px; }
    .mw-cal .dow { text-align:center; font-size:12px; color:var(--text-muted,#6b7280); padding:4px 0; }
    .mw-day { min-height:74px; border:1px solid var(--border,#eee); border-radius:8px; padding:4px 5px; cursor:pointer; background:var(--bg,#fff); overflow:hidden; }
    .mw-day:hover { border-color:var(--brand,#0d9488); }
    .mw-day.other { opacity:.35; }
    .mw-day.today { border-color:var(--brand,#0d9488); box-shadow:0 0 0 1px var(--brand,#0d9488) inset; }
    .mw-day .dn { font-size:12px; font-weight:600; }
    .mw-ev { font-size:11px; line-height:1.35; margin-top:2px; padding:1px 4px; border-radius:4px; background:#e0f2fe; color:#075985; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mw-ev.proj { background:#dcfce7; color:#15803d; }
    .mw-more { font-size:10px; color:var(--text-muted,#6b7280); margin-top:1px; }
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
    .mw-act-scroll { max-height:172px; overflow-y:auto; }
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
  const calCells = cells
    .map((c) => {
      const key = iso(c.date);
      const evs = eventsByDate[key] || [];
      const shown = evs
        .slice(0, 2)
        .map(
          (e) =>
            `<div class="mw-ev ${e.project_id ? "proj" : ""}" title="${escapeHtml(e.project_name ? `${e.content}(${e.project_name})` : e.content)}">${e.is_important ? "⭐" : ""}${escapeHtml(
              e.content
            )}</div>`
        )
        .join("");
      const more = evs.length > 2 ? `<div class="mw-more">+${evs.length - 2}</div>` : "";
      return `<div class="mw-day ${c.other ? "other" : ""} ${key === todayIso ? "today" : ""}" data-mw-day="${key}">
        <div class="dn">${c.date.getDate()}</div>${shown}${more}
      </div>`;
    })
    .join("");

  const isTeam = myWorkState.scope === "team";
  const followList = (d.today_followups || [])
    .map((f) => `<div>· ${escapeHtml(f.landowner_name)}<span class="helper-text"> — ${escapeHtml(f.project_name)}${
      f.staff_name ? ` · ${escapeHtml(f.staff_name)}` : ""
    }</span></div>`)
    .join("") || `<div class="helper-text">${isTeam ? "今天團隊還沒有聯絡紀錄" : "今天還沒有聯絡紀錄"}</div>`;

  // 「公告/進度通知」改成只顯示今天的行事曆待辦(不再是 activity_logs/project_notes
  // 合併的操作紀錄時間軸)- 例如行事曆填了「9/22 須聯絡林屋主 14:00」,今天這裡就
  // 顯示「14:00 聯絡林屋主」。要新增/編輯提醒一律到左邊行事曆點當天,這裡純顯示。
  const _acts = d.today_activities || [];
  const _actRow = (a) => {
    const timeText = fmtEventTime(a.event_time);
    return `<div class="mw-act">
      ${timeText ? `<span class="mw-act-time">${timeText}</span>` : ""}
      <span class="mw-act-text">${a.is_important ? "⭐ " : ""}${escapeHtml(a.action)}${
      a.project_name ? `<span class="helper-text"> · ${escapeHtml(a.project_name)}</span>` : ""
    }</span>
      <span class="mw-act-meta">${a.user_name ? escapeHtml(a.user_name) : ""}</span>
    </div>`;
  };
  // 卷軸式:全部列出來、用捲動看更多,不用「展開全部」按鈕 — 捲動區下方用
  // #mw-act-more 顯示「目前捲動位置以下還有幾則」,會隨捲動即時更新。
  const actList = !_acts.length
    ? `<div class="helper-text">今天沒有排定的提醒 —— 點左邊行事曆任一天新增</div>`
    : `<div class="mw-act-scroll" id="mw-act-scroll">${_acts.map(_actRow).join("")}</div>
       <div class="mw-act-more" id="mw-act-more"></div>`;

  body.innerHTML = `
    <div class="mw-grid">
      <div class="mw-card">
        <div class="mw-cal-head">
          <div class="t">${y} 年 ${m} 月</div>
          <div class="mw-cal-nav">
            <button type="button" id="mw-prev">‹</button>
            <button type="button" id="mw-today-btn" title="回到本月">今</button>
            <button type="button" id="mw-next">›</button>
          </div>
        </div>
        <div class="mw-cal">
          ${dow.map((x) => `<div class="dow">${x}</div>`).join("")}
          ${calCells}
        </div>
        <p class="helper-text" style="margin:10px 0 0">點任一天新增/編輯待辦。<span style="color:#15803d">■</span> 案件共用 <span style="color:#075985">■</span> 個人</p>
      </div>
      <div>
        <div class="mw-scope-toggle" id="mw-scope-toggle">
          <button type="button" data-scope="personal" class="${isTeam ? "" : "active"}">👤 個人</button>
          <button type="button" data-scope="team" class="${isTeam ? "active" : ""}">👥 案件團隊</button>
        </div>
        <div class="mw-tile">
          <div class="num">${d.today_followup_count}</div>
          <div>
            <div style="font-weight:700">今日跟進地主</div>
            <div class="helper-text">${isTeam ? "今天團隊新增聯絡紀錄的地主人數" : "今天你新增聯絡紀錄的地主人數"}</div>
          </div>
        </div>
        <div class="mw-card" style="margin-bottom:16px">
          <h3>今日跟進名單</h3>
          ${followList}
        </div>
        <div class="mw-card mw-board">
          <div class="mw-board-head">
            <h3>📋 提醒事項</h3>
            <span class="helper-text">今日提醒</span>
          </div>
          <div class="mw-board-body">${actList}</div>
        </div>
      </div>
    </div>`;

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
  body.querySelectorAll("[data-mw-day]").forEach((el) => {
    el.addEventListener("click", () => openMyWorkDay(el.dataset.mwDay, eventsByDate[el.dataset.mwDay] || []));
  });

  const actScroll = document.getElementById("mw-act-scroll");
  const actMore = document.getElementById("mw-act-more");
  if (actScroll && actMore) {
    const updateActMore = () => {
      // 捲到底了就直接算 0 則 —— 逐列用 offsetTop 比對在小數縮放(125%/150% 等瀏覽器
      // 縮放比例)下常常會因為 1px 內的誤差,捲到底了還是把最後一列算成「還沒看到」。
      if (actScroll.scrollTop + actScroll.clientHeight >= actScroll.scrollHeight - 2) {
        actMore.textContent = "";
        return;
      }
      const bottom = actScroll.scrollTop + actScroll.clientHeight;
      const remaining = [...actScroll.children].filter((row) => row.offsetTop + row.offsetHeight > bottom + 1).length;
      actMore.textContent = remaining > 0 ? `↓ 以下還有 ${remaining} 則` : "";
    };
    actScroll.addEventListener("scroll", updateActMore);
    updateActMore();
  }

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
