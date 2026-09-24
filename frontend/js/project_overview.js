"use strict";

// 「案件總覽」—— 首頁「都更案件進度總覽」卡片點進去的獨立落地頁(view-project-overview,
// 見 dashboard.js goToProjectOverviewPage),跟側欄「案件管理」清單直接進的 SOP 進度分頁
// 頁面(view-project-detail)是不同畫面。全部資料都串真實 API,沒有後端資料可算的欄位
// (待辦事項)先留空狀態,不做假資料。

const OVERVIEW_STAGE_STATUS_LABEL = {
  completed: "已完成",
  force_closed: "強制結案",
  in_progress: "進行中",
  pending: "未開始",
};

function overviewEnsureStyle() {
  let s = document.getElementById("ov-style");
  if (!s) {
    s = document.createElement("style");
    s.id = "ov-style";
    document.head.appendChild(s);
  }
  s.textContent = `
    .ov-grid { display:flex; flex-direction:column; gap:22px; }
    .ov-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:22px; align-items:stretch; }
    .ov-row.ov-row-r2 { grid-template-columns: minmax(0,2fr) minmax(0,1fr); }
    .ov-row.ov-row-r3 { grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); }
    @media (max-width:1100px) { .ov-row.ov-row-r2, .ov-row.ov-row-r3 { grid-template-columns: 1fr; } }

    /* Unified Header Banner using User Uploaded Background Image */
    /* Unified Header Banner - Seamless Page Background Integration (No Outer Card Container) */
    .pov-header-banner {
      position: relative;
      background-image: none !important;
      border-radius: 0 !important;
      padding: 20px 24px 18px;
      margin-bottom: 24px;
      box-shadow: none !important;
      border: none !important;
      overflow: visible;
    }
    .pov-header-banner::before, #view-project-overview .pd-top-grid::before, #view-project-detail .pd-top-grid::before { display: none !important; content: none !important; }
    .pov-header-banner > * { position: relative; z-index: 1; }
    /* 背景圖底邊要剛好貼在 SOP 關卡那條線上 - 線的位置跟著關卡名稱換行高度變,
       所以 --pov-bg-bottom 由 _alignBannerBgToStageLine() 量完實際位置再設。 */
    .pov-header-banner::after {
      content: ""; position: absolute; left: 0; right: 0; height: 200px;
      bottom: var(--pov-bg-bottom, 0px); z-index: 0; pointer-events: none; opacity: .8;
      background: url("pov_banner_bldg.png?v=20260924_1") 86% bottom / auto 100% no-repeat;
      image-rendering: -webkit-optimize-contrast;
    }

    #view-project-overview .nw-crumbs { font-size: 13px; color: #64748b; font-weight: 600; margin-bottom: 12px; }
    #view-project-overview .nw-crumbs a { color: #475569; text-decoration: none; font-weight: 600; }
    #view-project-overview .nw-crumbs a:hover { color: #0284c7; }
    #view-project-overview .pd-top-grid { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-top: 4px; }
    #view-project-overview .pd-top-left { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; align-self: center; margin: auto 0; }
    #view-project-overview .pd-top-right { flex-shrink: 0; display: flex; flex-direction: row-reverse; align-items: flex-start; gap: 16px; margin-top: -6px; }
    #view-project-overview .pd-top-right > div:first-child { transform: translateY(-24px); }
    #pov-name { font-size: 28px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em; margin: 0; }
    .ov-meta-row { display: flex; align-items: center; flex-wrap: nowrap; gap: 20px; margin-top: 14px; color: #334155; font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow-x: auto; scrollbar-width: none; }
    .ov-meta-row::-webkit-scrollbar { display: none; }
    .ov-meta-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap !important; flex-shrink: 0; }

    /* Stage Timeline Band Inside Header Banner - Seamless Canvas */
    .pov-header-banner .ov-stage-band {
      margin: 10px 0 0 !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }
    .ov-step-timeline { position: relative; padding: 4px 0 0; width: 100%; box-sizing: border-box; }
    .ov-step-line-bg { position: absolute; top: 15px; left: 5.5%; right: 5.5%; height: 3px; background: #cbd5e1; z-index: 0; }
    .ov-step-line-active { position: absolute; top: 15px; left: 5.5%; height: 3px; background: #10b981; z-index: 1; transition: width 0.3s ease; }
    .ov-step-items { position: relative; z-index: 2; display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; }
    .ov-step-item { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
    .ov-step-node-wrap { height: 32px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
    .ov-step-node { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-sizing: border-box; transition: transform .15s ease; font-weight: 700; font-size: 13px; }
    .ov-step-item.completed .ov-step-node { background: #10b981; color: #ffffff; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); }
    .ov-step-item.pending .ov-step-node { background: #dbeafe; border: 2px solid #cbd5e1; color: #475569; }
    .ov-step-name { font-size: 12px; font-weight: 700; color: #1e293b; line-height: 1.35; margin-bottom: 2px; word-break: break-word; }
    .ov-step-sub { font-size: 11px; color: #94a3b8; font-weight: 500; }
    .ov-step-sub.is-completed { color: #10b981; font-weight: 700; }

    /* Top Progress Card */
    .ov-progress-card { background: rgba(255, 255, 255, 0.62) !important; backdrop-filter: blur(12px) saturate(160%) !important; -webkit-backdrop-filter: blur(12px) saturate(160%) !important; border: 1px solid rgba(255, 255, 255, 0.95) !important; border-radius: 18px !important; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.05) !important; padding: 14px 18px !important; display: flex !important; flex-direction: column !important; align-items: flex-start !important; min-width: 250px; }
    .ov-progress-header { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 6px; }
    .ov-progress-label { font-size: 13px; font-weight: 700; color: #475569; }
    .ov-progress-body { display: flex; align-items: center; gap: 14px; width: 100%; margin: 2px 0 2px; }
    .ov-progress-ring { width: 68px; height: 68px; border-radius: 50%; position: relative; background: conic-gradient(#00b8a9 calc(var(--pct, 0) * 3.6deg), #e2e8f0 0deg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ov-progress-ring-hole { position: absolute; inset: 9px; border-radius: 50%; background: rgba(255, 255, 255, 0.95); }
    .ov-progress-info { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
    .ov-progress-frac { font-size: 12.5px; font-weight: 700; color: #64748b; line-height: 1.2; }
    .ov-progress-pct { font-size: 25px; font-weight: 800; color: #00b8a9; line-height: 1.1; margin: 1px 0; }
    .ov-progress-sub { font-size: 11.5px; color: #64748b; font-weight: 500; white-space: nowrap; }

    /* Card Titles & Pill Badges */
    .ov-title-pill { font-size: 11.5px; font-weight: 700; padding: 2px 10px; border-radius: 999px; background: #e0f2fe; color: #0284c7; margin-left: 8px; }
    .ov-title-link { font-size: 12.5px; font-weight: 700; color: #0284c7; text-decoration: none; margin-left: auto; }
    .ov-title-link:hover { text-decoration: underline; }

    /* To-Do List Zone Headers & Check Status */
    .ov-todo-zone + .ov-todo-zone { margin-top:16px; }
    .ov-todo-zone-head { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; margin-bottom:8px; }
    .ov-zone-tag { font-size:11px; font-weight:800; padding:3px 10px; border-radius:999px; }
    .ov-zone-tag.now { background: #e0f2fe; color: #0284c7; }
    .ov-zone-tag.next { background: #f1f5f9; color: #64748b; }
    .ov-zone-stage { color:#334155; font-weight:700; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-zone-count { display: flex; align-items: center; gap: 4px; color:#64748b; font-weight:600; font-size:12px; margin-left: auto; }
    .ov-zone-check-circle { width: 18px; height: 18px; border-radius: 50%; background: #10b981; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; }
    .ov-todo-mark { flex:0 0 auto; width:15px; height:15px; margin:2px 8px 0 0; border-radius:50%; border:2px solid var(--border-strong, #cbd5d8); box-sizing:border-box; }
    .ov-todo-lead { display:flex; min-width:0; flex:1; }
    .ov-todo-body { min-width:0; }
    .ov-todo-chip { font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:6px; background:var(--surface-2); color:var(--text-muted); margin-left:6px; white-space:nowrap; }
    .ov-todo-mark.pri-urgent { border-color:var(--danger); }
    .ov-todo-mark.pri-important { border-color:var(--warning); }
    .ov-pri-chip { font-size:10.5px; font-weight:800; padding:1px 7px; border-radius:6px; margin-left:6px; white-space:nowrap; cursor:help; }
    .ov-pri-chip.urgent { color:var(--danger); background:color-mix(in srgb, var(--danger) 13%, transparent); }
    .ov-pri-chip.important { color:var(--warning); background:color-mix(in srgb, var(--warning) 16%, transparent); }
    .ov-todo-empty { font-size:12.5px; color:#64748b; padding:8px 0; display:flex; align-items:center; gap:4px; font-weight:500; }

    /* Key Metrics Top Cards & Sub-Metric Pills */
    .ov-metrics-group { display:flex; flex-direction:column; gap:16px; }
    .ov-metrics-primary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .ov-metric-primary { padding:16px 10px; background:var(--surface, #ffffff); border:1px solid var(--border, #e2e8f0); border-radius: 14px; box-shadow:var(--shadow, 0 4px 14px rgba(0,0,0,0.03)); transition:transform .15s, box-shadow .15s; text-align:center; }
    .ov-metric-primary:hover { transform:translateY(-2px); box-shadow:var(--shadow-hover, 0 6px 20px rgba(0,0,0,0.06)); }
    .ov-metric-icon-badge { width:44px; height:44px; border-radius:50%; margin:0 auto 10px; font-size:20px; display:flex; align-items:center; justify-content:center; }
    .ov-metric-tone-brand .ov-metric-icon-badge { background:#e6f4ea; color:#137333; }
    .ov-metric-tone-info .ov-metric-icon-badge { background:#e8f0fe; color:#1a73e8; }
    .ov-metric-tone-brown .ov-metric-icon-badge { background:#fef7e0; color:#b06000; }
    .ov-metric-tone-danger .ov-metric-icon-badge { background:#fce8e6; color:#c5221f; }
    .ov-metric-tone-muted .ov-metric-icon-badge { background:#f1f5f9; color:#64748b; }
    .ov-metric-primary .ov-metric-label { font-size:13px; font-weight:700; color:var(--text, #1e293b); }
    .ov-metric-primary .ov-metric-pct { font-size:24px; font-weight:800; line-height: 1.2; margin: 3px 0; }
    .ov-metric-tone-brand .ov-metric-pct { color: #00b8a9; }
    .ov-metric-tone-info .ov-metric-pct { color: #2563eb; }
    .ov-metric-tone-brown .ov-metric-pct { color: #3b82f6; }
    .ov-metric-tone-danger .ov-metric-pct { color: #ef4444; }
    .ov-metric-tone-muted .ov-metric-pct { color: #64748b; }
    .ov-metric-primary .ov-metric-sub { font-size:11.5px; color:#64748b; margin-top:2px; }

    .ov-sub-metrics-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:4px; }
    .ov-sub-metric { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-radius:12px; transition:transform .15s, box-shadow .15s; }
    .ov-sub-metric:hover { transform:translateY(-1px); }
    .ov-sub-agreed { background:#f0fdf4; border:1px solid #dcfce7; }
    .ov-sub-opposed { background:#fef2f2; border:1px solid #fee2e2; }
    .ov-sub-undecided { background:#fffbe6; border:1px solid #fef08a; }
    .ov-sub-noresponse { background:#f8fafc; border:1px solid #e2e8f0; }
    .ov-sub-left { display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; }
    .ov-sub-badge { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:800; color:#ffffff; flex:0 0 auto; }
    .ov-sub-badge.agreed { background:#10b981; }
    .ov-sub-badge.opposed { background:#ef4444; }
    .ov-sub-badge.undecided { background:#eab308; }
    .ov-sub-badge.noresponse { background:#94a3b8; }
    .ov-sub-agreed .ov-sub-label { color:#15803d; }
    .ov-sub-opposed .ov-sub-label { color:#b91c1c; }
    .ov-sub-undecided .ov-sub-label { color:#854d0e; }
    .ov-sub-noresponse .ov-sub-label { color:#475569; }
    .ov-sub-mid { font-size:11.5px; color:#64748b; font-weight:600; }
    .ov-sub-right { font-size:14.5px; font-weight:800; }
    .ov-sub-agreed .ov-sub-right { color:#10b981; }
    .ov-sub-opposed .ov-sub-right { color:#ef4444; }
    .ov-sub-undecided .ov-sub-right { color:#eab308; }
    .ov-sub-noresponse .ov-sub-right { color:#64748b; }

    /* General card styling */
    .ov-card { background:var(--surface, #ffffff); border:1px solid var(--border, #e2e8f0); border-radius:18px; padding:20px 22px; box-shadow:var(--shadow, 0 4px 14px rgba(0,0,0,0.03)); transition:box-shadow .15s; }
    .ov-card:hover { box-shadow:var(--shadow-hover, 0 6px 20px rgba(0,0,0,0.06)); }
    .ov-card h3 { margin:0 0 16px; font-size:15.5px; font-weight:800; display:flex; align-items:center; justify-content:space-between; gap:8px; padding-bottom:13px; border-bottom:1px solid var(--border, #e2e8f0); letter-spacing:.01em; }
    .ov-card-icon { width:28px; height:28px; border-radius:9px; background:var(--brand-light, #e0f2fe); color:var(--brand-dark, #0284c7); display:inline-flex; align-items:center; justify-content:center; font-size:14.5px; flex:0 0 auto; margin-right:2px; }
    .ov-card h3 > span:first-child { display:inline-flex; align-items:center; gap:8px; }

    /* Important records list row & file icon box */
    .ov-list-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border, #e2e8f0); font-size:13px; position:relative; }
    .ov-list-row:last-child { border-bottom:none; }
    .ov-list-row-icon { flex:0 0 auto; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; }
    .ov-list-ic-pdf { background:#fee2e2; color:#dc2626; }
    .ov-list-ic-xlsx { background:#dcfce7; color:#16a34a; }
    .ov-list-ic-sop { background:#e0e7ff; color:#4338ca; }
    .ov-list-ic-doc { background:#dbeafe; color:#2563eb; }
    .ov-list-ic-code { background:#e0f2fe; color:#0284c7; }
    .ov-list-ic-default { background:#f1f5f9; color:#64748b; }
    .ov-list-row-body { display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 auto; }
    .ov-list-row-tag { flex:0 0 auto; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:999px; background:#f1f5f9; color:#64748b; }
    .ov-list-row-main { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; color:#1e293b; }
    .ov-list-row-meta { flex:0 0 auto; color:#64748b; font-size:11.5px; text-align:right; white-space:nowrap; }

    /* Members & Info Cards */
    .ov-side-stack { display:flex; flex-direction:column; gap:22px; min-width:0; }
    .ov-member-row { display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--border, #e2e8f0); font-size:13.5px; position:relative; }
    .ov-member-row:last-child { border-bottom:none; }
    .ov-member-avatar { width:34px; height:34px; border-radius:50%; background:#0d9488; color:#ffffff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13.5px; flex:0 0 auto; }
    .ov-member-main { flex:1 1 auto; min-width:0; }
    .ov-member-role { font-size:11.5px; color:#64748b; margin-top:2px; }
    .ov-member-tag { font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:999px; vertical-align:middle; margin-left:4px; }
    .ov-member-tag.manager { background:#e2e8f0; color:#475569; }
    .ov-member-tag.handler { background:#f3e8ff; color:#7e22ce; }

    .ov-info-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; padding-top:4px; }
    .ov-info-item { display:flex; flex-direction:column; }
    .ov-info-label { font-size:11.5px; color:#64748b; margin-bottom:4px; font-weight:600; }
    .ov-info-value { font-size:13.5px; font-weight:700; color:#1e293b; word-break:break-word; }
  `;
}

function _ovTimelineIconCls(text) {
  if (/^(POST|GET|PATCH|PUT|DELETE)\s+\//.test(text)) return { icon: "</>", cls: "ov-list-ic-code" };
  if (/\.pdf/i.test(text)) return { icon: "PDF", cls: "ov-list-ic-pdf" };
  if (/\.(xlsx|xls|csv)/i.test(text)) return { icon: "X", cls: "ov-list-ic-xlsx" };
  if (/\.(docx|doc)/i.test(text)) return { icon: "W", cls: "ov-list-ic-doc" };
  if (text.includes("SOP")) return { icon: "✓", cls: "ov-list-ic-sop" };
  return { icon: "📄", cls: "ov-list-ic-default" };
}

function _renderStageTimeline(stages) {
  if (!stages || !stages.length) return "";
  let lastDoneIdx = -1;
  stages.forEach((s, i) => {
    if (s.status === "completed" || s.status === "force_closed") {
      lastDoneIdx = i;
    }
  });
  const total = stages.length;
  const stepPct = total > 1 ? 89 / (total - 1) : 0;
  const activeWidth = lastDoneIdx >= 0 && total > 1 ? lastDoneIdx * stepPct : 0;

  const itemsHtml = stages.map((s, idx) => {
    const isDone = s.status === "completed" || s.status === "force_closed";
    const statusLabel = OVERVIEW_STAGE_STATUS_LABEL[s.status] || s.status;
    const isCompletedText = s.status === "completed" ? "is-completed" : "";
    const nodeInner = isDone
      ? `<svg class="ov-step-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<span>${idx + 1}</span>`;

    return `<div class="ov-step-item ${isDone ? "completed" : "pending"}" title="${escapeHtml(s.name)} - ${escapeHtml(statusLabel)}">
      <div class="ov-step-node-wrap">
        <div class="ov-step-node">${nodeInner}</div>
      </div>
      <div class="ov-step-name">${escapeHtml(s.name)}</div>
      <div class="ov-step-sub ${isCompletedText}">${escapeHtml(statusLabel)}</div>
    </div>`;
  }).join("");

  return `<div class="ov-step-timeline">
    <div class="ov-step-line-bg"></div>
    <div class="ov-step-line-active" style="width:${activeWidth}%"></div>
    <div class="ov-step-items">${itemsHtml}</div>
  </div>`;
}

function _alignBannerBgToStageLine() {
  const banner = document.querySelector("#view-project-overview .pov-header-banner");
  const line = banner && banner.querySelector(".ov-step-line-bg");
  if (!line) return;
  const b = banner.getBoundingClientRect();
  const l = line.getBoundingClientRect();
  if (!b.height || !l.height) return;
  banner.style.setProperty("--pov-bg-bottom", `${Math.max(0, b.bottom - l.bottom)}px`);
}
window.addEventListener("resize", _alignBannerBgToStageLine);

// 右上角「完成進度」卡:圓環(中間百分比、進度尾端一個圓點)+ 完成數 + 每關一格的分段條 + 一句提示。
// 案件總覽頁跟 SOP 頁共用(sop.js 也呼叫這支)。
function ovProgressCardHtml(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const dotX = 50 + r * Math.cos(angle);
  const dotY = 50 + r * Math.sin(angle);
  const hint =
    !total ? "尚未設定關卡" : done === 0 ? "還沒開始,先完成第一項吧" : done >= total ? "全部完成,太棒了 🎉" : `再完成 ${total - done} 項就全部完成了`;
  const segs = Array.from({ length: total }, (_, k) => `<i class="${k < done ? "on" : ""}"></i>`).join("");
  return `
    <div class="ovp-card">
      <div class="ovp-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="${r}" class="ovp-track"/>
          <circle cx="50" cy="50" r="${r}" class="ovp-bar" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 50 50)"/>
          <circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="5.5" class="ovp-dot"/>
        </svg>
        <div class="ovp-ring-text">${pct}<small>%</small></div>
      </div>
      <div class="ovp-info">
        <div class="ovp-label">完成進度</div>
        <div class="ovp-count"><b>${done}</b> / ${total} 項</div>
        <div class="ovp-segs">${segs}</div>
        <div class="ovp-hint">${hint}</div>
      </div>
    </div>`;
}

function _ovDeltaHtml(cur, prev, unit, goodWhen) {
  if (prev == null || cur == null) return "";
  const delta = cur - prev;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const tone = dir === "flat" || !goodWhen ? "flat" : dir === goodWhen ? "good" : "bad";
  const sign = delta > 0 ? "+" : "";
  return `<div class="ov-metric-delta ${tone}">${arrow} ${sign}${delta}${unit}<span class="prev">上週 ${prev}${unit}</span></div>`;
}

const _ovKmSvg = (d, w = 2.2) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const OV_KM_ICON = {
  people: _ovKmSvg(`<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5.3a3.2 3.2 0 0 1 0 6M17.5 14.2a5.5 5.5 0 0 1 3.5 5.3"/>`),
  cross: _ovKmSvg(`<path d="M6 6l12 12M18 6L6 18"/>`, 3),
  question: _ovKmSvg(`<path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.9V15M12 18.5v.01"/>`, 2.8),
  doc: _ovKmSvg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`),
  info: _ovKmSvg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>`, 1.8),
  trendUp: _ovKmSvg(`<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>`, 2.4),
  trendDown: _ovKmSvg(`<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>`, 2.4),
  trendFlat: _ovKmSvg(`<path d="M3 12h16M15 8l4 4-4 4"/>`, 2.4),
  up: _ovKmSvg(`<path d="M12 19V5M6 11l6-6 6 6"/>`, 2.4),
  down: _ovKmSvg(`<path d="M12 5v14M6 13l6 6 6-6"/>`, 2.4),
  right: _ovKmSvg(`<path d="M5 12h14M13 6l6 6-6 6"/>`, 2.4),
  bars: _ovKmSvg(`<path d="M6 20v-7M12 20V5M18 20v-10"/>`, 3.2),
  idcard: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3" fill="currentColor"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  folder: _ovKmSvg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`, 2.4),
  pin: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7m0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5"/></svg>`,
  infoSolid: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor"/><path d="M12 11v6M12 7.5v.01" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  mail: _ovKmSvg(`<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>`, 2),
  clock: _ovKmSvg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`, 2),
  list: _ovKmSvg(`<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>`, 2.4),
  check: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  calendar: _ovKmSvg(`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
};

// 關鍵指標卡:圖示+標題+說明+趨勢 → 大數字 → 人數 → 進度條 → 底部「較上週」。
// delta = 本週 - 上週(百分比卡是百分點差、總件數是件數差),prev == null 表示沒有上週資料。
function _ovKmCard({ icon, label, tip, tone, big, sub, pct, delta, prev, unit, kind }) {
  const hasPrev = prev != null && delta != null;
  const dir = !hasPrev || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const trend = dir === "up" ? OV_KM_ICON.trendUp : dir === "down" ? OV_KM_ICON.trendDown : OV_KM_ICON.trendFlat;
  const arrow = dir === "up" ? OV_KM_ICON.up : dir === "down" ? OV_KM_ICON.down : OV_KM_ICON.right;
  const sign = hasPrev && delta > 0 ? "+" : "";
  const click = kind ? ` ov-metric-clickable" data-ov-metric="${kind}" data-ov-metric-label="${escapeHtml(label)}" tabindex="0" role="button` : "";
  return `
    <div class="ov-km-card ov-km-${tone}${click}">
      <div class="ov-km-top">
        <span class="ov-km-icon">${icon}</span>
        <span class="ov-km-label">${label}</span>
        <span class="ov-km-tip" title="${escapeHtml(tip)}">${OV_KM_ICON.info}</span>
        <span class="ov-km-trend ov-km-dir-${dir}">${trend}</span>
      </div>
      <div class="ov-km-big">${big}</div>
      <div class="ov-km-sub">${sub}</div>
      ${pct == null ? "" : `<div class="ov-km-bar-row"><div class="ov-km-bar"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div><span>${pct}%</span></div>`}
      <div class="ov-km-spacer"></div>
      <div class="ov-km-foot">
        <span class="ov-km-foot-label">較上週</span>
        <span class="ov-km-foot-arrow ov-km-dir-${dir}">${arrow}</span>
        <span class="ov-km-foot-val">
          <b>${hasPrev ? `${sign}${delta}${unit}` : "—"}</b>
          <small>${hasPrev ? `上週 ${prev}${unit}` : "尚無上週資料"}</small>
        </span>
      </div>
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
  const total = detail.total || 0;
  const items = [
    { label: "同意", key: "agreed", count: detail.agreed || 0, icon: "✓", tone: "agreed", goodWhen: "up" },
    { label: "反對", key: "opposed", count: detail.opposed || 0, icon: "✕", tone: "opposed", goodWhen: "down" },
    { label: "未決定", key: "undecided", count: detail.undecided || 0, icon: "-", tone: "undecided", goodWhen: null },
    { label: "未回覆", key: "no_response", count: detail.no_response || 0, icon: "•••", tone: "noresponse", goodWhen: null },
  ];

  return `<div class="ov-sub-metrics-grid">${items
    .map((it) => {
      const pct = total ? Math.round((it.count / total) * 100) : 0;
      return `<div class="ov-sub-metric ov-sub-${it.tone} ov-metric-clickable" data-ov-metric="${it.key}" data-ov-metric-label="${escapeHtml(it.label)}" tabindex="0" role="button">
        <span class="ov-sub-badge ${it.tone}">${it.icon}</span>
        <div class="ov-sub-body">
          <div class="ov-sub-row">
            <span class="ov-sub-label">${it.label}</span>
            <span class="ov-sub-right">${pct}%</span>
          </div>
          <div class="ov-sub-mid">${it.count} / ${total} 人</div>
          <div class="ov-sub-bar"><i style="width:${pct}%"></i></div>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

function _ovClassifyContactResult(result) {
  if (result === "agreed") return "agreed";
  if (result === "opposed") return "opposed";
  if (result === "undecided" || result === "callback_needed") return "undecided";
  return "no_response";
}

const OV_METRIC_KIND_LABEL = { agreed: "同意", opposed: "反對", undecided: "未決定", no_response: "未回覆", other: "其他(未決定/未回覆)" };

async function _ovOpenMetricDetail(pid, kind) {
  const title = `${OV_METRIC_KIND_LABEL[kind] || kind} 名單`;
  const panel = openModal(title, `<div class="empty-state">載入中...</div>`, { width: "460px" });
  let landowners, summary;
  try {
    [landowners, summary] = await Promise.all([
      api(`/projects/${pid}/landowners`),
      api(`/projects/${pid}/contact-summary`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    panel.querySelector(".modal-body").innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  const resultBy = new Map(summary.map((s) => [s.landowner_id, s]));
  const matched = landowners.filter((o) => {
    const cls = _ovClassifyContactResult(resultBy.get(o.id)?.last_contact_result);
    return kind === "other" ? cls === "undecided" || cls === "no_response" : cls === kind;
  });

  const bodyEl = panel.querySelector(".modal-body");
  if (!bodyEl) return;
  if (!matched.length) {
    bodyEl.innerHTML = `<div class="empty-state">目前沒有地主屬於這一類</div>`;
    return;
  }
  const rowsHtml = matched
    .map((o) => {
      const s = resultBy.get(o.id);
      const cls = _ovClassifyContactResult(s?.last_contact_result);
      const phone = o.phone_mobile || o.phone_landline || o.phone || "";
      const lastDate = s?.last_contact_date ? fmtDate(s.last_contact_date) : "";
      const initial = (o.name || "").trim().charAt(0) || "?";
      return `<div class="ov-md-row tone-${cls}" data-md-name="${escapeHtml((o.name || "").toLowerCase())}">
        <div class="ov-md-avatar">${escapeHtml(initial)}</div>
        <div class="ov-md-main">
          <div class="ov-md-name">${escapeHtml(o.name || "(未命名)")}</div>
          <div class="ov-md-meta">
            ${phone ? `<a class="ov-md-phone" href="tel:${escapeHtml(phone)}">📞 ${escapeHtml(phone)}</a>` : `<span class="ov-md-muted">未留電話</span>`}
          </div>
        </div>
        <span class="ov-md-date ${lastDate ? "" : "none"}">${lastDate ? `最近聯絡 ${escapeHtml(lastDate)}` : "尚無拜訪紀錄"}</span>
      </div>`;
    })
    .join("");
  bodyEl.innerHTML = `
    <div class="ov-md-toolbar">
      <span class="ov-md-count tone-${kind}">共 <b>${matched.length}</b> 位</span>
      ${matched.length > 8 ? `<input type="search" class="ov-md-search" placeholder="搜尋姓名…" autocomplete="off">` : ""}
    </div>
    <div class="ov-md-list">${rowsHtml}</div>
    <div class="ov-md-empty hidden">找不到符合的地主</div>`;
  const search = bodyEl.querySelector(".ov-md-search");
  if (search) {
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      bodyEl.querySelectorAll(".ov-md-row").forEach((r) => {
        const hit = !q || r.dataset.mdName.includes(q);
        r.classList.toggle("hidden", !hit);
        if (hit) shown++;
      });
      bodyEl.querySelector(".ov-md-empty").classList.toggle("hidden", shown > 0);
    });
  }
}

function _ovCardTitle(icon, label, rightBadge, rightHtml) {
  return `<h3><span><span class="ov-card-icon">${icon}</span>${label}${rightBadge || ""}</span>${rightHtml || ""}</h3>`;
}

function _ovPriorityOf(item) {
  return { urgent: item.urgent_reasons || [], important: item.important_reasons || [] };
}

function _ovPriorityScore(r) {
  return (r.urgent.length ? 2 : 0) + (r.important.length ? 1 : 0);
}

function _ovPriorityChipsHtml(r) {
  const chip = (cls, text, list) => `<span class="ov-pri-chip ${cls}" title="${escapeHtml(list.join("、"))}">${text}</span>`;
  return (r.urgent.length ? chip("urgent", "🔥 緊急", r.urgent) : "") + (r.important.length ? chip("important", "⭐ 重要", r.important) : "");
}

function _ovPriorityCls(r) {
  return r.urgent.length ? "pri-urgent" : r.important.length ? "pri-important" : "";
}

function _ovSopTaskRowHtml(task, r) {
  return `<div class="ov-todo-row">
    <div class="ov-todo-lead">
      <span class="ov-todo-mark ${_ovPriorityCls(r)}"></span>
      <div class="ov-todo-body"><div class="ov-todo-text">${escapeHtml(task.label)}<span class="ov-todo-chip">SOP</span>${_ovPriorityChipsHtml(r)}</div></div>
    </div>
  </div>`;
}

function _ovTodoZoneHtml(tagCls, tagText, block, emptyText) {
  const pending = block ? block.tasks.filter((t) => !t.done) : [];
  const totalCount = block ? block.tasks.length : 0;
  const doneCount = block ? block.tasks.filter((t) => t.done).length : 0;
  const stageText = block ? `第${block.index}階段 ${escapeHtml(block.name || "")}` : "";
  const isAllDone = block && totalCount > 0 && pending.length === 0;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const countText = block && totalCount
    ? `<span class="ov-zone-count"><span>📅 ${doneCount}/${totalCount} 已完成</span>${isAllDone ? `<span class="ov-zone-check-circle">✓</span>` : ""}</span>`
    : "";

  const items = pending.map((task) => {
    const r = _ovPriorityOf(task);
    return { r, html: _ovSopTaskRowHtml(task, r) };
  });
  items.sort((a, b) => _ovPriorityScore(b.r) - _ovPriorityScore(a.r));
  const rows = items.map((it) => it.html).join("");
  return `
    <div class="ov-todo-zone ov-tz-${tagCls}">
      <div class="ov-tz-top">
        <span class="ov-zone-tag ${tagCls}">${tagText}</span>
        ${countText}
      </div>
      ${stageText ? `<div class="ov-tz-stage">${stageText}</div>` : ""}
      ${rows ? `<div class="ov-todo-list">${rows}</div>` : `<div class="ov-todo-empty">${isAllDone || !block || !totalCount ? "✓ " : ""}${emptyText}</div>`}
      ${block && totalCount ? `<div class="ov-tz-bar-row"><div class="ov-tz-bar"><i style="width:${pct}%"></i></div><span>${pct}%</span></div>` : ""}
    </div>`;
}

function _ovTodosHtml(stageTasks) {
  const cur = stageTasks ? stageTasks.current : null;
  const next = stageTasks ? stageTasks.next : null;
  const nowHtml = _ovTodoZoneHtml(
    "now", "這階段", cur,
    cur ? "這階段的項目都完成了" : stageTasks ? "所有階段都已完成" : "尚無待辦事項"
  );
  const nextHtml = next ? _ovTodoZoneHtml("next", "下階段", next, "下階段沒有需要準備的項目") : "";
  return nowHtml + nextHtml;
}

function _ovMemberRoleLabel(role) {
  return (typeof ROLE_LABEL !== "undefined" && ROLE_LABEL[role]) || role;
}

async function renderProjectOverviewTab(el) {
  overviewEnsureStyle();
  const pid = state.currentProjectId;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;

  let overview, members, notes, feed, docs;
  try {
    [overview, members, notes, feed, docs] = await Promise.all([
      api(`/projects/${pid}/overview`),
      api(`/projects/${pid}/members`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/notes`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  if (state.currentProjectId !== pid) return;

  const progressCardEl = document.getElementById("pov-progress-card");
  if (progressCardEl) {
    const totalStages = overview.stages.length;
    const doneStages = overview.stages.filter((s) => s.status === "completed" || s.status === "force_closed").length;
    const progressPct = totalStages ? Math.round((doneStages / totalStages) * 100) : 0;
    progressCardEl.innerHTML = ovProgressCardHtml(doneStages, totalStages);
  }
  const editBtn = document.getElementById("pov-edit-btn");
  if (editBtn) editBtn.onclick = () => openProjectEditModal(pid);
  const menuBtn = document.getElementById("pov-menu-btn");
  if (menuBtn) {
    menuBtn.classList.toggle("hidden", !isManager());
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      closeAllProjectCardMenus();
      const pop = document.createElement("div");
      pop.className = "project-card-menu-pop";
      pop.style.cssText = "position:absolute;right:0;top:calc(100% + 4px)";
      pop.innerHTML = `<button type="button" data-pm="delete" class="danger">🗑️ 刪除案件</button>`;
      pop.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeAllProjectCardMenus();
        openDeleteProjectModal(state.currentProject);
      });
      menuBtn.parentElement.appendChild(pop);
      setTimeout(() => {
        document.addEventListener("click", _onDocClickProjectMenu, true);
        document.addEventListener("keydown", _onKeyProjectMenu, true);
      }, 0);
    };
  }

  const proj = state.currentProject || {};
  const handlerMembers = members.filter((m) => ["case_staff", "case_owner"].includes(m.role_in_project));
  const managerMembers = members.filter((m) => ["manager", "sys_admin"].includes(m.role_in_project));
  const _names = (list) => list.map((m) => m.display_name || m.username).join("、") || "—";
  const handlerName = _names(handlerMembers);
  const managerName = _names(managerMembers);

  const metaRowEl = document.getElementById("pov-meta-row");
  if (metaRowEl) {
    metaRowEl.innerHTML = `
      <span class="ov-meta-item">📍 ${escapeHtml([proj.city, proj.district, proj.address].filter(Boolean).join("") || "臺北市中正區")}</span>
      <span class="ov-meta-item">📁 ${escapeHtml(proj.project_code || "2026-001")}</span>
      ${proj.case_type ? `<span class="ov-meta-item">🏢 ${escapeHtml(proj.case_type)}</span>` : ""}
      <span class="ov-meta-item">👤 負責人：${escapeHtml(handlerName)}</span>
      <span class="ov-meta-item">💼 主管：${escapeHtml(managerName)}</span>`;
  }
  const canEditMembers = isEditor();
  // 每種角色一個標籤+頭像顏色;主管/負責人沿用上面 handler/manager 的判斷
  const MEMBER_TAG = {
    sys_admin: ["主管", "manager"],
    manager: ["主管", "manager"],
    ocr_staff: ["都更主管", "manager"],
    case_owner: ["負責人", "handler"],
    case_staff: ["工作人員", "staff"],
    viewer: ["查詢人員", "viewer"],
    landowner: ["地主", "landowner"],
  };
  const membersHtml = members.length
    ? `<div class="ov-mem-list">${members
        .map((m) => {
          const [tagText, tone] = MEMBER_TAG[m.role_in_project] || ["", "staff"];
          const name = m.display_name || m.username || "?";
          return `<div class="ov-member-row ov-mem-row">
            <span class="ov-mem-avatar ov-mem-${tone}">${escapeHtml(name.charAt(0))}</span>
            <div class="ov-mem-main">
              <div class="ov-mem-name-row">
                <span class="ov-mem-name">${escapeHtml(name)}</span>
                ${tagText ? `<span class="ov-mem-tag ov-mem-${tone}">${tagText}</span>` : ""}
              </div>
              <div class="ov-mem-role">${escapeHtml(_ovMemberRoleLabel(m.role_in_project))}</div>
            </div>
            ${canEditMembers ? `<button type="button" class="ov-mem-menu" data-ov-member-menu="${m.user_id}" data-ov-member-name="${escapeHtml(name)}" title="更多">⋮</button>` : ""}
          </div>`;
        })
        .join("")}</div>`
    : `<div class="helper-text">尚未指派相關人員</div>`;
  const membersHeadHtml = `
    <div class="ov-km-head">
      <span class="ov-km-head-icon ov-mem-head-icon">${OV_KM_ICON.people}</span>
      <div class="ov-km-head-text">
        <div class="ov-km-head-title">相關人員</div>
        <div class="ov-km-head-sub">管理此案件的相關人員與聯絡方式</div>
      </div>
      ${canEditMembers ? `<button type="button" class="ov-mem-add" id="ov-add-member-btn">＋ 新增人員</button>` : ""}
    </div>`;

  const canEditNotes = isEditor();
  const timeline = [
    ...notes.map((n) => ({ id: n.id, time: n.occurred_at, text: n.content, who: n.author_name, isNote: true })),
    ...feed.map((a) => ({ time: a.created_at, text: a.action, who: a.user_name, isNote: false })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6);
  // 圖示顏色依紀錄內容猜類型(activity_logs 只存一句話,沒有結構化類型可用)
  const _recTone = (t) => {
    if (t.isNote) return "amber";
    const x = t.text || "";
    if (/\.pdf/i.test(x)) return "red";
    if (/\.(xlsx|xls|csv)/i.test(x) || x.includes("地主")) return "green";
    if (x.includes("他項")) return "purple";
    return "blue";
  };
  // 「上傳文件:檔名」這種紀錄 → 找回那份文件(同名取最新),點整列就能預覽
  const _recDocOf = (t) => {
    if (t.isNote) return null;
    const m = /上傳文件\s*[:：]\s*(.+)$/.exec(t.text || "");
    if (!m) return null;
    const name = m[1].trim();
    return (
      docs
        .filter((d) => d.file_name === name)
        .sort((a, b) => (parseApiDate(b.uploaded_at)?.getTime() || 0) - (parseApiDate(a.uploaded_at)?.getTime() || 0))[0] || null
    );
  };
  const timelineHtml = timeline.length
    ? `<div class="ov-rec-list">${timeline
        .map((t) => {
          const recDoc = _recDocOf(t);
          const menuBtn =
            t.isNote && canEditNotes
              ? `<button type="button" class="ov-rec-menu" data-ov-note-menu="${t.id}" title="更多">⋮</button>`
              : `<span class="ov-rec-menu-spacer"></span>`;
          return `<div class="ov-rec-row${recDoc ? " ov-rec-clickable" : ""}"${recDoc ? ` data-ov-rec-doc="${recDoc.id}" data-ov-rec-name="${escapeHtml(recDoc.file_name)}" title="點一下預覽 ${escapeHtml(recDoc.file_name)}" tabindex="0" role="button"` : ""}>
            <span class="ov-rec-icon ov-rec-${_recTone(t)}">${OV_KM_ICON.doc}</span>
            <div class="ov-rec-main">
              <span class="ov-rec-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</span>
              ${t.who ? `<span class="ov-rec-who">${OV_KM_ICON.clock}${escapeHtml(t.who)}</span>` : ""}
            </div>
            <span class="ov-rec-time">${OV_KM_ICON.clock}${fmtDateTime(t.time)}</span>
            ${menuBtn}
          </div>`;
        })
        .join("")}</div>`
    : `<div class="helper-text">尚無紀錄</div>`;
  const recordsHeadHtml = `
    <div class="ov-km-head">
      <span class="ov-km-head-icon">${OV_KM_ICON.doc}</span>
      <div class="ov-km-head-text">
        <div class="ov-km-head-title">重要紀錄</div>
        <div class="ov-km-head-sub">記錄案件的重要文件與作業內容</div>
      </div>
      <span class="ov-rec-count">${OV_KM_ICON.list} 共 ${timeline.length} 筆</span>
    </div>`;

  const stageBandEl = document.getElementById("ov-stage-band");
  if (stageBandEl) {
    stageBandEl.innerHTML = _renderStageTimeline(overview.stages);
    _alignBannerBgToStageLine();
    requestAnimationFrame(_alignBannerBgToStageLine);
  }

  const km = overview.key_metrics;
  const cur = km.headcount_detail;
  const prev = km.headcount_detail_last_week;
  const pctOfKind = (d, kind) => (d ? _ovPctOf(kind === "agreed" ? d.agreed : kind === "opposed" ? d.opposed : _ovDetailOther(d), d.total) : null);
  const kmPct = (kind) => {
    const c = pctOfKind(cur, kind);
    const p = pctOfKind(prev, kind);
    return { pct: c ?? 0, prev: p, delta: c != null && p != null ? c - p : null };
  };
  const kmWeekLabel = prev && km.last_week_date ? `本週 vs 上週 (至 ${fmtDate(km.last_week_date)})` : "本週 vs 上週";

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const docTotal = docs.length;
  const docThisWeek = docs.filter((d) => {
    const t = parseApiDate(d.uploaded_at);
    return t && t.getTime() >= sevenDaysAgo;
  }).length;
  const docLastWeekTotal = docTotal - docThisWeek;

  const infoItem = (tone, icon, label, value) => `
      <div class="ov-info2-item ov-info2-${tone}">
        <span class="ov-info2-icon">${icon}</span>
        <div class="ov-info2-text">
          <div class="ov-info2-label">${label}</div>
          <div class="ov-info2-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div>
        </div>
      </div>`;
  const infoHtml = `
    <div class="ov-info2-grid">
      ${infoItem("green", OV_KM_ICON.folder, "案件名稱", proj.name || "-")}
      ${infoItem("orange", OV_KM_ICON.pin, "地點", [proj.city, proj.district].filter(Boolean).join("") || "-")}
      <div class="ov-info2-wide">${infoItem("blue", OV_KM_ICON.calendar, "建立日期", proj.created_at ? fmtDate(proj.created_at) : "-")}</div>
    </div>`;
  const infoHeadHtml = `
    <div class="ov-km-head">
      <span class="ov-km-head-icon ov-info2-head-icon">${OV_KM_ICON.infoSolid}</span>
      <div class="ov-km-head-text">
        <div class="ov-km-head-title">案件資訊</div>
        <div class="ov-km-head-sub">此為案件的基本資料與重要資訊</div>
      </div>
    </div>`;

  const stageTasks = overview.stage_tasks || null;
  const pendingTaskCount = stageTasks ? (stageTasks.current?.tasks.filter(t => !t.done).length || 0) + (stageTasks.next?.tasks.filter(t => !t.done).length || 0) : 0;
  const todoBadge = pendingTaskCount > 0 ? `<span class="ov-title-pill">共 ${pendingTaskCount} 項</span>` : "";

  el.innerHTML = `
    <div class="ov-grid">
      <div class="ov-row ov-row-r2">
        <div class="ov-card">
          <div class="ov-km-head">
            <span class="ov-km-head-icon">${OV_KM_ICON.bars}</span>
            <div class="ov-km-head-text">
              <div class="ov-km-head-title">關鍵指標</div>
              <div class="ov-km-head-sub">本週與上週資料比較,掌握最新案件狀況</div>
            </div>
            <span class="ov-km-range">${OV_KM_ICON.calendar} ${kmWeekLabel}</span>
          </div>
          <div class="ov-metrics-group">
            <div class="ov-km-grid">
              ${(() => {
                const a = kmPct("agreed");
                const agreedCount = cur ? cur.agreed : km.headcount_agreed;
                const total = cur ? cur.total : km.headcount_total;
                return _ovKmCard({ icon: OV_KM_ICON.people, label: "人數同意", tip: "最新一次拜訪結果為「同意」的地主人數比例", tone: "agree", big: `${a.pct}%`, sub: `${agreedCount} / ${total} 人`, pct: a.pct, delta: a.delta, prev: a.prev, unit: "%", kind: "agreed" });
              })()}
              ${(() => {
                const o = kmPct("opposed");
                return _ovKmCard({ icon: OV_KM_ICON.cross, label: "反對", tip: "最新一次拜訪結果為「反對」的地主人數比例", tone: "oppose", big: `${o.pct}%`, sub: `${cur?.opposed || 0} / ${cur?.total || 0} 人`, pct: o.pct, delta: o.delta, prev: o.prev, unit: "%", kind: "opposed" });
              })()}
              ${(() => {
                const t = kmPct("other");
                return _ovKmCard({ icon: OV_KM_ICON.question, label: "其他", tip: "未決定+未回覆(含尚未拜訪)的地主人數比例", tone: "other", big: `${t.pct}%`, sub: `${_ovDetailOther(cur)} / ${cur?.total || 0} 人`, pct: t.pct, delta: t.delta, prev: t.prev, unit: "%", kind: "other" });
              })()}
              ${_ovKmCard({ icon: OV_KM_ICON.doc, label: "總件數", tip: "本案件的文件總數;較上週 = 近 7 天新上傳的件數", tone: "total", big: docTotal, sub: `本週新增 ${docThisWeek} 件`, pct: null, delta: docTotal - docLastWeekTotal, prev: docLastWeekTotal, unit: "" })}
            </div>
            <div class="ov-metrics">
              ${_ovHeadcountDetailHtml(cur, prev)}
            </div>
          </div>
        </div>
        <div class="ov-card">
          <div class="ov-km-head">
            <span class="ov-km-head-icon ov-todo-head-icon">${OV_KM_ICON.check}</span>
            <div class="ov-km-head-text">
              <div class="ov-km-head-title">待辦事項${todoBadge}</div>
              <div class="ov-km-head-sub">掌握各階段進度,確保案件順利推進</div>
            </div>
            <a href="#" class="ov-title-link ov-todo-more" onclick="goToProjectSopStage(${pid}, ${stageTasks?.current?.index ?? "null"});return false;">查看更多 →</a>
          </div>
          ${_ovTodosHtml(stageTasks)}
        </div>
      </div>

      <div class="ov-row ov-row-r3">
        <div class="ov-card">${recordsHeadHtml}${timelineHtml}</div>
        <div class="ov-side-stack">
          <div class="ov-card">${membersHeadHtml}${membersHtml}</div>
          <div class="ov-card">${infoHeadHtml}${infoHtml}</div>
        </div>
      </div>
    </div>`;

  const infoEditBtn = document.getElementById("ov-info-edit-btn");
  if (infoEditBtn) infoEditBtn.onclick = () => openProjectEditModal(pid);

  const rerenderSelf = () => renderProjectOverviewTab(el);
  const uploadBtn = document.getElementById("ov-upload-btn");
  if (uploadBtn) uploadBtn.onclick = () => openUploadDocumentModal(rerenderSelf);
  const addMemberBtn = document.getElementById("ov-add-member-btn");
  if (addMemberBtn) addMemberBtn.onclick = () => openAddMemberModal(members, rerenderSelf);

  el.querySelectorAll("[data-ov-member-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = btn.closest(".ov-member-row");
      const alreadyOpen = row && row.querySelector(".project-card-menu-pop");
      closeAllProjectCardMenus();
      if (alreadyOpen || !row) return;
      const pop = document.createElement("div");
      pop.className = "project-card-menu-pop";
      pop.style.cssText = "position:absolute;right:0;top:calc(100% + 2px);z-index:5";
      pop.innerHTML = `<button type="button" class="danger" data-act="remove">🗑️ 移除此成員</button>`;
      pop.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeAllProjectCardMenus();
        if (!confirm(`確定要將「${btn.dataset.ovMemberName}」移出這個案件嗎?`)) return;
        try {
          await api(`/projects/${pid}/members/${btn.dataset.ovMemberMenu}`, { method: "DELETE" });
          toast("已移除", "success");
          rerenderSelf();
        } catch (err) { }
      });
      row.appendChild(pop);
      setTimeout(() => {
        document.addEventListener("click", _onDocClickProjectMenu, true);
        document.addEventListener("keydown", _onKeyProjectMenu, true);
      }, 0);
    });
  });

  el.querySelectorAll("[data-ov-rec-doc]").forEach((row) => {
    const open = () => viewDocument(Number(row.dataset.ovRecDoc), row.dataset.ovRecName);
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      open();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
  });
  el.querySelectorAll("[data-ov-note-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = btn.closest(".ov-rec-row");
      const alreadyOpen = row && row.querySelector(".project-card-menu-pop");
      closeAllProjectCardMenus();
      if (alreadyOpen || !row) return;
      const pop = document.createElement("div");
      pop.className = "project-card-menu-pop";
      pop.style.cssText = "position:absolute;right:0;top:calc(100% + 2px);z-index:5";
      pop.innerHTML = `<button type="button" class="danger" data-act="remove">🗑️ 刪除這則公告</button>`;
      pop.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        closeAllProjectCardMenus();
        if (!confirm("確定要刪除這則公告嗎?")) return;
        try {
          await api(`/projects/${pid}/notes/${btn.dataset.ovNoteMenu}`, { method: "DELETE" });
          toast("已刪除", "success");
          rerenderSelf();
        } catch (err) { }
      });
      row.appendChild(pop);
      setTimeout(() => {
        document.addEventListener("click", _onDocClickProjectMenu, true);
        document.addEventListener("keydown", _onKeyProjectMenu, true);
      }, 0);
    });
  });

  el.querySelectorAll("[data-ov-metric]").forEach((tile) => {
    const open = () => _ovOpenMetricDetail(pid, tile.dataset.ovMetric);
    tile.addEventListener("click", open);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });

}
