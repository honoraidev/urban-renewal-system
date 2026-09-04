"use strict";

const myWorkState = { month: null, data: null };

function myWorkEnsureStyle() {
  if (document.getElementById("mywork-style")) return;
  const s = document.createElement("style");
  s.id = "mywork-style";
  s.textContent = `
    .mw-grid { display:grid; grid-template-columns: 1.4fr 1fr; gap:20px; align-items:start; }
    @media (max-width: 980px){ .mw-grid { grid-template-columns: 1fr; } }
    .mw-card { background:var(--bg-card,#fff); border:1px solid var(--border,#e5e7eb); border-radius:14px; padding:16px; }
    .mw-card h3 { margin:0 0 12px; font-size:15px; }
    .mw-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .mw-cal-head .t { font-weight:700; font-size:15px; }
    .mw-cal-nav button { border:1px solid var(--border,#e5e7eb); background:transparent; border-radius:8px; width:30px; height:30px; cursor:pointer; }
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
    .mw-tile { display:flex; align-items:center; gap:12px; padding:14px 16px; border:1px solid var(--border,#e5e7eb); border-radius:14px; background:var(--bg-card,#fff); margin-bottom:16px; }
    .mw-tile .num { font-size:30px; font-weight:800; color:var(--brand,#0d9488); line-height:1; }
    .mw-act { font-size:13px; padding:7px 0; border-bottom:1px solid var(--border,#f1f5f9); display:flex; gap:10px; }
    .mw-act:last-child { border-bottom:none; }
    .mw-act .tm { color:var(--text-muted,#6b7280); white-space:nowrap; font-variant-numeric:tabular-nums; }
    .mw-daydetail-ev { border:1px solid var(--border,#e5e7eb); border-radius:8px; padding:8px 10px; margin-bottom:8px; }
    .mw-daydetail-ev .meta { font-size:12px; color:var(--text-muted,#6b7280); margin-top:4px; display:flex; gap:8px; }
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
}

async function loadMyWork() {
  const body = document.getElementById("mywork-body");
  if (body && !myWorkState.data) body.innerHTML = `<div class="empty-state">載入中...</div>`;
  try {
    myWorkState.data = await api(`/dashboard/my-work?month=${myWorkState.month}`);
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
            `<div class="mw-ev ${e.project_id ? "proj" : ""}" title="${escapeHtml(e.content)}">${escapeHtml(
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

  const followList = (d.today_followups || [])
    .map((f) => `<div>· ${escapeHtml(f.landowner_name)}<span class="helper-text"> — ${escapeHtml(f.project_name)}</span></div>`)
    .join("") || `<div class="helper-text">今天還沒有聯絡紀錄</div>`;

  const actList = (d.today_activities || []).length
    ? d.today_activities
        .map((a) => {
          const t = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(a.created_at) ? a.created_at : a.created_at + "Z");
          const hm = isNaN(t) ? "" : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
          return `<div class="mw-act"><span class="tm">${hm}</span><span>${escapeHtml(a.action)}${
            a.project_name ? `<span class="helper-text"> · ${escapeHtml(a.project_name)}</span>` : ""
          }</span></div>`;
        })
        .join("")
    : `<div class="helper-text">今天還沒有操作紀錄</div>`;

  body.innerHTML = `
    <div class="mw-grid">
      <div class="mw-card">
        <div class="mw-cal-head">
          <div class="t">${y} 年 ${m} 月</div>
          <div class="mw-cal-nav">
            <button type="button" id="mw-prev">‹</button>
            <button type="button" id="mw-today-btn" title="回到本月">·</button>
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
        <div class="mw-tile">
          <div class="num">${d.today_followup_count}</div>
          <div>
            <div style="font-weight:700">今日跟進地主</div>
            <div class="helper-text">今天你新增聯絡紀錄的地主人數</div>
          </div>
        </div>
        <div class="mw-card" style="margin-bottom:16px">
          <h3>今日跟進名單</h3>
          ${followList}
        </div>
        <div class="mw-card">
          <h3>今日操作紀錄</h3>
          ${actList}
        </div>
      </div>
    </div>`;

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
}

function openMyWorkDay(dateIso, events) {
  const opts = myWorkState.data.project_options || [];
  const projectSelect = `
    <select id="mw-ev-project" style="margin-bottom:8px">
      <option value="">個人（只有自己看得到）</option>
      ${opts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（案件成員共用）</option>`).join("")}
    </select>`;

  const existing = events
    .map(
      (e) => `
    <div class="mw-daydetail-ev" data-ev-id="${e.id}">
      <div class="mw-ev-content" style="white-space:pre-wrap">${escapeHtml(e.content)}</div>
      <div class="meta">
        <span>${e.project_name ? "🟢 " + escapeHtml(e.project_name) : "🔵 個人"}</span>
        ${e.created_by_name ? `<span>· ${escapeHtml(e.created_by_name)}</span>` : ""}
        ${
          e.can_edit
            ? `<a href="#" data-mw-edit="${e.id}">編輯</a><a href="#" data-mw-del="${e.id}" style="color:var(--danger,#dc2626)">刪除</a>`
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
        ${projectSelect}
        <textarea id="mw-ev-text" rows="3" placeholder="這天要做什麼..."></textarea>
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
    try {
      await api("/dashboard/calendar", {
        method: "POST",
        body: { event_date: dateIso, content, project_id: pidRaw ? Number(pidRaw) : null },
      });
      toast("已新增", "success");
      closeModal();
      await loadMyWork();
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
      } catch (err) {}
    });
  });

  document.querySelectorAll("[data-mw-edit]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const wrap = a.closest(".mw-daydetail-ev");
      const cur = events.find((x) => String(x.id) === a.dataset.mwEdit);
      const box = wrap.querySelector(".mw-ev-content");
      box.innerHTML = `<textarea rows="3" style="width:100%">${escapeHtml(cur.content)}</textarea>
        <div style="margin-top:6px;display:flex;gap:8px">
          <button type="button" class="btn-primary btn-sm" data-mw-save="${cur.id}">儲存</button>
        </div>`;
      box.querySelector("[data-mw-save]").addEventListener("click", async () => {
        const val = box.querySelector("textarea").value.trim();
        if (!val) return;
        try {
          await api(`/dashboard/calendar/${cur.id}`, { method: "PATCH", body: { content: val } });
          toast("已更新", "success");
          closeModal();
          await loadMyWork();
        } catch (err) {}
      });
    });
  });
}

function initMyWork() {
  const btn = document.getElementById("mywork-refresh-btn");
  if (btn) btn.addEventListener("click", loadMyWork);
}
