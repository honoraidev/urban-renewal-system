"use strict";

// 「案件總覽」—— 首頁「都更案件進度總覽」卡片點進去的獨立落地頁(view-project-overview,
// 見 dashboard.js goToProjectOverviewPage),跟側欄「案件管理」清單直接進的 SOP 進度分頁
// 頁面(view-project-detail)是不同畫面。全部資料都串真實 API,沒有後端資料可算的欄位
// (待辦事項)先留空狀態,不做假資料。

const OVERVIEW_RISK_LABEL = { low: "低", medium: "中", high: "高", "未設定": "未設定", "-": "—" };
const OVERVIEW_RISK_CLASS = { low: "ov-risk-low", medium: "ov-risk-medium", high: "ov-risk-high" };

const OVERVIEW_STAGE_STATUS_LABEL = {
  completed: "已完成",
  force_closed: "強制結案",
  in_progress: "進行中",
  pending: "未開始",
};

function overviewEnsureStyle() {
  if (document.getElementById("ov-style")) return;
  const s = document.createElement("style");
  s.id = "ov-style";
  s.textContent = `
    .ov-grid { display:flex; flex-direction:column; gap:22px; }
    .ov-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:22px; align-items:stretch; }
    .ov-row.ov-row-r2 { grid-template-columns: minmax(0,1fr) minmax(0,1.4fr); }
    .ov-row.ov-row-r3 { grid-template-columns: minmax(0,2.4fr) minmax(0,1fr); }
    @media (max-width:1100px) { .ov-row.ov-row-r2, .ov-row.ov-row-r3 { grid-template-columns: 1fr; } }
    /* 合併卡片:一張卡裡左右兩個區塊(各自有小標題),中間一條細分隔線 */
    .ov-card-merged { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.25fr); gap:0 26px; }
    .ov-card-merged > .ov-sec + .ov-sec { border-left:1px solid var(--border); padding-left:26px; }
    .ov-card-merged-even { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
    @media (max-width:760px) {
      .ov-card-merged, .ov-card-merged-even { grid-template-columns:1fr; }
      .ov-card-merged > .ov-sec + .ov-sec { border-left:none; padding-left:0; margin-top:22px; }
    }
    .ov-sec { min-width:0; }
    .ov-sec h3 { margin-top:0; }

    .ov-todo-zone + .ov-todo-zone { margin-top:16px; }
    .ov-todo-zone-head { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; margin-bottom:4px; }
    .ov-zone-tag { font-size:11px; font-weight:800; padding:2px 9px; border-radius:999px; }
    .ov-zone-tag.now { background:var(--brand-light); color:var(--brand-dark, var(--brand)); }
    .ov-zone-tag.next { background:var(--surface-2); color:var(--text-muted); }
    .ov-zone-stage { color:var(--text-muted); font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-zone-count { color:var(--text-muted); font-weight:600; font-size:11.5px; }
    .ov-todo-mark { flex:0 0 auto; width:15px; height:15px; margin:2px 8px 0 0; border-radius:50%; border:2px solid var(--border-strong, #cbd5d8); box-sizing:border-box; }
    .ov-todo-lead { display:flex; min-width:0; flex:1; }
    .ov-todo-body { min-width:0; }
    .ov-todo-chip { font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:6px; background:var(--surface-2); color:var(--text-muted); margin-left:6px; white-space:nowrap; }
    .ov-todo-empty { font-size:12.5px; color:var(--text-muted); padding:8px 0; }

    .ov-metric-delta { margin-top:6px; font-size:11.5px; font-weight:700; display:flex; justify-content:center; align-items:baseline; gap:5px; flex-wrap:wrap; }
    .ov-metric-delta .prev { font-weight:500; color:var(--text-muted); }
    .ov-metric-delta.good { color:var(--success); }
    .ov-metric-delta.bad { color:var(--danger); }
    .ov-metric-delta.flat { color:var(--text-muted); }
    .ov-stage-band { margin:22px 0; }
    .ov-card { background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:22px 24px;
      box-shadow:var(--shadow); transition:box-shadow .15s; }
    .ov-card:hover { box-shadow:var(--shadow-hover); }
    .ov-card-plain { background:transparent; border:none; box-shadow:none; }
    .ov-card-plain:hover { box-shadow:none; }
    .ov-card h3 { margin:0 0 16px; font-size:15.5px; font-weight:800; display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding-bottom:13px; border-bottom:1px solid var(--border); letter-spacing:.01em; }
    .ov-card h3 .helper-text { font-weight:400; }
    .ov-card-icon { width:28px; height:28px; border-radius:9px; background:var(--brand-light); color:var(--brand-dark);
      display:inline-flex; align-items:center; justify-content:center; font-size:14.5px; flex:0 0 auto; margin-right:2px; }
    .ov-card h3 > span:first-child { display:inline-flex; align-items:center; gap:10px; }
    .ov-todo-add-btn { width:26px; height:26px; border-radius:50%; border:none; background:var(--brand-light);
      color:var(--brand-dark); font-size:16px; font-weight:800; line-height:1; cursor:pointer;
      display:flex; align-items:center; justify-content:center; transition:all .15s; }
    .ov-todo-add-btn:hover { background:var(--brand); color:#fff; transform:scale(1.08); }
    .ov-todo-list { display:flex; flex-direction:column; }
    .ov-todo-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:9px 0; border-bottom:1px solid var(--border); }
    .ov-todo-row:last-child { border-bottom:none; }
    .ov-todo-text { font-size:13px; color:var(--text); line-height:1.5; }
    .ov-todo-date { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
    .ov-todo-overdue .ov-todo-date { color:var(--danger); }

    .ov-meta-row { display:flex; flex-wrap:wrap; gap:9px 20px; margin-top:10px; }
    .ov-meta-item { font-size:13.5px; color:var(--text-muted); white-space:nowrap; display:inline-flex; align-items:center; gap:5px; }



    .ov-stage-scroll { display:flex; flex-wrap:nowrap; gap:14px; overflow-x:auto; padding-bottom:4px; }
    .ov-stage { flex:0 0 auto; width:92px; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center; }
    .ov-stage-ring { width:76px; height:76px; border-radius:50%; position:relative;
      background: conic-gradient(var(--stage-color,var(--brand)) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-stage-ring-hole { position:absolute; inset:7px; border-radius:50%; background:var(--surface);
      display:flex; align-items:center; justify-content:center; font-size:13.5px; font-weight:800; color:var(--stage-color,var(--brand)); }
    .ov-stage-name { font-size:12.5px; font-weight:700; }
    .ov-stage-sub { font-size:11px; color:var(--text-muted); }

    .ov-status-list { display:flex; flex-direction:column; gap:0; }
    .ov-status-row { display:flex; justify-content:space-between; align-items:center; padding:11px 0; border-bottom:1px solid var(--border); font-size:13.5px; }
    .ov-status-row:last-child { border-bottom:none; }
    .ov-status-row .lbl { color:var(--text-muted); }
    .ov-risk-low { color:var(--success); font-weight:700; }
    .ov-risk-medium { color:var(--warning); font-weight:700; }
    .ov-risk-high { color:var(--danger); font-weight:700; }

    .ov-metrics-group { display:flex; flex-direction:column; gap:18px; }
    .ov-metrics-group .ov-metrics + .ov-metrics { padding-top:18px; border-top:1px dashed var(--border); }
    .ov-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .ov-metric { border-radius:14px; padding:14px 10px; text-align:center; background:var(--surface-2); }
    .ov-metric .ov-metric-icon { font-size:20px; }
    .ov-metric .ov-metric-label { font-size:12.5px; color:var(--text-muted); margin:4px 0; }
    .ov-metric .ov-metric-pct { font-size:22px; font-weight:800; }
    .ov-metric .ov-metric-sub { font-size:11px; color:var(--text-muted); }
    .ov-detail-agreed .ov-metric-pct { color:var(--success); }
    .ov-detail-opposed .ov-metric-pct { color:var(--danger); }
    .ov-detail-undecided .ov-metric-pct { color:var(--warning); }
    .ov-detail-noresponse .ov-metric-pct { color:var(--text-muted); }

    .ov-metrics-primary { grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .ov-metric-primary { padding:16px 8px; background:var(--surface); border:1px solid var(--border); box-shadow:var(--shadow);
      transition:transform .15s, box-shadow .15s; }
    .ov-metric-primary:hover { transform:translateY(-2px); box-shadow:var(--shadow-hover); }
    .ov-metric-icon-badge { width:48px; height:48px; border-radius:50%; margin:0 auto 10px; font-size:22px;
      display:flex; align-items:center; justify-content:center; }
    .ov-metric-tone-brand .ov-metric-icon-badge { background:var(--brand-light); }
    .ov-metric-tone-info .ov-metric-icon-badge { background:var(--info-light); }
    .ov-metric-tone-brown .ov-metric-icon-badge { background:var(--brown-light); }
    .ov-metric-tone-danger .ov-metric-icon-badge { background:var(--danger-light); }
    .ov-metric-tone-muted .ov-metric-icon-badge { background:var(--surface-2); }
    .ov-metric-primary .ov-metric-label { font-size:13px; font-weight:700; color:var(--text); }
    .ov-metric-primary .ov-metric-pct { font-size:26px; font-weight:800; }
    .ov-metric-tone-brand .ov-metric-pct { color:var(--brand-dark, var(--brand)); }
    .ov-metric-tone-info .ov-metric-pct { color:var(--info); }
    .ov-metric-tone-brown .ov-metric-pct { color:var(--brown); }
    .ov-metric-tone-danger .ov-metric-pct { color:var(--danger); }
    .ov-metric-tone-muted .ov-metric-pct { color:var(--text-muted); }
    .ov-metric-primary .ov-metric-sub { font-size:11.5px; margin-top:2px; }

    .ov-member-row { display:flex; align-items:center; gap:10px; padding:8px 0; font-size:13.5px; }
    .ov-member-avatar { width:32px; height:32px; border-radius:50%; background:var(--brand-light); color:var(--brand-dark);
      display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; flex:0 0 auto; }
    .ov-member-main { flex:1 1 auto; min-width:0; }
    .ov-member-role { font-size:11.5px; color:var(--text-muted); }

    .ov-list-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:9px 0; border-bottom:1px solid var(--border); font-size:13px; }
    .ov-list-row:last-child { border-bottom:none; }
    .ov-list-row-main { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-list-row-sub { color:var(--text-muted); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-list-row-meta { flex:0 0 auto; color:var(--text-muted); font-size:11.5px; text-align:right; white-space:nowrap; padding-top:1px; }
  `;
  document.head.appendChild(s);
}

function _ovRiskCard(caseStatus) {
  const riskCls = OVERVIEW_RISK_CLASS[caseStatus.risk_level] || "";
  const riskLabel = OVERVIEW_RISK_LABEL[caseStatus.risk_level] || caseStatus.risk_level || "—";
  return `
    <div class="ov-status-list">
      <div class="ov-status-row"><span class="lbl">案件狀態</span><span><span class="status-badge status-${caseStatus.status}">${escapeHtml(PROJECT_STATUS_LABEL[caseStatus.status] || caseStatus.status)}</span>${caseStatus.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : ""}</span></div>
      <div class="ov-status-row"><span class="lbl">風險等級</span><span class="${riskCls}">${escapeHtml(riskLabel)}</span></div>
      <div class="ov-status-row"><span class="lbl">延遲天數</span><span>${caseStatus.delay_days > 0 ? `${caseStatus.delay_days} 天` : "0 天"}</span></div>
      <div class="ov-status-row"><span class="lbl">下次里程碑</span><span>${escapeHtml(caseStatus.next_milestone_name || "—")}</span></div>
      <div class="ov-status-row"><span class="lbl">預計完成日</span><span>${caseStatus.expected_completion_date ? fmtDate(caseStatus.expected_completion_date) : "未設定"}</span></div>
      <div class="ov-status-row"><span class="lbl">更新日期</span><span>${fmtDateTime(caseStatus.updated_at)}</span></div>
    </div>`;
}

function _ovStageColor(status) {
  if (status === "completed" || status === "force_closed") return "var(--success)";
  if (status === "in_progress") return "var(--brand)";
  return "var(--border)";
}

function _ovStageHtml(s) {
  const color = _ovStageColor(s.status);
  const hole = s.status === "completed" || s.status === "force_closed" ? "✓" : `${s.pct}%`;
  return `
    <div class="ov-stage" title="${escapeHtml(s.name)} - ${escapeHtml(OVERVIEW_STAGE_STATUS_LABEL[s.status] || s.status)}">
      <div class="ov-stage-ring" style="--pct:${s.pct};--stage-color:${color}">
        <div class="ov-stage-ring-hole" style="color:${color}">${hole}</div>
      </div>
      <div class="ov-stage-name">${escapeHtml(s.name)}</div>
      <div class="ov-stage-sub">${escapeHtml(OVERVIEW_STAGE_STATUS_LABEL[s.status] || s.status)}</div>
    </div>`;
}

// 本週 vs 上週的小箭頭列。goodWhen: "up" = 變多是好事(同意)、"down" = 變多是壞事(反對)、
// null = 中性(其他/未決定)。unit "%" 顯示百分點差,"" 顯示人數差。沒有上週資料(舊後端)就不畫。
function _ovDeltaHtml(cur, prev, unit, goodWhen) {
  if (prev == null || cur == null) return "";
  const delta = cur - prev;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const tone = dir === "flat" || !goodWhen ? "flat" : dir === goodWhen ? "good" : "bad";
  const sign = delta > 0 ? "+" : "";
  return `<div class="ov-metric-delta ${tone}">${arrow} ${sign}${delta}${unit}<span class="prev">上週 ${prev}${unit}</span></div>`;
}

function _ovMetric(icon, label, ratio, subText, tone, deltaHtml) {
  const pct = Math.round((ratio || 0) * 100);
  return `
    <div class="ov-metric ov-metric-primary ov-metric-tone-${tone}">
      <div class="ov-metric-icon-badge">${icon}</div>
      <div class="ov-metric-label">${label}</div>
      <div class="ov-metric-pct">${pct}%</div>
      <div class="ov-metric-sub">${subText}</div>
      ${deltaHtml || ""}
    </div>`;
}

function _ovPctOf(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function _ovDetailOther(detail) {
  if (!detail) return 0;
  return (detail.undecided || 0) + (detail.no_response || 0);
}

function _ovDetailRatio(detail, kind) {
  if (!detail || !detail.total) return 0;
  const count = kind === "opposed" ? detail.opposed || 0 : _ovDetailOther(detail);
  return count / detail.total;
}

function _ovHeadcountDetailHtml(detail, lastWeek) {
  if (!detail) return "";
  const items = [
    { label: "同意", key: "agreed", cls: "ov-detail-agreed", goodWhen: "up" },
    { label: "反對", key: "opposed", cls: "ov-detail-opposed", goodWhen: "down" },
    { label: "未決定", key: "undecided", cls: "ov-detail-undecided", goodWhen: null },
    { label: "未回覆", key: "no_response", cls: "ov-detail-noresponse", goodWhen: null },
  ];
  return items
    .map(
      (it) => `<div class="ov-metric ${it.cls}">
        <div class="ov-metric-label">${it.label}</div>
        <div class="ov-metric-pct">${detail[it.key]}</div>
        <div class="ov-metric-sub">/ ${detail.total} 人</div>
        ${lastWeek ? _ovDeltaHtml(detail[it.key], lastWeek[it.key], "", it.goodWhen) : ""}
      </div>`
    )
    .join("");
}

function _ovCardTitle(icon, label, rightHtml) {
  return `<h3><span><span class="ov-card-icon">${icon}</span>${label}</span>${rightHtml || ""}</h3>`;
}

// 待辦事項卡片(案件總覽頁)- 跟工作看板行事曆、全站鈴鐺提醒同一份 calendar_events
// 資料,這裡篩成只看這個案件的,逾期的排最後面但還是要看得到(見 backend
// routers/project_overview.py get_project_todos)。
function _ovTodoRowHtml(t) {
  return `<div class="ov-todo-row${t.is_overdue ? " ov-todo-overdue" : ""}">
    <div class="ov-todo-lead">
      <span class="ov-todo-mark"></span>
      <div class="ov-todo-body">
        <div class="ov-todo-text">${t.is_important ? "⭐ " : ""}${escapeHtml(t.content)}</div>
        <div class="ov-todo-date">${fmtDate(t.event_date)}${t.is_overdue ? "・已過期" : ""}</div>
      </div>
    </div>
    ${isEditor() ? `<button type="button" class="btn-link btn-sm" data-ov-todo-delete="${t.id}">刪除</button>` : ""}
  </div>`;
}

function _ovSopTaskRowHtml(task) {
  return `<div class="ov-todo-row">
    <div class="ov-todo-lead">
      <span class="ov-todo-mark"></span>
      <div class="ov-todo-body"><div class="ov-todo-text">${escapeHtml(task.label)}<span class="ov-todo-chip">SOP</span></div></div>
    </div>
  </div>`;
}

// 一個區塊(這階段 / 下階段):SOP 這關還沒完成的項目(自動帶入,不能刪) + 歸在這關的
// 自訂待辦(行事曆備註)。block 是 overview.stage_tasks.current/next,null = 沒有這一關。
function _ovTodoZoneHtml(tagCls, tagText, block, customTodos, emptyText) {
  const pending = block ? block.tasks.filter((t) => !t.done) : [];
  const stageText = block ? `第${block.index}階段 ${escapeHtml(block.name || "")}` : "";
  const countText = block && block.tasks.length ? `${block.tasks.length - pending.length}/${block.tasks.length} 已完成` : "";
  const rows = pending.map(_ovSopTaskRowHtml).join("") + customTodos.map(_ovTodoRowHtml).join("");
  return `
    <div class="ov-todo-zone">
      <div class="ov-todo-zone-head">
        <span class="ov-zone-tag ${tagCls}">${tagText}</span>
        <span class="ov-zone-stage">${stageText}</span>
        <span class="ov-zone-count">${countText}</span>
      </div>
      ${rows ? `<div class="ov-todo-list">${rows}</div>` : `<div class="ov-todo-empty">${emptyText}</div>`}
    </div>`;
}

function _ovTodosHtml(todos, stageTasks) {
  const cur = stageTasks ? stageTasks.current : null;
  const next = stageTasks ? stageTasks.next : null;
  // 歸「下階段」的:指定關卡編號比目前這關大的自訂待辦;沒指定(舊資料)或已經輪到的都歸這階段。
  const isNext = (t) => cur && t.sop_stage != null && t.sop_stage > cur.index;
  const nowTodos = (todos || []).filter((t) => !isNext(t));
  const nextTodos = (todos || []).filter(isNext);
  const nowHtml = _ovTodoZoneHtml(
    "now", "這階段", cur, nowTodos,
    cur ? "✓ 這階段的項目都完成了" : stageTasks ? "✓ 所有階段都已完成" : "尚無待辦事項"
  );
  // 沒有下一關(已經是最後一關 / 舊後端沒回 stage_tasks)就不畫下階段區塊。
  const nextHtml = next
    ? _ovTodoZoneHtml("next", "下階段", next, nextTodos, "下階段沒有需要準備的項目")
    : "";
  return nowHtml + nextHtml;
}

function _ovMemberRoleLabel(role) {
  return (typeof ROLE_LABEL !== "undefined" && ROLE_LABEL[role]) || role;
}

async function renderProjectOverviewTab(el) {
  overviewEnsureStyle();
  const pid = state.currentProjectId;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;

  let overview, members, docs, notes, feed, todos;
  try {
    [overview, members, docs, notes, feed, todos] = await Promise.all([
      api(`/projects/${pid}/overview`),
      api(`/projects/${pid}/members`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/notes`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/overview/todos`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  if (state.currentProjectId !== pid) return;

  const proj = state.currentProject || {};
  // 「負責人」跟首頁案件卡片(dashboard-summary 的 case_handler_name/case_manager_name)
  // 同一套邏輯:members 裡第一個 case_staff/case_owner 是負責人,第一個 manager/
  // sys_admin 是主管(見 backend routers/projects.py _case_handler_names)。
  const handlerMember = members.find((m) => ["case_staff", "case_owner"].includes(m.role_in_project));
  const managerMember = members.find((m) => ["manager", "sys_admin"].includes(m.role_in_project));
  const handlerName = handlerMember && (handlerMember.display_name || handlerMember.username);
  const managerName = managerMember && (managerMember.display_name || managerMember.username);
  const dateRangeText = `${fmtDate(proj.created_at)} ~ ${proj.expected_completion_date ? fmtDate(proj.expected_completion_date) : "未定"}`;

  // 案件資訊列/簡介卡不是 #project-overview-content 裡的東西 - 它們跟麵包屑/標題一樣
  // 放在頁面固定的標題區(index.html 的 pd-top-grid),左右並排對齊,不是分頁內容
  // 卷軸捲下去才看得到的一部分。
  const metaRowEl = document.getElementById("pov-meta-row");
  if (metaRowEl) {
    metaRowEl.innerHTML = `
      <span class="ov-meta-item">📍 ${escapeHtml([proj.city, proj.district, proj.address].filter(Boolean).join("") || "—")}</span>
      <span class="ov-meta-item">📁 ${escapeHtml(proj.project_code || "—")}</span>
      ${proj.case_type ? `<span class="ov-meta-item">🏢 ${escapeHtml(proj.case_type)}</span>` : ""}
      <span class="ov-meta-item">📅 ${dateRangeText}</span>
      ${handlerName ? `<span class="ov-meta-item">👤 負責人:${escapeHtml(handlerName)}</span>` : ""}
      ${managerName ? `<span class="ov-meta-item">💼 主管:${escapeHtml(managerName)}</span>` : ""}`;
  }
  const membersHtml = members.length
    ? members
        .map(
          (m) => `<div class="ov-member-row">
            <span class="ov-member-avatar">${escapeHtml((m.display_name || m.username || "?").charAt(0))}</span>
            <div class="ov-member-main">
              <div>${escapeHtml(m.display_name || m.username)}</div>
              <div class="ov-member-role">${escapeHtml(_ovMemberRoleLabel(m.role_in_project))}</div>
            </div>
          </div>`
        )
        .join("")
    : `<div class="helper-text">尚未指派相關人員</div>`;

  const recentDocs = [...docs].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)).slice(0, 6);
  const docsHtml = recentDocs.length
    ? recentDocs
        .map(
          (d) => `<div class="ov-list-row">
            <div class="ov-list-row-main" title="${escapeHtml(d.file_name)}">📄 ${escapeHtml(d.file_name)}</div>
            <div class="ov-list-row-meta">${fmtDate(d.uploaded_at)}</div>
          </div>`
        )
        .join("")
    : `<div class="helper-text">尚無文件</div>`;

  const timeline = [
    ...notes.map((n) => ({ time: n.occurred_at, text: n.content, who: n.author_name, isNote: true })),
    ...feed.map((a) => ({ time: a.created_at, text: a.action, who: a.user_name, isNote: false })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6);
  const timelineHtml = timeline.length
    ? timeline
        .map((t) => {
          const icon = t.isNote ? "📝" : typeof _activityIcon === "function" ? _activityIcon(t.text) : "🔄";
          return `<div class="ov-list-row">
            <div style="min-width:0">
              <div class="ov-list-row-main" title="${escapeHtml(t.text)}">${icon} ${escapeHtml(t.text)}</div>
              <div class="ov-list-row-sub">${escapeHtml(t.who || "—")}</div>
            </div>
            <div class="ov-list-row-meta">${fmtDateTime(t.time)}</div>
          </div>`;
        })
        .join("")
    : `<div class="helper-text">尚無紀錄</div>`;

  const stageBandEl = document.getElementById("ov-stage-band");
  if (stageBandEl) stageBandEl.innerHTML = `<div class="ov-stage-scroll">${overview.stages.map(_ovStageHtml).join("")}</div>`;

  // 關鍵指標的「本週 vs 上週」:人數同意/反對/其他的百分比差,以及同意/反對/未決定/未回覆
  // 四格的人數差。本週、上週都用「每位地主最新一次拜訪結果」(headcount_detail)算,口徑一致。
  const km = overview.key_metrics;
  const cur = km.headcount_detail;
  const prev = km.headcount_detail_last_week;
  const pctDelta = (kind, goodWhen) => {
    if (!cur || !prev) return "";
    const count = (d) => (kind === "agreed" ? d.agreed : kind === "opposed" ? d.opposed : _ovDetailOther(d));
    return _ovDeltaHtml(_ovPctOf(count(cur), cur.total), _ovPctOf(count(prev), prev.total), "%", goodWhen);
  };
  const weekHint = prev && km.last_week_date ? `<span class="helper-text">本週 vs 上週(至 ${fmtDate(km.last_week_date)})</span>` : "";

  const stageTasks = overview.stage_tasks || null;
  const stageChoices = stageTasks && stageTasks.current
    ? { current: stageTasks.current, next: stageTasks.next }
    : null;
  const todoAddBtn = `<button type="button" class="ov-todo-add-btn" data-ov-todo-add title="新增待辦事項">+</button>`;

  el.innerHTML = `
    <div class="ov-grid">
      <div class="ov-row ov-row-r2">
        <div class="ov-card">
          ${_ovCardTitle("🎯", "關鍵指標", weekHint)}
          <div class="ov-metrics-group">
            <div class="ov-metrics ov-metrics-primary">
              ${_ovMetric("👥", "人數同意", cur ? (cur.total ? cur.agreed / cur.total : 0) : km.headcount_ratio, cur ? `${cur.agreed} / ${cur.total} 人` : `${km.headcount_agreed} / ${km.headcount_total} 人`, "brand", pctDelta("agreed", "up"))}
              ${_ovMetric("❌", "反對", _ovDetailRatio(cur, "opposed"), `${cur?.opposed || 0} / ${cur?.total || 0} 人`, "danger", pctDelta("opposed", "down"))}
              ${_ovMetric("❔", "其他", _ovDetailRatio(cur, "other"), `${_ovDetailOther(cur)} / ${cur?.total || 0} 人`, "muted", pctDelta("other", null))}
            </div>
            <div class="ov-metrics">
              ${_ovHeadcountDetailHtml(cur, prev)}
            </div>
          </div>
        </div>
        <div class="ov-card ov-card-merged">
          <div class="ov-sec">
            ${_ovCardTitle("📋", "案件狀態")}
            ${_ovRiskCard(overview.case_status)}
          </div>
          <div class="ov-sec">
            ${_ovCardTitle("✅", "待辦事項", todoAddBtn)}
            ${_ovTodosHtml(todos, stageTasks)}
          </div>
        </div>
      </div>

      <div class="ov-row ov-row-r3">
        <div class="ov-card ov-card-merged ov-card-merged-even">
          <div class="ov-sec">${_ovCardTitle("📝", "重要紀錄")}${timelineHtml}</div>
          <div class="ov-sec">${_ovCardTitle("📁", "最近文件")}${docsHtml}</div>
        </div>
        <div class="ov-card">${_ovCardTitle("👥", "相關人員")}${membersHtml}</div>
      </div>
    </div>`;

  el.querySelector("[data-ov-todo-add]")?.addEventListener("click", () => {
    openAddReminderModal(pid, [{ id: pid, name: proj.name || `案件 ${pid}` }], () => renderProjectOverviewTab(el), stageChoices);
  });

  el.querySelectorAll("[data-ov-todo-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這筆待辦事項嗎?")) return;
      try {
        await api(`/dashboard/calendar/${btn.dataset.ovTodoDelete}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderProjectOverviewTab(el);
      } catch (err) { }
    });
  });
}
