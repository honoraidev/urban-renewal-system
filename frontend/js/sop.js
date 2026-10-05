"use strict";

// 上傳按鈕用的藍色雲端上傳圖示
const SOP_DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/></svg>`;
const SOP_EYE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SOP_UPLOAD_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 7.97"/><path d="M12 12v8M9 15l3-3 3 3"/></svg>`;

// 內建關卡代碼清單(跟 backend/routers/sop.py 的 STAGE_DEFINITIONS 同一份定義,同一套
// 慣例:後端是權威來源,這裡只是給「客製化關卡流程」編輯器當可選清單/預設值用)。
const SOP_DEFAULT_STAGE_DEFS = [
  { key: "initial_approval", name: "初始核定立案" },
  { key: "ocr_roster", name: "籌備階段" },
  { key: "contact_rate", name: "地主拜訪" },
  { key: "briefing_1", name: "都更說明會" },
  { key: "consent_dual_1", name: "意願書簽署" },
  { key: "consultant_review", name: "圖面規劃與估價" },
  { key: "briefing_2", name: "第2次都更說明會" },
  { key: "briefing_3", name: "合約說明會" },
  { key: "consent_dual_2", name: "簽約階段" },
  { key: "consent_final", name: "送件審查" },
];
const DUAL_GATE_KEYS = ["consent_dual_1", "consent_dual_2", "consent_final"];
const CONTACT_RATE_THRESHOLD = 0.95;

function sopStageLabel(key, stageObj) {
  if (stageObj && stageObj.name) return stageObj.name;
  if (stageObj && stageObj.custom_name) return stageObj.custom_name;
  // dashboard.js 只知道 current_stage 數字,沒有這個案件完整的
  // stage 物件(拿不到客製化後的真實名稱)- 退回用內建預設流程的位置對照,對沒客製
  // 化過的案件(絕大多數)結果會是對的,客製化過的頂多顯示成預設名稱。
  const def = SOP_DEFAULT_STAGE_DEFS[Number(key)];
  if (def) return def.name;
  return `第${key}階段`;
}

// 客製化關卡流程後,內建關卡不一定還在原本的位置(甚至可能被刪掉了/改名了) - 這裡
// 一律用 stage.key(後端已經幫每一關解析好)去對 checklist 設定,不用陣列位置。
// 下拉群組(一列可展開,裡面是各自要上傳的文件)
const SOP_GROUPS = {
  consultant: { key: "consultant", label: "顧問文件", sub: "顧問文件、顧問合約、基地簡報、共同負擔", icon: "📄", theme: "theme-blue" },
  architect: { key: "architect", label: "建築師文件", sub: "各樓層圖面、建築師合約", icon: "🏢", theme: "theme-green" },
  appraiser: { key: "appraiser", label: "估價師文件", sub: "估價報告、估價合約", icon: "📊", theme: "theme-orange" },
  contract: { key: "contract", label: "合約", sub: "合約與地主身分、權狀、同意書等文件", icon: "✍️", theme: "theme-blue" },
};

// 任務清單用的線條圖示(取代 emoji):顏色吃外層主題色(currentColor)
const _sopSvg = (inner) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const SOP_LINE_ICONS = {
  "📄": _sopSvg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  "🏢": _sopSvg('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>'),
  "📊": _sopSvg('<path d="M4 20h16"/><rect x="5" y="11" width="3.2" height="9" rx="1"/><rect x="10.4" y="6" width="3.2" height="14" rx="1"/><rect x="15.8" y="13" width="3.2" height="7" rx="1"/>'),
  "🛡️": _sopSvg('<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
  "🗺️": _sopSvg('<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  "🏠": _sopSvg('<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 10v10h13V10M10 20v-5h4v5"/>'),
  "👥": _sopSvg('<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5.3a3.2 3.2 0 0 1 0 6M17.5 14.2a5.5 5.5 0 0 1 3.5 5.3"/>'),
  "📈": _sopSvg('<path d="M4 19h16M5 15l4-4 3.5 3L19 7"/><path d="M15 7h4v4"/>'),
  "🎤": _sopSvg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>'),
  contract: _sopSvg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 17c1.2-2 2.2-2 3 0s2 2 3.5 0"/>'),
  presentation: _sopSvg('<rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M12 16v4M8 20h8M7 12l3-3 2.5 2.5L17 8"/>'),
  burden: _sopSvg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>'),
  layers: _sopSvg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>'),
  entry: _sopSvg('<path d="M5 21V4h9v17M3 21h18M14 8h5v13"/><circle cx="11.5" cy="13" r=".7"/>'),
  basement: _sopSvg('<rect x="4" y="3" width="16" height="9" rx="1.5"/><path d="M4 16h16M12 13v8M9 18l3 3 3-3"/>'),
  stairsDown: _sopSvg('<path d="M3 5h5v5h5v5h5v5"/><path d="M3 5v0M16 8l3 3-3 3"/>'),
  idcard: _sopSvg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.3 3.2-2.3s2.6.7 3.2 2.3M14.5 10h4M14.5 13.5h3"/>'),
  land: _sopSvg('<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  title: _sopSvg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="12" cy="14.5" r="2.5"/><path d="M10.6 16.6L10 20l2-1 2 1-.6-3.4"/>'),
  checkdoc: _sopSvg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.8 14l2.2 2.2 4.2-4.4"/>'),
  demolish: _sopSvg('<path d="M14 6l4 4M12 8l-8 8 3 3 8-8M15 5l4-1-1 4"/><path d="M4 21h8"/>'),
  stamp: _sopSvg('<path d="M9 14V9a3 3 0 1 1 6 0v5"/><path d="M5 14h14v4H5zM4 21h16"/>'),
  "✍️": _sopSvg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
};
const sopIconHtml = (emoji) => SOP_LINE_ICONS[emoji] || SOP_LINE_ICONS["📄"];

// 把逐項結果組成清單:同一個 group 的連續項目收成一列「可下拉」的卡片,展開才看得到各自的上傳項目。
// 展開中的下拉(群組 / 還沒上傳的地主清單)。上傳、確認後整頁會重畫,靠這份記錄把原本展開的維持展開。
const _sopOpenDropdowns = new Set();
let _sopAutoAdvanceTried = "";

function buildSopChecklistHtml(results, stageNo) {
  let out = "";
  let i = 0;
  while (i < results.length) {
    // 有子項目的列:父列照原樣顯示(含自己的上傳按鈕),後面連續的子項目收進它的展開面板
    if (results[i].hasSubs) {
      const parent = results[i];
      const kids = [];
      i++;
      while (i < results.length && results[i].parentKey === parent.itemKey) {
        kids.push(results[i]);
        i++;
      }
      const open = _sopOpenDropdowns.has(`${stageNo}:sub:${parent.itemKey}`);
      out += `<div class="sop-group-wrap">${parent.html}<div class="sop-group-panel sop-checklist"${open ? "" : " hidden"}>${kids.map((k) => k.html).join("")}</div></div>`;
      continue;
    }
    const g = results[i].group;
    if (!g) {
      out += results[i].html;
      i++;
      continue;
    }
    const members = [];
    while (i < results.length && results[i].group && results[i].group.key === g.key) {
      members.push(results[i]);
      i++;
    }
    const ddKey = `${stageNo}:group:${g.key}`;
    const isOpen = _sopOpenDropdowns.has(ddKey);
    const doneN = members.filter((m) => m.done).length;
    const allDone = doneN === members.length;
    out += `<div class="sop-group-wrap">
      <div class="sop-checklist-item ${allDone ? "done" : ""}">
        <div class="sop-checklist-checkbox">${allDone ? '<span class="sop-check-v">✓</span>' : ""}</div>
        <div class="sop-checklist-icon-box ${g.theme}"><span class="sop-icon-emoji">${sopIconHtml(g.icon)}</span></div>
        <div class="sop-checklist-body">
          <div class="sop-checklist-label">${escapeHtml(g.label)}</div>
          <div class="sop-checklist-sub">${g.optional ? "已上傳" : "已完成"} ${doneN}/${members.length} 項・${escapeHtml(g.sub)}</div>
        </div>
        <div class="sop-checklist-right">
          <div class="sop-status-pill ${allDone ? "done" : "pending"}"><span class="sop-status-icon">${allDone ? "✓" : g.optional ? "◦" : "🕒"}</span><span>${allDone ? "已完成" : g.optional ? "選填" : "尚未完成"}</span></div>
          <div class="sop-checklist-actions">
            <button type="button" class="btn-secondary btn-sm doc-icon-btn${isOpen ? " sop-wr-open" : ""}" data-sop-group-toggle="${ddKey}" title="展開 / 收合" aria-label="展開 / 收合" aria-expanded="${isOpen}"><span class="sop-wr-chev">▾</span></button>
          </div>
        </div>
      </div>
      <div class="sop-group-panel sop-checklist"${isOpen ? "" : " hidden"}>${members.map((m) => m.html).join("")}</div>
    </div>`;
  }
  return out;
}

const SOP_STAGE_CHECKLISTS = {
  initial_approval: [
    { key: "roi_report", label: "上傳投報表", docType: "roi_report" },
  ],
  ocr_roster: [
    { key: "cadastral_map", label: "上傳地籍圖", docType: "cadastral_map" },
    { key: "land_deed", label: "上傳土地謄本PDF", countOf: "land", action: "land", hasSubs: true },
    { key: "land_transcript_type1", label: "第一類謄本", docType: "land_transcript_type1", parent: "land_deed", optional: true, icon: "📄", theme: "theme-amber" },
    { key: "land_transcript_type2", label: "第二類謄本", docType: "land_transcript_type2", parent: "land_deed", optional: true, icon: "checkdoc", theme: "theme-amber" },
    { key: "land_transcript_type3", label: "第三類謄本", docType: "land_transcript_type3", parent: "land_deed", optional: true, icon: "title", theme: "theme-amber" },
    { key: "building_deed", label: "上傳建物謄本PDF", countOf: "building", action: "building", hasSubs: true },
    { key: "building_transcript_type1", label: "第一類謄本", docType: "building_transcript_type1", parent: "building_deed", optional: true, icon: "📄", theme: "theme-teal" },
    { key: "building_transcript_type2", label: "第二類謄本", docType: "building_transcript_type2", parent: "building_deed", optional: true, icon: "checkdoc", theme: "theme-teal" },
    { key: "building_transcript_type3", label: "第三類謄本", docType: "building_transcript_type3", parent: "building_deed", optional: true, icon: "title", theme: "theme-teal" },
    { key: "landowner_roster_confirmed", label: "確認地主清冊正確", manual: true },
  ],
  contact_rate: [
    { key: "contact_info_established", label: "地主聯絡方式建立", countOf: "landowner_with_phone" },
    { key: "contact_rate_95", label: "達到95%聯絡門檻", contactRate: true },
  ],
  consent_dual_1: [
    { key: "willingness_80", label: "意願書簽署人數達80%", willingnessRatio: true, threshold: 0.8 },
  ],
  consent_dual_2: [
    { key: "signed_80", label: "已簽約人數達80%", signedRatio: true, threshold: 0.8 },
  ],
  briefing_1: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "invitation_letter", label: "上傳邀請函", docType: "invitation_letter" },
    { key: "briefing_reviewed_3", label: "主管審核通過", manual: true, managerOnly: true },
  ],
  consultant_review: [
    { key: "consultant_document", label: "上傳顧問文件", docType: "consultant_document", icon: "📄", group: SOP_GROUPS.consultant },
    { key: "consultant_contract", label: "上傳顧問合約", docType: "consultant_contract", icon: "contract", group: SOP_GROUPS.consultant },
    { key: "site_briefing", label: "上傳基地簡報", docType: "site_briefing", icon: "presentation", group: SOP_GROUPS.consultant },
    { key: "common_burden", label: "上傳共同負擔", docType: "common_burden", icon: "burden", group: SOP_GROUPS.consultant },
    { key: "arch_standard_floor", label: "上傳標準層圖面", docType: "arch_standard_floor", icon: "layers", group: SOP_GROUPS.architect },
    { key: "arch_floor_1", label: "上傳一樓圖面", docType: "arch_floor_1", icon: "entry", group: SOP_GROUPS.architect },
    { key: "arch_basement_1", label: "上傳地下一樓圖面", docType: "arch_basement_1", icon: "basement", group: SOP_GROUPS.architect },
    { key: "arch_basement_2plus", label: "上傳地下二樓以下圖面", docType: "arch_basement_2plus", icon: "stairsDown", group: SOP_GROUPS.architect },
    { key: "architect_contract", label: "上傳建築師合約", docType: "architect_contract", icon: "contract", group: SOP_GROUPS.architect },
    { key: "appraisal_result", label: "上傳估價報告", docType: "appraisal_result", icon: "📊", group: SOP_GROUPS.appraiser },
    { key: "appraisal_contract", label: "上傳估價合約", docType: "appraisal_contract", icon: "contract", group: SOP_GROUPS.appraiser },
    { key: "consultant_reviewed", label: "主管審核通過", manual: true, managerOnly: true },
  ],
  briefing_2: [
    { key: "contract_template", label: "上傳合約", docType: "contract_template" },
    { key: "consent_form_template", label: "上傳意願書", docType: "consent_form_template" },
    { key: "invitation_letter", label: "上傳邀請函", docType: "invitation_letter" },
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "chairman_approved_roi", label: "上傳董事長簽核之投報表", docType: "chairman_approved_roi" },
    { key: "unit_area_split", label: "上傳分坪表", docType: "unit_area_split" },
    { key: "briefing_reviewed_6", label: "主管審核通過", manual: true, managerOnly: true },
  ],
  briefing_3: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "contract_template", label: "上傳合約", docType: "contract_template", icon: "contract", group: SOP_GROUPS.contract },
    { key: "id_copy", label: "上傳身分證影本", docType: "id_copy", icon: "idcard", group: SOP_GROUPS.contract },
    { key: "land_title", label: "上傳土地所有權狀", docType: "land_title", icon: "land", group: SOP_GROUPS.contract },
    { key: "building_title", label: "上傳建築所有權狀", docType: "building_title", icon: "🏢", group: SOP_GROUPS.contract },
    { key: "renewal_consent", label: "上傳都市更新事業計劃同意書", docType: "renewal_consent", icon: "checkdoc", group: SOP_GROUPS.contract },
    { key: "demolition_consent", label: "上傳建物拆除同意書", docType: "demolition_consent", icon: "demolish", group: SOP_GROUPS.contract },
    { key: "seal_consent", label: "上傳代刻印章同意書", docType: "seal_consent", icon: "stamp", group: SOP_GROUPS.contract },
    { key: "briefing_reviewed_7", label: "主管審核通過", manual: true, managerOnly: true },
  ],
};

// ========== 自訂關卡流程編輯器 ==========
// 兩個地方共用:1) 案件內 SOP 頁「自訂關卡流程」按鈕(直接呼叫 API 儲存)
// 2) 建立案件精靈(onSave 先只存進精靈的本地狀態,案件建立成功後才真正呼叫 API)。
let sopFlowEditorState = null; // { stages: [{key,name,requirements}], onSave(stages) }
let sopFlowAdvancedOpen = new Set(); // 展開了「進階需求設定」的 row index

const SOP_REQUIREMENT_DOC_TYPES = ["roi_report", "cadastral_map", "briefing_material", "consultant_document", "consent_form_template", "contract_template", "property_register", "building_register", "consent_form", "contract", "willingness_form", "other"];

function emptyStageRequirements() {
  return {
    document_required: false, document_type: null,
    contact_rate_required: false, contact_rate_threshold: 0.95,
    ratio_required: false, ratio_threshold: 0.8,
    manual_required: false, manual_label: "",
  };
}

function sopFlowRowAdvancedHtml(row, i) {
  const req = row.requirements || emptyStageRequirements();
  return `
    <div class="sop-flow-advanced">
      <label class="sop-flow-req-check">
        <input type="checkbox" data-req-doc="${i}" ${req.document_required ? "checked" : ""}>
        需上傳文件
        <select data-req-doc-type="${i}" ${req.document_required ? "" : "disabled"}>
          ${SOP_REQUIREMENT_DOC_TYPES.map((t) => `<option value="${t}" ${req.document_type === t ? "selected" : ""}>${DOC_TYPE_LABEL[t] || t}</option>`).join("")}
        </select>
      </label>
      <label class="sop-flow-req-check">
        <input type="checkbox" data-req-contact="${i}" ${req.contact_rate_required ? "checked" : ""}>
        需達到聯絡率門檻
        <input type="number" min="1" max="100" data-req-contact-threshold="${i}" value="${Math.round((req.contact_rate_threshold ?? 0.95) * 100)}" ${req.contact_rate_required ? "" : "disabled"} style="width:60px">%
      </label>
      <label class="sop-flow-req-check">
        <input type="checkbox" data-req-ratio="${i}" ${req.ratio_required ? "checked" : ""}>
        需達到同意度雙門檻(人數+面積)
        <input type="number" min="1" max="100" data-req-ratio-threshold="${i}" value="${Math.round((req.ratio_threshold ?? 0.8) * 100)}" ${req.ratio_required ? "" : "disabled"} style="width:60px">%
      </label>
      <label class="sop-flow-req-check">
        <input type="checkbox" data-req-manual="${i}" ${req.manual_required ? "checked" : ""}>
        需人工確認
        <input type="text" data-req-manual-label="${i}" value="${escapeHtml(req.manual_label || "")}" placeholder="確認項目文字(如:主管審核通過)" ${req.manual_required ? "" : "disabled"} style="flex:1;min-width:140px">
      </label>
    </div>`;
}

function sopFlowEditorRowsHtml() {
  const stages = sopFlowEditorState.stages;
  const lockedCount = sopFlowEditorState.lockedCount || 0;
  const usedKeys = new Set(stages.map((s) => s.key).filter(Boolean));
  return stages
    .map((row, i) => {
      // 案件已經開始跑之後,「已經開始/完成」的關卡(index < lockedCount)鎖住不能改
      // (改名/換門檻/搬動/刪除都不行),只能調整還沒跑到的未來關卡 —— 已確認的打勾、
      // 上傳的文件、同意書進度都是照關卡編號存的,動了前面的關卡這些資料就對不起來了。
      if (i < lockedCount) {
        return `
      <div class="sop-flow-row sop-flow-row-locked">
        <span class="sop-flow-row-num">${i + 1}</span>
        <span class="sop-flow-row-locked-name" title="已經開始/完成的關卡,不能調整">🔒 ${escapeHtml(row.name || "")}</span>
      </div>`;
      }
      const keyOptions = SOP_DEFAULT_STAGE_DEFS.filter((d) => row.key === d.key || !usedKeys.has(d.key))
        .map((d) => `<option value="${d.key}" ${row.key === d.key ? "selected" : ""}>${escapeHtml(d.name)}(內建自動門檻)</option>`)
        .join("");
      const advancedOpen = sopFlowAdvancedOpen.has(i);
      const hasCustomReq = !!row.requirements;
      return `
      <div class="sop-flow-row">
        <span class="sop-flow-row-num">${i + 1}</span>
        <select class="sop-flow-row-type" data-flow-type="${i}">
          <option value="" ${!row.key ? "selected" : ""}>自訂關卡(人工完成)</option>
          ${keyOptions}
        </select>
        <input type="text" class="sop-flow-row-name" data-flow-name="${i}" value="${escapeHtml(row.name || "")}" placeholder="關卡名稱">
        <div class="sop-flow-row-actions">
          <button type="button" class="btn-secondary btn-sm" data-flow-advanced-toggle="${i}" title="進階需求設定">⚙${hasCustomReq ? " •" : ""}</button>
          <button type="button" class="btn-secondary btn-sm" data-flow-up="${i}" ${i <= lockedCount ? "disabled" : ""} title="上移">↑</button>
          <button type="button" class="btn-secondary btn-sm" data-flow-down="${i}" ${i === stages.length - 1 ? "disabled" : ""} title="下移">↓</button>
          <button type="button" class="btn-danger btn-sm" data-flow-remove="${i}" ${stages.length <= Math.max(1, lockedCount) ? "disabled" : ""} title="刪除">✕</button>
        </div>
      </div>
      ${advancedOpen ? sopFlowRowAdvancedHtml(row, i) : ""}`;
    })
    .join("");
}

function renderSopFlowEditorBody() {
  const lockedCount = sopFlowEditorState.lockedCount || 0;
  return `
    <div class="sop-flow-editor">
      <p class="helper-text">自訂這個案件要跑的關卡流程:可新增、刪除、改名、排序。選「內建關卡」會沿用該關卡原本的自動門檻;點每一列的「⚙」可以自己勾選這一關要的需求(上傳文件/聯絡率/同意度雙門檻/人工確認,可複選),設定過的話一律以這裡為準,不再看內建門檻。${
        lockedCount ? `<br>🔒 前 ${lockedCount} 關已經開始/完成,鎖住不能調整,只能新增/調整後面還沒跑到的關卡。` : ""
      }</p>
      <div class="sop-flow-rows" id="sop-flow-rows">${sopFlowEditorRowsHtml()}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn-secondary btn-sm" id="sop-flow-add-btn">+ 新增關卡</button>
        <button type="button" class="btn-secondary btn-sm" id="sop-flow-reset-btn" ${lockedCount ? `disabled title="已經開始跑的案件不能整個還原成預設流程"` : ""}>還原成預設流程</button>
      </div>
      <div class="modal-footer" style="margin-top:20px">
        <button type="button" class="btn-primary" id="sop-flow-save-btn">儲存</button>
      </div>
    </div>`;
}

function rerenderSopFlowEditor() {
  const rowsEl = document.getElementById("sop-flow-rows");
  if (rowsEl) rowsEl.innerHTML = sopFlowEditorRowsHtml();
  wireSopFlowEditorRows();
}

function wireSopFlowEditorRows() {
  const root = document.getElementById("modal-root");
  root.querySelectorAll("[data-flow-name]").forEach((input) => {
    input.oninput = () => {
      sopFlowEditorState.stages[Number(input.dataset.flowName)].name = input.value;
    };
  });
  root.querySelectorAll("[data-flow-type]").forEach((sel) => {
    sel.onchange = () => {
      const i = Number(sel.dataset.flowType);
      const key = sel.value || null;
      sopFlowEditorState.stages[i].key = key;
      if (key) {
        const def = SOP_DEFAULT_STAGE_DEFS.find((d) => d.key === key);
        if (def) sopFlowEditorState.stages[i].name = def.name;
      }
      rerenderSopFlowEditor();
    };
  });
  root.querySelectorAll("[data-flow-up]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.flowUp);
      const arr = sopFlowEditorState.stages;
      if (i > 0) {
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        sopFlowAdvancedOpen = new Set();
        rerenderSopFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-flow-down]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.flowDown);
      const arr = sopFlowEditorState.stages;
      if (i < arr.length - 1) {
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        sopFlowAdvancedOpen = new Set();
        rerenderSopFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-flow-remove]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.flowRemove);
      if (sopFlowEditorState.stages.length > 1) {
        sopFlowEditorState.stages.splice(i, 1);
        sopFlowAdvancedOpen = new Set();
        rerenderSopFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-flow-advanced-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.flowAdvancedToggle);
      if (sopFlowAdvancedOpen.has(i)) sopFlowAdvancedOpen.delete(i);
      else sopFlowAdvancedOpen.add(i);
      rerenderSopFlowEditor();
    };
  });

  const ensureReq = (i) => {
    if (!sopFlowEditorState.stages[i].requirements) {
      sopFlowEditorState.stages[i].requirements = emptyStageRequirements();
    }
    return sopFlowEditorState.stages[i].requirements;
  };
  root.querySelectorAll("[data-req-doc]").forEach((cb) => {
    cb.onchange = () => {
      const i = Number(cb.dataset.reqDoc);
      ensureReq(i).document_required = cb.checked;
      if (cb.checked && !sopFlowEditorState.stages[i].requirements.document_type) {
        sopFlowEditorState.stages[i].requirements.document_type = SOP_REQUIREMENT_DOC_TYPES[0];
      }
      rerenderSopFlowEditor();
      sopFlowAdvancedOpen.add(i);
    };
  });
  root.querySelectorAll("[data-req-doc-type]").forEach((sel) => {
    sel.onchange = () => {
      ensureReq(Number(sel.dataset.reqDocType)).document_type = sel.value;
    };
  });
  root.querySelectorAll("[data-req-contact]").forEach((cb) => {
    cb.onchange = () => {
      const i = Number(cb.dataset.reqContact);
      ensureReq(i).contact_rate_required = cb.checked;
      rerenderSopFlowEditor();
      sopFlowAdvancedOpen.add(i);
    };
  });
  root.querySelectorAll("[data-req-contact-threshold]").forEach((input) => {
    input.oninput = () => {
      const v = Math.min(100, Math.max(1, Number(input.value) || 95));
      ensureReq(Number(input.dataset.reqContactThreshold)).contact_rate_threshold = v / 100;
    };
  });
  root.querySelectorAll("[data-req-ratio]").forEach((cb) => {
    cb.onchange = () => {
      const i = Number(cb.dataset.reqRatio);
      ensureReq(i).ratio_required = cb.checked;
      rerenderSopFlowEditor();
      sopFlowAdvancedOpen.add(i);
    };
  });
  root.querySelectorAll("[data-req-ratio-threshold]").forEach((input) => {
    input.oninput = () => {
      const v = Math.min(100, Math.max(1, Number(input.value) || 80));
      ensureReq(Number(input.dataset.reqRatioThreshold)).ratio_threshold = v / 100;
    };
  });
  root.querySelectorAll("[data-req-manual]").forEach((cb) => {
    cb.onchange = () => {
      const i = Number(cb.dataset.reqManual);
      ensureReq(i).manual_required = cb.checked;
      rerenderSopFlowEditor();
      sopFlowAdvancedOpen.add(i);
    };
  });
  root.querySelectorAll("[data-req-manual-label]").forEach((input) => {
    input.oninput = () => {
      ensureReq(Number(input.dataset.reqManualLabel)).manual_label = input.value;
    };
  });
}

function openSopStageFlowEditor(initialStages, onSave, lockedCount = 0) {
  sopFlowAdvancedOpen = new Set();
  sopFlowEditorState = {
    stages: (initialStages && initialStages.length ? initialStages : SOP_DEFAULT_STAGE_DEFS).map((s) => ({
      key: s.key || null,
      name: s.name,
      requirements: s.requirements || null,
    })),
    lockedCount,
    onSave,
  };
  openModal("自訂關卡流程", renderSopFlowEditorBody(), { width: "680px" });
  wireSopFlowEditorRows();

  document.getElementById("sop-flow-add-btn").onclick = () => {
    sopFlowEditorState.stages.push({ key: null, name: "", requirements: null });
    rerenderSopFlowEditor();
  };
  document.getElementById("sop-flow-reset-btn").onclick = async () => {
    const ok = await confirmDialog("確定要還原成系統預設的10關流程嗎?目前編輯的內容會被取代。", {
      title: "還原預設流程?",
    });
    if (!ok) return;
    sopFlowAdvancedOpen = new Set();
    sopFlowEditorState.stages = SOP_DEFAULT_STAGE_DEFS.map((d) => ({ key: d.key, name: d.name, requirements: null }));
    rerenderSopFlowEditor();
  };
  document.getElementById("sop-flow-save-btn").onclick = async () => {
    const stages = sopFlowEditorState.stages.map((s) => ({
      key: s.key || null,
      name: (s.name || "").trim(),
      requirements: s.requirements || null,
    }));
    if (stages.some((s) => !s.name)) {
      toast("每一關都要有名稱", "error");
      return;
    }
    const saveBtn = document.getElementById("sop-flow-save-btn");
    saveBtn.disabled = true;
    try {
      await sopFlowEditorState.onSave(stages);
    } catch (err) {
      saveBtn.disabled = false;
    }
  };
}

// 任何一關只要自訂了 requirements(見自訂關卡流程編輯器的「進階需求設定」),就用
// 這裡動態組出跟 SOP_STAGE_CHECKLISTS 內建關卡同樣形狀的 checklist 項目清單,共用
// 同一套渲染/判斷邏輯(見 renderSopTab 的 itemsHtml),不用另外寫一份 UI。
function buildGenericChecklistConfig(requirements) {
  const items = [];
  if (requirements.document_required) {
    const label = DOC_TYPE_LABEL[requirements.document_type] || requirements.document_type || "文件";
    items.push({ key: "generic_document", label: `上傳${label}`, docType: requirements.document_type });
  }
  if (requirements.contact_rate_required) {
    const threshold = requirements.contact_rate_threshold || 0.95;
    items.push({ key: "generic_contact_rate", label: `達到聯絡率門檻(${Math.round(threshold * 100)}%)`, contactRate: true, threshold });
  }
  if (requirements.ratio_required) {
    const threshold = requirements.ratio_threshold || 0.8;
    items.push({ key: "generic_ratio", label: `達到同意度雙門檻(人數與面積皆需 ≥ ${Math.round(threshold * 100)}%)`, ratioGate: true, threshold });
  }
  if (requirements.manual_required) {
    items.push({ key: "manual_confirmed", label: requirements.manual_label || "人工確認", manual: true });
  }
  return items;
}

function verifyDocumentFileType(file, docType) {
  if (!file || !docType) return { matched: true };

  const fileName = (file.name || "").toLowerCase();
  const normalizedFileName = fileName.replace(/\s+/g, "");
  const expectedKeywords = DOC_TYPE_KEYWORDS[docType];
  const targetLabel = DOC_TYPE_LABEL[docType] || docType;

  if (!expectedKeywords || expectedKeywords.length === 0) {
    return { matched: true, targetLabel };
  }

  // Check if filename strongly matches a DIFFERENT document type
  let detectedOtherLabel = null;
  for (const [typeKey, keywords] of Object.entries(DOC_TYPE_KEYWORDS)) {
    if (typeKey === docType) continue;
    const matchedOtherKw = keywords.find((kw) => {
      const kwLower = kw.toLowerCase();
      return fileName.includes(kwLower) || normalizedFileName.includes(kwLower.replace(/\s+/g, ""));
    });
    if (matchedOtherKw) {
      detectedOtherLabel = DOC_TYPE_LABEL[typeKey] || typeKey;
      break;
    }
  }

  // Direct keyword match
  const hasDirectMatch = expectedKeywords.some((kw) => {
    const kwLower = kw.toLowerCase();
    return fileName.includes(kwLower) || normalizedFileName.includes(kwLower.replace(/\s+/g, ""));
  });

  if (detectedOtherLabel) {
    return {
      matched: false,
      targetLabel,
      detectedOtherLabel,
      fileName: file.name,
    };
  }

  if (!hasDirectMatch) {
    return {
      matched: false,
      targetLabel,
      fileName: file.name,
    };
  }

  return { matched: true, targetLabel };
}

async function inspectAndConfirmDocumentUpload(file, docType) {
  // 「檔案內容與上傳類別是否相符」的檢查已移除(掃描檔 OCR 很慢):一律直接放行。
  // 保留這個函式與呼叫端不動,下面原本的檢查邏輯不會再執行。
  return true;
  // eslint-disable-next-line no-unreachable
  if (!file || !docType || docType === "other" || docType === "photo") return true;

  const pid = state.currentProjectId;
  const clientCheck = verifyDocumentFileType(file, docType);

  let inspectResult = null;
  if (pid) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    try {
      inspectResult = await api(`/projects/${pid}/documents/inspect`, {
        method: "POST",
        body: fd,
        isForm: true,
        silent: true,
      });
    } catch (err) {
      inspectResult = null;
    }
  }

  const isMismatch = (inspectResult && inspectResult.matched === false) || (!inspectResult && !clientCheck.matched) || (!clientCheck.matched);
  if (!isMismatch) return true;

  const targetLabel = (inspectResult && inspectResult.target_label) || clientCheck.targetLabel || docType;
  const detectedOtherLabel = (inspectResult && inspectResult.detected_other_label) || clientCheck.detectedOtherLabel;
  const detectedTitle = inspectResult && inspectResult.detected_title ? inspectResult.detected_title.trim() : "";
  const filenameMisleading = inspectResult && !inspectResult.matched && clientCheck.matched;

  return new Promise((resolve) => {
    const modalHtml = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:42px;margin-bottom:10px">⚠️</div>
        <h3 style="margin-bottom:12px;color:var(--text-primary)">檔案內容與上傳類別不符</h3>
        <p style="color:var(--text-secondary);font-size:14px;line-height:1.6;margin-bottom:12px">
          上傳目標位置：<strong style="color:var(--primary-color)">【${escapeHtml(targetLabel)}】</strong><br>
          選擇的檔案名稱：<code style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;color:var(--text-primary);display:inline-block;margin-top:4px;word-break:break-all">${escapeHtml(file.name)}</code>
        </p>
        ${detectedTitle
          ? `<div style="background:var(--bg-secondary);border:1px solid var(--border-color);padding:10px 14px;border-radius:6px;text-align:left;font-size:13px;margin-bottom:14px">
                <span style="color:var(--text-tertiary);display:block;font-size:12px;margin-bottom:4px">📄 檔案內文 OCR 辨識到的標題：</span>
                <strong style="color:var(--text-primary);font-size:15px">「${escapeHtml(detectedTitle)}」</strong>
               </div>`
          : ""
        }
        ${detectedOtherLabel
          ? `<div style="background:rgba(239, 68, 68, 0.1);color:#ef4444;border:1px solid rgba(239, 68, 68, 0.2);font-size:13px;padding:8px 12px;border-radius:6px;display:inline-block;margin-bottom:16px">
                ⚡ 系統分析檔案內文實際為：<strong>【${escapeHtml(detectedOtherLabel)}】</strong>
                ${filenameMisleading ? `<div style="font-size:12px;margin-top:4px;color:var(--text-secondary)">（檔名可能命名錯誤，內文實際與【${escapeHtml(targetLabel)}】不符）</div>` : ""}
               </div>`
          : ""
        }
        <p style="color:var(--text-tertiary);font-size:13px;margin-bottom:24px">
          請問您是否選擇了錯誤的檔案？
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button type="button" class="btn-secondary" id="confirm-upload-cancel-btn" style="flex:1">重新選擇檔案</button>
          <button type="button" class="btn-primary" id="confirm-upload-proceed-btn" style="flex:1">確認仍要上傳</button>
        </div>
      </div>`;

    const root = openModal("文件比對提醒", modalHtml, { width: "450px" });

    root.querySelector("#confirm-upload-cancel-btn").onclick = () => {
      closeModal();
      resolve(false);
    };
    root.querySelector("#confirm-upload-proceed-btn").onclick = () => {
      closeModal();
      resolve(true);
    };
  });
}

async function renderSopSummary() {
  const el = document.getElementById("pd-sop-summary");
  if (!el) return;
  const pid = state.currentProjectId;
  const sop = await api(`/projects/${pid}/sop`);
  state.projectCache[pid].sop = sop;

  // 頂上那排階段圓圈(跟案件總覽頁一模一樣的橫幅)- 用同一份 overview API 的
  // pct 資料畫,不是這裡的 sop.stages(那份沒有算好的完成百分比)。
  overviewEnsureStyle();
  const stageBandEl = document.getElementById("pd-stage-band");
  if (stageBandEl) {
    api(`/projects/${pid}/overview`).then((overview) => {
      stageBandEl.innerHTML = `<div class="ov-stage-scroll">${overview.stages.map(_ovStageHtml).join("")}</div>`;
    });
  }

  const isFinished = sop.final.status !== "pending";

  let finalBanner = "";
  if (sop.final.status === "completed") {
    finalBanner = `<div class="final-banner">✓ 案件已 100% 同意結案${sop.final.closed_at ? "(" + fmtDateTime(sop.final.closed_at) + ")" : ""}</div>`;
  } else if (sop.final.status === "force_closed") {
    finalBanner = `<div class="final-banner warning">案件已由主管強制結案${sop.final.reason ? ":" + escapeHtml(sop.final.reason) : ""}</div>`;
  }

  // 「強制結案」整個案件的按鈕已拿掉(使用者要求),只剩各關卡的「主管強制完成」。
  const headerActions = document.getElementById("pd-header-actions");
  if (headerActions) headerActions.innerHTML = "";

  // 右上角「整體進度」圓環卡 + 編輯案件/⋮ - 跟案件總覽頁(project_overview.js)同一套
  // 樣式,這裡的 sop.stages 是物件(key 是關卡編號字串),不是陣列,算法要對應調整。
  const progressCardEl = document.getElementById("pd-progress-card");
  if (progressCardEl) {
    const stageList = Object.values(sop.stages);
    const totalStages = stageList.length;
    const doneStages = stageList.filter((s) => s.status === "completed" || s.status === "force_closed").length;
    const progressPct = totalStages ? Math.round((doneStages / totalStages) * 100) : 0;
    progressCardEl.innerHTML = ovProgressCardHtml(doneStages, totalStages);
  }
  const pdEditBtn = document.getElementById("pd-edit-btn");
  if (pdEditBtn) pdEditBtn.onclick = () => openProjectEditModal(pid);
  const pdMenuBtn = document.getElementById("pd-menu-btn");
  if (pdMenuBtn) {
    pdMenuBtn.classList.toggle("hidden", !isManager());
    pdMenuBtn.onclick = (e) => {
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
      pdMenuBtn.parentElement.appendChild(pop);
      setTimeout(() => {
        document.addEventListener("click", _onDocClickProjectMenu, true);
        document.addEventListener("keydown", _onKeyProjectMenu, true);
      }, 0);
    };
  }

  // 頁籤上方常駐的「進度 X/9」橫幅已移除(使用者反饋不需要) - 階段進度改成只在
  // 「流程」頁籤裡的 SOP 卡片查看,這裡只留結案通知(finalBanner)。
  el.innerHTML = finalBanner;


}

// 主管駁回「XX 主管審核通過」項目時要留原因,案件負責人才知道要改什麼(見 backend
// routers/sop.py reject_checklist_item)。跟其他小型輸入框一樣用 openModal 蓋一個,
// 不用瀏覽器原生 prompt() 那種擋不住樣式又容易被使用者誤按取消的陽春輸入框。
function openRejectChecklistModal(pid, stage, key, label, onDone) {
  openModal(
    `駁回:${escapeHtml(label)}`,
    `
    <div class="field">
      <label>駁回原因</label>
      <textarea id="sop-reject-reason" rows="4" placeholder="請說明要修正的地方,案件負責人會看到這則原因..." autofocus></textarea>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="sop-reject-submit">駁回</button>
    </div>`,
    { width: "420px" }
  );
  document.getElementById("sop-reject-submit").addEventListener("click", async () => {
    const reason = document.getElementById("sop-reject-reason").value.trim();
    if (!reason) {
      toast("請填寫駁回原因", "error");
      return;
    }
    try {
      await api(`/projects/${pid}/sop/${stage}/checklist/reject`, {
        method: "POST",
        body: { key, reason },
      });
      toast("已駁回", "success");
      closeModal();
      onDone();
      refreshReminderBell();
    } catch (err) { }
  });
}

// 「強制結案」「強制完成關卡」都要主管留一個原因,原本用瀏覽器原生 prompt() 輸入,
// 跟駁回原因一樣有樣式擋不住、容易誤按取消的問題,改用同一套 openModal 彈跳視窗。
function openForceReasonModal(title, submitLabel, onSubmit) {
  openModal(
    title,
    `
    <div class="field">
      <label>原因</label>
      <textarea id="sop-force-reason" rows="4" placeholder="請說明強制執行的原因..." autofocus></textarea>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="sop-force-submit">${escapeHtml(submitLabel)}</button>
    </div>`,
    { width: "420px" }
  );
  document.getElementById("sop-force-submit").addEventListener("click", async () => {
    const reason = document.getElementById("sop-force-reason").value.trim();
    if (!reason) {
      toast("請填寫原因", "error");
      return;
    }
    closeModal();
    onSubmit(reason);
  });
}

async function renderSopTab(el) {
  const pid = state.currentProjectId;
  const sop = await api(`/projects/${pid}/sop`);
  state.projectCache[pid].sop = sop;

  const stageKeys = Object.keys(sop.stages).sort((a, b) => Number(a) - Number(b));
  const isFinished = sop.final.status !== "pending";

  if (state.sopSelectedStage == null || !stageKeys.includes(String(state.sopSelectedStage))) {
    state.sopSelectedStage = isFinished ? Math.max(...stageKeys.map(Number)) : sop.current_stage;
  }
  const selected = state.sopSelectedStage;

  // 相關檔案卡、負責人下拉、關卡列表的「已上傳文件」小標記都要用到,不管這關有沒有
  // checklist 都先抓,避免各自重複打 API。
  const [allDocs, assignableUsers] = await Promise.all([
    api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
    api(`/users/assignable`, { silent: true }).catch(() => []),
  ]);
  const stagesWithFiles = new Set(allDocs.filter((d) => d.sop_stage != null).map((d) => d.sop_stage));

  const navItemsHtml = stageKeys
    .map((key, i) => {
      const stage = sop.stages[key];
      const num = Number(key);
      const isCurrent = num === sop.current_stage && !isFinished;
      const isDone = stage.status === "completed" || stage.status === "force_closed";
      const statusText = isDone
        ? (stage.status === "force_closed" ? "✓ 已強制完成" : "✓ 已完成")
        : isCurrent
          ? "▶ 進行中"
          : "🔒 未解鎖";
      const cls = isDone ? "done" : isCurrent ? "current" : "locked";
      const label = sopStageLabel(key, stage);
      // 這一關需要上傳文件(任務清單有上傳項目)就一律顯示 📎,不管有沒有傳過
      const stageReq = stage.data && stage.data.requirements;
      const needsDocs = stageReq
        ? !!stageReq.document_required
        : ((stage.key && SOP_STAGE_CHECKLISTS[stage.key]) || []).some((it) => it.docType);
      return `
      <div class="sop-nav-item ${cls} ${num === Number(selected) ? "selected" : ""}" data-sop-nav="${key}">
        <div class="sop-nav-circle-wrap">
          <div class="sop-nav-circle">${isDone ? "✓" : key}</div>
        </div>
        <div class="sop-nav-text">
          <div class="sop-nav-label">第${key}階段 ${escapeHtml(label)}${needsDocs || stagesWithFiles.has(num) ? ` <span title="${stagesWithFiles.has(num) ? "已上傳相關檔案" : "需要上傳文件"}">📎</span>` : ""}</div>
          <div class="sop-nav-status">${statusText}</div>
        </div>
      </div>`;
    })
    .join("");

  const selectedStage = sop.stages[String(selected)];
  const selectedIsCurrent = Number(selected) === sop.current_stage && !isFinished;
  const selectedIsDone = selectedStage.status === "completed" || selectedStage.status === "force_closed";
  const selectedLabel = sopStageLabel(selected, selectedStage);
  const statusBadgeText = selectedIsDone
    ? selectedStage.status === "force_closed"
      ? "已強制完成"
      : "已完成"
    : selectedIsCurrent
      ? "進行中"
      : "未解鎖";
  const statusBadgeCls = selectedIsDone || selectedIsCurrent ? "status-active" : "status-closed";
  const stageRequirements = (selectedStage.data && selectedStage.data.requirements) || null;
  const isDualGate = selectedIsCurrent && !stageRequirements && DUAL_GATE_KEYS.includes(selectedStage.key);
  const stageMeta = (selectedStage.data && selectedStage.data.meta) || {};
  const userById = Object.fromEntries(assignableUsers.map((u) => [u.id, u]));
  let checklistHtml = "";
  let checklistAllDone = true;
  let checklistDoneCount = 0;
  let checklistTotalCount = 0;
  // 「階段任務清單」裡還沒完成的項目,收集起來給下面「待辦提醒」直接顯示 - 不用
  // 使用者自己在完整清單裡找還剩什麼沒做。
  const pendingItems = [];
  const checklistConfig = stageRequirements
    ? buildGenericChecklistConfig(stageRequirements)
    : (selectedStage.key && SOP_STAGE_CHECKLISTS[selectedStage.key]) || null;
  if (checklistConfig && checklistConfig.length) {
    const needsLandowners = checklistConfig.some((item) => item.countOf || item.contactRate || item.willingnessRatio || item.signedRatio);
    const needsRatio = checklistConfig.some((item) => item.ratioGate);
    const ratioData = needsRatio
      ? await api(`/projects/${pid}/consent-ratio`, { params: { stage: selected }, silent: true }).catch(() => null)
      : null;
    const landowners = needsLandowners ? await api(`/projects/${pid}/landowners`, { silent: true }).catch(() => []) : [];
    // 各關卡分開認定:同一個 doc_type(例如 briefing_material)在第1/2/3輪說明會都會用到,
    // 只看「這一關自己上傳的」,不能被其他關卡上傳過同類型文件就誤判成這關也完成了。
    const latestByType = {};
    allDocs
      .filter((d) => d.sop_stage === selected)
      .forEach((d) => {
        if (!latestByType[d.doc_type] || new Date(d.uploaded_at) > new Date(latestByType[d.doc_type].uploaded_at)) {
          latestByType[d.doc_type] = d;
        }
      });
    const landCount = landowners.reduce((sum, o) => sum + (o.land_records || []).length, 0);
    const buildingCount = landowners.reduce((sum, o) => sum + (o.building_records || []).length, 0);
    // 電子信箱 / 市內電話 / 行動電話 / LINE ID 任一項有填就算「已建立聯絡方式」
    const phoneCount = landowners.filter((o) => [o.email, o.phone_landline, o.phone_mobile, o.line_id].some((v) => (v || "").trim())).length;
    const contactedCount = landowners.filter((o) => o.contact_status && o.contact_status !== "not_contacted").length;
    const contactRate = landowners.length > 0 ? contactedCount / landowners.length : 0;
    const confirmedChecklist = (selectedStage.data && selectedStage.data.checklist) || {};
    const stageForms = (selectedStage.data && selectedStage.data.forms) || {};
    // 已確認地主清冊後鎖住土地/建物謄本匯入 - 清冊確認過就代表資料已經盤點完成,
    // 這時候再匯入會讓清冊跟實際登記資料兜不起來;要匯入得先按「取消確認」。
    const rosterLocked = !!confirmedChecklist.landowner_roster_confirmed;
    checklistAllDone = true;

    const itemResults = checklistConfig
      .map((item) => {
        let done = true;
        let wrMissing = null;
        let wrMissingTitle = "還未上傳意願書";
        let wrToggleTip = "查看還未上傳意願書的地主";
        let wrAllDoneText = "所有地主都已上傳意願書 🎉";
        let sub = item.sub || "";
        let rejected = false;
        if (item.docType) {
          const doc = latestByType[item.docType];
          const formEntry = item.form ? stageForms[item.docType] : null;
          done = !!doc || !!formEntry;
          if (formEntry) {
            sub = `已填表・${fmtDateTime(formEntry.submitted_at)}${doc ? "・另有上傳檔案" : ""}`;
          } else {
            sub = doc ? `${doc.file_name}・${fmtDateTime(doc.uploaded_at)}` : "尚未上傳";
          }
        } else if (item.countOf === "landowner_with_phone") {
          done = phoneCount > 0;
          sub = `${phoneCount}/${landowners.length} 位已建立聯絡方式`;
          wrMissing = landowners.filter((o) => ![o.email, o.phone_landline, o.phone_mobile, o.line_id].some((v) => (v || "").trim()));
          wrMissingTitle = "還未建立聯絡方式";
          wrToggleTip = "查看還未建立聯絡方式的地主";
          wrAllDoneText = "所有地主都已建立聯絡方式 🎉";
        } else if (item.countOf) {
          const count = item.countOf === "land" ? landCount : buildingCount;
          done = count > 0;
          sub = done
            ? `共 ${count} 筆`
            : item.countOf === "building" && landCount === 0
              ? "請先完成「上傳土地謄本PDF」,才能匯入建物登記"
              : "尚未匯入";
        } else if (item.willingnessRatio) {
          // 跟樓棟視圖同一批地主:已上傳意願書的人數 / 地主總人數
          const threshold = item.threshold ?? 0.8;
          const ids = new Set(landowners.map((o) => o.id));
          const withFormIds = new Set(
            allDocs.filter((d) => d.doc_type === "willingness_form" && d.landowner_id != null && ids.has(d.landowner_id)).map((d) => d.landowner_id)
          );
          const withForm = withFormIds.size;
          wrMissing = landowners.filter((o) => !withFormIds.has(o.id));
          const wr = landowners.length > 0 ? withForm / landowners.length : 0;
          done = wr >= threshold;
          sub = `已上傳意願書 ${withForm}/${landowners.length} 位(${Math.round(wr * 100)}%)・需達 ${Math.round(threshold * 100)}%`;
        } else if (item.signedRatio) {
          // 跟樓棟視圖同一批地主:已簽約(上傳意願書與簽約文件)的人數 / 地主總人數
          const threshold = item.threshold ?? 0.8;
          wrMissing = landowners.filter((o) => o.agreement_status !== "signed");
          wrMissingTitle = "還未簽約";
          wrToggleTip = "查看還未簽約的地主";
          wrAllDoneText = "所有地主都已簽約 🎉";
          const signedN = landowners.length - wrMissing.length;
          const sr = landowners.length > 0 ? signedN / landowners.length : 0;
          done = sr >= threshold;
          sub = `已簽約 ${signedN}/${landowners.length} 位(${Math.round(sr * 100)}%)・需達 ${Math.round(threshold * 100)}%`;
        } else if (item.contactRate) {
          const threshold = item.threshold ?? CONTACT_RATE_THRESHOLD;
          done = contactRate >= threshold;
          sub = `已聯絡 ${contactedCount}/${landowners.length}(${Math.round(contactRate * 100)}%)`;
          wrMissing = landowners.filter((o) => !o.contact_status || o.contact_status === "not_contacted");
          wrMissingTitle = "還未聯絡(尚無拜訪紀錄)";
          wrToggleTip = "查看還未聯絡的地主";
          wrAllDoneText = "所有地主都已聯絡 🎉";
        } else if (item.ratioGate) {
          const threshold = item.threshold ?? 0.8;
          done = !!ratioData && ratioData.headcount_ratio >= threshold && ratioData.land_share_ratio >= threshold;
          sub = ratioData
            ? `人數 ${Math.round(ratioData.headcount_ratio * 100)}%・面積 ${Math.round(ratioData.land_share_ratio * 100)}%`
            : "載入中";
        } else if (item.manual) {
          const confirmed = confirmedChecklist[item.key];
          done = !!(confirmed && confirmed.confirmed_at);
          // 駁回後只要相關文件重新上傳過(上傳時間晚於駁回時間),就當作案件負責人已經
          // 回應過了,不用一直卡著舊的駁回訊息;主管審核通過項目一定跟同一關某個上傳
          // 項目搭配,找那個項目的最新上傳時間來比對。
          if (confirmed && confirmed.rejected_at) {
            rejected = true;
            if (item.managerOnly) {
              // 有些關卡(如事業計畫說明會)一次要上傳好幾份文件(簡報+同意書+合約),
              // 之前只檢查 checklistConfig 裡第一個上傳項目,重新上傳的如果是後面那幾份
              // 就偵測不到 - 改成掃過整關所有上傳項目,任一份在駁回之後重新上傳過就算。
              // doc.uploaded_at 後端存的是沒有時區標記的 UTC 字串,直接 new Date() 會被
              // 瀏覽器當成本地時間解讀(差 8 小時,剛好足以讓「已經比駁回時間晚」的
              // 判斷失準)- 要用 parseApiDate() 補上 Z 再比,rejected_at 本身已經帶
              // +00:00 不受影響。
              const rejectedAt = parseApiDate(confirmed.rejected_at);
              const resubmitted = checklistConfig.some((ci) => {
                if (!ci.docType || ci.manual) return false;
                const doc = latestByType[ci.docType];
                return doc && parseApiDate(doc.uploaded_at) > rejectedAt;
              });
              if (resubmitted) rejected = false;
            }
          }
          sub = done
            ? `已確認・${fmtDate(confirmed.confirmed_at)}`
            : rejected
              ? `已駁回・${fmtDate(confirmed.rejected_at)}:${confirmed.reason}`
              : "尚未確認";
        }
        // 土地 / 建物謄本 PDF 這種有第一、二、三類子項目的列:在後面註記已經上傳了哪幾類
        if (item.hasSubs) {
          const uploaded = checklistConfig.filter((c) => c.parent === item.key && latestByType[c.docType]).map((c) => c.label.replace("謄本", ""));
          if (uploaded.length) sub += `・已上傳 ${uploaded.join("、")}謄本`;
        }
        // 選填項目(例如謄本類別)不算進進度、不擋「完成本階段」
        if (!(item.optional || (item.group && item.group.optional))) {
          checklistTotalCount++;
          if (done) checklistDoneCount++;
          else {
            checklistAllDone = false;
            pendingItems.push({ label: item.label, sub, key: item.key || item.docType || item.action || item.label });
          }
        }
        const canConfirmThis = item.managerOnly ? isManager() : isEditor();
        const ITEM_DEFAULT_SUBS = {
          consultant_document: "顧問合約、會議紀錄、相關文件等",
          architecture_drawing: "建築平面圖、立面圖、結構圖等",
          appraisal_result: "估價報告、比較表、附件等",
          briefing_material: "簡報檔、說明會簡報、附件等",
          consent_form_template: "意願書範本、相關文件等",
          contract_template: "都市更新事業計畫參與合約範本",
          chairman_approved_roi: "董事長簽核報表、相關紀錄",
          unit_area_split: "分坪表、單元圖資檔",
          invitation_letter: "開會通知單、郵寄回條證明",
          cadastral_map: "地籍圖資、範圍圖檔等",
          land_deed: "土地登記謄本、地號明細檔",
          building_deed: "建物登記謄本、建號明細檔",
          roi_report: "財務評估報告、投資報酬分析表",
          consultant_reviewed: "經辦人員提交後，由主管審核",
          briefing_reviewed_3: "經辦人員提交後，由主管審核",
          briefing_reviewed_6: "經辦人員提交後，由主管審核",
          briefing_reviewed_7: "經辦人員提交後，由主管審核",
          landowner_roster_confirmed: "核對地主名冊與產權清冊資料",
          contact_info_established: "盤點與記錄地主聯絡電話與通訊地址",
          contact_rate_95: "追蹤聯絡進度達成95%完成率目標"
        };

        let subDisplay = sub;
        if (!done && (!subDisplay || subDisplay === "尚未上傳" || subDisplay === "尚未確認" || subDisplay === "尚未匯入")) {
          subDisplay = ITEM_DEFAULT_SUBS[item.docType || item.key] || item.sub || subDisplay;
          if (item.key === "landowner_roster_confirmed" && (landCount === 0 || buildingCount === 0)) {
            subDisplay = "請先完成「上傳土地謄本PDF」與「上傳建物謄本PDF」,才能確認並下載地主清冊";
          }
        }

        let iconEmoji = "📄";
        let iconTheme = "theme-blue";

        if (item.docType === "architecture_drawing" || item.key === "architecture_drawing") {
          iconEmoji = "🏢";
          iconTheme = "theme-green";
        } else if (item.docType === "appraisal_result" || item.key === "appraisal_result") {
          iconEmoji = "📊";
          iconTheme = "theme-orange";
        } else if (item.managerOnly || (item.manual && (item.key.includes("reviewed") || item.key.includes("confirm")))) {
          iconEmoji = "🛡️";
          iconTheme = "theme-mint";
        } else if (item.action === "land" || item.key === "cadastral_map") {
          iconEmoji = "🗺️";
          iconTheme = "theme-amber";
        } else if (item.action === "building") {
          iconEmoji = "🏠";
          iconTheme = "theme-teal";
        } else if (item.countOf || item.contactRate || item.willingnessRatio || item.signedRatio) {
          iconEmoji = "👥";
          iconTheme = "theme-purple";
        } else if (item.docType === "consultant_document") {
          iconEmoji = "📄";
          iconTheme = "theme-blue";
        } else if (item.docType === "roi_report" || item.docType === "chairman_approved_roi") {
          iconEmoji = "📈";
          iconTheme = "theme-orange";
        } else if (item.docType === "briefing_material") {
          iconEmoji = "🎤";
          iconTheme = "theme-purple";
        } else if (item.docType === "consent_form_template" || item.docType === "contract_template") {
          iconEmoji = "✍️";
          iconTheme = "theme-blue";
        }

        if (item.group) {
          iconEmoji = item.icon || item.group.icon;
          iconTheme = item.group.theme;
        } else if (item.icon) {
          iconEmoji = item.icon;
          iconTheme = item.theme || iconTheme;
        }
        // 有下拉子項目的列(土地 / 建物謄本 PDF):原本的按鈕不動,多一顆展開鈕
        let subToggleBtn = "";
        if (item.hasSubs) {
          const subKey = `${selected}:sub:${item.key}`;
          const subOpen = _sopOpenDropdowns.has(subKey);
          subToggleBtn = `<button type="button" class="btn-secondary btn-sm doc-icon-btn${subOpen ? " sop-wr-open" : ""}" data-sop-group-toggle="${subKey}" title="展開 / 收合第一、二、三類謄本" aria-label="展開 / 收合" aria-expanded="${subOpen}"><span class="sop-wr-chev">▾</span></button>`;
        }
        const pendingStatusText = item.docType ? "尚未上傳" : item.action ? "尚未匯入" : "尚未確認";
        const statusPillHtml = `<div class="sop-status-pill ${done ? "done" : rejected ? "rejected" : "pending"}">
          <span class="sop-status-icon">${done ? "✓" : rejected ? "⚠️" : "🕒"}</span>
          <span>${done ? "已完成" : rejected ? "已駁回" : pendingStatusText}</span>
        </div>`;

        const uploadBtn =
          item.docType && canOcr()
            ? `<button type="button" class="btn-secondary btn-sm sop-btn-upload" data-checklist-upload="${item.docType}"><span class="sop-btn-icon">${SOP_UPLOAD_ICON}</span> ${done ? "重新上傳" : "上傳"}</button>
               <input type="file" data-checklist-upload-input="${item.docType}" style="display:none">`
            : "";
        const formBtn =
          item.form && isEditor()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-form="${item.docType}">${stageForms[item.docType] ? "編輯" : "填表"}</button>`
            : "";
        const actionLabel = done ? "重新上傳" : "上傳";
        const actionBtn =
          item.action && canOcr()
            ? rosterLocked
              ? `<button type="button" class="btn-secondary btn-sm sop-btn-upload" disabled title="已確認地主清冊正確,請先在下面「確認地主清冊正確」項目按取消確認,才能繼續匯入"><span class="sop-btn-icon">${SOP_UPLOAD_ICON}</span> ${actionLabel}</button>`
              : item.action === "building" && landCount === 0
                ? `<button type="button" class="btn-secondary btn-sm sop-btn-upload" disabled title="請先完成「上傳土地謄本PDF」,才能匯入建物登記"><span class="sop-btn-icon">${SOP_UPLOAD_ICON}</span> ${actionLabel}</button>`
                : `<button type="button" class="btn-secondary btn-sm sop-btn-upload" data-checklist-action="${item.action}" data-checklist-action-stage="${selected}"><span class="sop-btn-icon">${SOP_UPLOAD_ICON}</span> ${actionLabel}</button>`
            : "";
        const confirmBtn = !item.manual
          ? ""
          : canConfirmThis
            ? done
              ? item.managerOnly
                ? ""
                : `<button type="button" class="btn-secondary btn-sm" data-checklist-confirm="${item.key}" data-checklist-confirmed="${done}">取消確認</button>${item.key === "landowner_roster_confirmed" ? `<button type="button" class="btn-secondary btn-sm doc-icon-btn" data-roster-download title="下載地主清冊" aria-label="下載地主清冊">${SOP_DOWNLOAD_ICON}</button>` : ""}`
              : item.key === "landowner_roster_confirmed" && (landCount === 0 || buildingCount === 0)
                // 確認清冊時會順便匯出清冊 Excel,土地/建物謄本都還沒匯入就沒東西可匯
                ? `<button type="button" class="btn-secondary btn-sm" disabled title="請先完成「上傳土地謄本PDF」與「上傳建物謄本PDF」,才能確認並下載地主清冊">✓ 確認</button>`
                : `<button type="button" class="btn-secondary btn-sm" data-checklist-confirm="${item.key}" data-checklist-confirmed="${done}">✓ 確認</button>`
            : item.managerOnly
              ? `<span class="sop-tag-manager" title="僅管理層級可確認此項目"><i class="sop-tag-icon">👤</i> 需主管確認</span>`
              : "";
        const rejectBtn =
          item.manual && item.managerOnly && canConfirmThis
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-reject="${item.key}" data-checklist-reject-label="${escapeHtml(item.label)}" data-checklist-reject-stage="${selected}">駁回</button>`
            : "";
        // 土地/建物謄本是走「掃描謄本匯入」存的,doc_type 是 property_register / building_register
        // (見 backend routers/ocr.py);這關沒上傳過就退回整個案件最新的一份。
        const deedType = item.action === "land" ? "property_register" : item.action === "building" ? "building_register" : null;
        const latestDeed = (type) =>
          latestByType[type] ||
          allDocs
            .filter((d) => d.doc_type === type)
            .sort((a, b) => parseApiDate(b.uploaded_at) - parseApiDate(a.uploaded_at))[0] ||
          null;
        // 謄本在「辨識」那一刻就存檔了,匯入精靈中途關掉也會留下檔案 - 只有真的匯入完成
        // (done)才顯示預覽,不然會出現「有眼睛可以看檔案、狀態卻是尚未匯入」的矛盾。
        // 匯入時若是「從已上傳文件選擇」挑的檔案,它的 doc_type 不是謄本類別 - 所以優先
        // 從土地/建物資料的 source_ocr_job_id 找回當次匯入用的原檔(點下去再查 job 明細)。
        const deedJobId =
          deedType && done
            ? Math.max(
                0,
                ...landowners.flatMap((o) => (item.action === "land" ? o.land_records : o.building_records) || []).map((r) => r.source_ocr_job_id || 0)
              ) || null
            : null;
        const previewDoc = item.docType ? latestByType[item.docType] : deedType && done && !deedJobId ? latestDeed(deedType) : null;
        const previewBtn = deedJobId
          ? `<button type="button" class="btn-secondary btn-sm doc-icon-btn" data-sop-deed-job="${deedJobId}" title="預覽匯入的謄本" aria-label="預覽">${SOP_EYE_ICON}</button>`
          : previewDoc
            ? `<button type="button" class="btn-secondary btn-sm doc-icon-btn" data-sop-file-view="${previewDoc.id}" data-sop-file-view-name="${escapeHtml(previewDoc.file_name)}" title="預覽 ${escapeHtml(previewDoc.file_name)}">${SOP_EYE_ICON}</button>`
            : "";
        const rosterBtn = "";

        // 意願書簽署人數:下拉查看「還沒上傳意願書」的地主與門牌
        let wrToggleBtn = "";
        let wrPanel = "";
        if (wrMissing) {
          const rows = wrMissing
            .map((o) => {
              // 門牌 + 樓層(「二層」寫成「二樓」,地下層維持「地下N層」)
              const doors = [
                ...new Set(
                  (o.building_records || [])
                    .map((r) => {
                      const door = _shortDoorAddr(r.address);
                      if (!door) return "";
                      let fl = _floorLabelOf(r);
                      if (fl && !fl.startsWith("地下")) fl = fl.replace(/層$/, "樓");
                      return door + fl;
                    })
                    .filter(Boolean)
                ),
              ];
              return { door: doors.join("、") || "—", doors, name: o.name || "—" };
            })
            .sort((a, b) => a.door.localeCompare(b.door, "zh-Hant", { numeric: true }));
          const wrKey = `${selected}:wr:${item.key}`;
          const wrOpen = _sopOpenDropdowns.has(wrKey);
          wrToggleBtn = `<button type="button" class="btn-secondary btn-sm doc-icon-btn${wrOpen ? " sop-wr-open" : ""}" data-wr-toggle="${wrKey}" title="${wrToggleTip}" aria-label="${wrToggleTip}" aria-expanded="${wrOpen}"><span class="sop-wr-chev">▾</span></button>`;
          wrPanel = `<div class="sop-wr-panel"${wrOpen ? "" : " hidden"}>
            <div class="sop-wr-title">${wrMissingTitle}(${rows.length} 位)</div>
            ${rows.length
              ? `<div class="sop-wr-list">${rows.map((r) => `<div class="sop-wr-row"><span class="sop-wr-door">${(r.doors && r.doors.length ? r.doors : ["—"]).map((d) => `<span class="sop-wr-chip">${escapeHtml(d)}</span>`).join("")}</span><span class="sop-wr-name">${escapeHtml(r.name)}</span></div>`).join("")}</div>`
              : `<div class="helper-text">${wrAllDoneText}</div>`}
          </div>`;
        }

        const itemHtml = `
        <div class="sop-checklist-item ${done ? "done" : ""}${rejected ? " rejected" : ""}" data-checklist-anchor="${escapeHtml(item.key || item.docType || item.action || item.label)}">
          <div class="sop-checklist-checkbox">
            ${done ? '<span class="sop-check-v">✓</span>' : ""}
          </div>
          <div class="sop-checklist-icon-box ${iconTheme}">
            <span class="sop-icon-emoji">${sopIconHtml(iconEmoji)}</span>
          </div>
          <div class="sop-checklist-body">
            <div class="sop-checklist-label">${escapeHtml(item.label)}</div>
            <div class="sop-checklist-sub">${escapeHtml(subDisplay)}</div>
          </div>
          <div class="sop-checklist-right">
            ${statusPillHtml}
            <div class="sop-checklist-actions">
              ${rosterBtn}${confirmBtn}${rejectBtn}${formBtn}${previewBtn}${uploadBtn}${actionBtn}${wrToggleBtn}${subToggleBtn}
            </div>
          </div>
        </div>`;
        return { html: wrPanel ? `<div class="sop-wr-wrap">${itemHtml}${wrPanel}</div>` : itemHtml, done, group: item.group || null, itemKey: item.key, parentKey: item.parent || null, hasSubs: !!item.hasSubs };
      });
    const itemsHtml = buildSopChecklistHtml(itemResults, selected);
    checklistHtml = `<div class="sop-checklist">${itemsHtml}</div>`;
  }

  // 「待辦提醒」—— 不再是使用者自己手動輸入的自由筆記,改成直接把上面「階段任務
  // 清單」裡還沒完成的項目抓過來唯讀顯示,一眼看到這關還剩什麼要辦,不用在完整
  // 清單裡逐條找哪些還沒打勾。這裡列出的項目跟上面是同一份資料,不是另一份獨立
  // 清單,不會有兜不起來的問題。
  // 版面比照「案件總覽」頁的階段待辦(project_overview.js _ovSopTaskRowHtml):
  // 圓圈標記 + 純文字描述 + 「SOP」小標籤,不要方形打勾框+灰字副標題那一套,
  // 兩個地方顯示同一份資料(SOP還沒完成的項目)應該長一樣。ov-* 這幾個 class 定義在
  // project_overview.js 的 overviewEnsureStyle() 裡,呼叫一次確保就算沒先進過
  // 「案件總覽」頁,這裡的樣式也一定有掛上去。
  if (typeof overviewEnsureStyle === "function") overviewEnsureStyle();
  const TODO_TONES = ["blue", "green", "orange", "purple", "pink", "teal"];
  const todoDocIcon = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>`;
  const pendingTodosHtml = pendingItems.length
    ? pendingItems
        .map(
          (t, i) => `<button type="button" class="sop-todo-row" data-todo-jump="${escapeHtml(t.key)}" title="跳到「${escapeHtml(t.label)}」">
            <span class="sop-todo-box"></span>
            <span class="sop-todo-icon sop-todo-${TODO_TONES[i % TODO_TONES.length]}">${todoDocIcon}</span>
            <span class="sop-todo-label">${escapeHtml(t.label)}</span>
            <span class="sop-todo-chip">SOP</span>
            <span class="sop-todo-arrow">›</span>
          </button>`
        )
        .join("")
    : `<div class="ov-todo-empty">${checklistTotalCount ? "本階段任務都已完成 🎉" : "這一關沒有設定需求"}</div>`;

  // 已經開始跑之後也能用「自訂關卡流程」,但只能調整還沒跑到的未來關卡(見後端
  // PUT /sop/stages 的鎖定驗證) —— 已結案就沒有「未來」可調了,不給按。
  const flowStarted =
    sop.current_stage !== 0 || stageKeys.some((k) => (sop.stages[k].status || "pending") !== "pending");
  const flowLockedCount = flowStarted ? sop.current_stage + 1 : 0;
  const canEditFlow = isManager() && !isFinished;

  const stagePct = checklistTotalCount
    ? Math.round((checklistDoneCount / checklistTotalCount) * 100)
    : selectedIsDone
      ? 100
      : 0;

  const canEditMeta = isEditor() && !isLandowner();
  const updatedByUser = stageMeta.updated_by ? userById[stageMeta.updated_by] : null;
  const lastUpdatedHtml = stageMeta.updated_at
    ? `最後更新:${fmtDateTime(stageMeta.updated_at)}${updatedByUser ? `・${escapeHtml(updatedByUser.display_name)}` : ""}`
    : "";

  el.innerHTML = `
    <div class="sop-panel-layout">
      <div class="sop-nav-list-wrap">
        ${canEditFlow ? `<button type="button" class="btn-secondary btn-sm" id="sop-edit-flow-btn" style="margin-bottom:10px;width:100%">⚙ 自訂關卡流程</button>` : ""}
        <div class="sop-nav-list">${navItemsHtml}</div>
      </div>
      <div class="sop-detail-card">
        <div class="sop-detail-header">
          <div>
            <h3>第${selected}階段・${escapeHtml(selectedLabel)}</h3>
            <span class="status-badge ${statusBadgeCls}">${statusBadgeText}</span>
          </div>
          <div class="sop-detail-header-right">
            <div class="sop-stage-progress-mini"><span>本階段進度</span><strong>${stagePct}%</strong></div>
            <div class="progress-bar-track sop-stage-progress-bar"><div class="progress-bar-fill" style="width:${stagePct}%"></div></div>
          </div>
        </div>

        <div class="card sop-subcard">
          <div class="sop-todo-head sop-task-head">
            <span class="sop-todo-head-icon sop-task-head-icon">📋</span>
            <div class="sop-todo-head-text">
              <div class="sop-todo-head-title">階段任務清單</div>
              <div class="sop-todo-head-sub">完成本階段需要的任務,完成後系統將自動更新進度</div>
            </div>
            ${isManager() && !isFinished && !selectedIsDone ? `<button type="button" class="btn-warning btn-sm" id="force-stage-btn"${selectedIsCurrent ? "" : ` data-force-stage="${selected}"`} title="${selectedIsCurrent ? "不用等任務清單完成,直接強制完成本階段" : "尚未解鎖,主管可直接強制完成這一關"}">主管強制完成</button>` : ""}
            ${checklistTotalCount ? `<span class="sop-todo-count">已完成 <b>${checklistDoneCount}</b>/${checklistTotalCount}</span>` : ""}
          </div>
          ${checklistTotalCount ? `<div class="progress-bar-track sop-subcard-progress"><div class="progress-bar-fill" style="width:${stagePct}%"></div></div>` : ""}
          ${checklistHtml || `<div class="empty-state">這一關沒有設定需求,可直接人工完成</div>`}
        </div>

        ${isDualGate && !isLandowner() ? `<div id="sop-tab-consent-panel" style="margin-top:14px"></div>` : ""}

        ${selectedIsCurrent && isEditor()
          ? `<div class="sop-action-bar">
                <button class="btn-primary btn-sm" id="complete-stage-btn" ${checklistAllDone ? "" : "disabled title=\"還有項目未完成\""}>完成本階段</button>
                ${!checklistAllDone ? `<span class="helper-text">還有項目未完成,無法進入下一關</span>` : ""}
                <span class="helper-text sop-last-updated">${lastUpdatedHtml}</span>
              </div>`
          : !selectedIsCurrent
            ? `<div class="helper-text" style="margin-top:16px">${selectedIsDone ? "這一關已經完成。" : "這一關還沒開始,要先完成前面的關卡才會解鎖。"}${lastUpdatedHtml ? `<br>${lastUpdatedHtml}` : ""}</div>`
            : ""
        }
      </div>
    </div>`;

  if (isDualGate && !isLandowner()) {
    await renderConsentPanel(document.getElementById("sop-tab-consent-panel"), Number(selected));
  }

  el.querySelectorAll("[data-sop-nav]").forEach((node) => {
    node.addEventListener("click", () => {
      state.sopSelectedStage = Number(node.dataset.sopNav);
      renderSopTab(el);
    });
  });

  const editFlowBtn = document.getElementById("sop-edit-flow-btn");
  if (editFlowBtn) {
    editFlowBtn.addEventListener("click", () => {
      const currentStages = stageKeys.map((k) => ({ key: sop.stages[k].key || null, name: sop.stages[k].name }));
      openSopStageFlowEditor(
        currentStages,
        async (stages) => {
          await api(`/projects/${pid}/sop/stages`, { method: "PUT", body: { stages } });
          toast("關卡流程已更新", "success");
          closeModal();
          state.sopSelectedStage = null;
          renderSopTab(el);
        },
        flowLockedCount
      );
    });
  }

  el.querySelectorAll("[data-sop-group-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.closest(".sop-group-wrap").querySelector(".sop-group-panel");
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("sop-wr-open", open);
      if (open) _sopOpenDropdowns.add(btn.dataset.sopGroupToggle);
      else _sopOpenDropdowns.delete(btn.dataset.sopGroupToggle);
    });
  });
  el.querySelectorAll("[data-wr-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.closest(".sop-wr-wrap").querySelector(".sop-wr-panel");
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("sop-wr-open", open);
      if (open) _sopOpenDropdowns.add(btn.dataset.wrToggle);
      else _sopOpenDropdowns.delete(btn.dataset.wrToggle);
    });
  });
  el.querySelectorAll("[data-roster-download]").forEach((btn) => {
    btn.addEventListener("click", () => downloadRosterExcel(pid));
  });

  el.querySelectorAll("[data-checklist-confirm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.checklistConfirm;
      const currentlyConfirmed = btn.dataset.checklistConfirmed === "true";
      // 「確認地主清冊正確」影響後面所有謄本比對跟清冊匯出,確認前跳警告讓人再想一下,
      // 取消確認就不用特別警告。
      if (key === "landowner_roster_confirmed" && !currentlyConfirmed) {
        const ok = await confirmDialog(
          "確認後,後續的謄本比對、地主清冊 Excel 匯出都會以目前的地主清冊資料為準。\n\n請確認姓名、地號/建號、持分等資料都已核對無誤。",
          { title: "確認地主清冊正確?", confirmText: "確認無誤" }
        );
        if (!ok) return;
      }
      try {
        await api(`/projects/${pid}/sop/${selected}/checklist`, {
          method: "POST",
          body: { key, confirmed: !currentlyConfirmed },
        });
        toast(currentlyConfirmed ? "已取消確認" : "已確認", "success");
        renderSopTab(el);
        refreshReminderBell();
        // 確認地主清冊正確的當下就順手把 Excel 匯出下載,不用再切去整合清冊按一次。
        if (key === "landowner_roster_confirmed" && !currentlyConfirmed) {
          await downloadRosterExcel(pid);
        }
      } catch (err) { }
    });
  });

  el.querySelectorAll("[data-checklist-reject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRejectChecklistModal(
        pid,
        Number(btn.dataset.checklistRejectStage),
        btn.dataset.checklistReject,
        btn.dataset.checklistRejectLabel,
        () => renderSopTab(el)
      );
    });
  });

  el.querySelectorAll("[data-checklist-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = btn.dataset.checklistActionStage != null ? Number(btn.dataset.checklistActionStage) : null;
      if (btn.dataset.checklistAction === "land") openTitleDeedWizard(stage);
      else openBuildingTitleDeedWizard(stage);
    });
  });

  el.querySelectorAll("[data-checklist-form]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const docType = btn.dataset.checklistForm;
      const stageEntry = sop.stages[String(selected)] || {};
      const existing = ((stageEntry.data || {}).forms || {})[docType] || null;
      openStageFormModal(pid, Number(selected), docType, existing, () => renderSopTab(el));
    });
  });

  el.querySelectorAll("[data-checklist-upload]").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.querySelector(`[data-checklist-upload-input="${btn.dataset.checklistUpload}"]`).click();
    });
  });
  el.querySelectorAll("[data-checklist-upload-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const docType = input.dataset.checklistUploadInput;

      const confirmed = await inspectAndConfirmDocumentUpload(file, docType);
      if (!confirmed) {
        input.value = "";
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      fd.append("sop_stage", String(selected));
      try {
        await api(`/projects/${pid}/documents`, { method: "POST", body: fd, isForm: true });
        const label = DOC_TYPE_LABEL[docType] || docType;
        toast(`【${label}】已成功上傳`, "success");
        renderSopTab(el);
        refreshReminderBell();
      } catch (err) { }
    });
  });

  const completeBtn = document.getElementById("complete-stage-btn");
  if (completeBtn) {
    completeBtn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/sop/${sop.current_stage}/complete`, { method: "POST", body: {} });
        toast("關卡已完成", "success");
        await loadDashboard();
        await renderSopSummary();
        state.sopSelectedStage = null;
        renderSopTab(el);
        refreshReminderBell();
      } catch (err) { }
    });
  }
  // 本階段任務全部完成(進度 100%)就自動完成並進入下一階段,不用再按「完成本階段」。
  // 最後一關不自動(完成會直接結案),同一關只自動試一次(失敗時不要一直重試)。
  const _lastStageIdx = Object.keys(sop.stages || {}).length - 1;
  const _autoKey = `${pid}:${sop.current_stage}`;
  if (
    selectedIsCurrent &&
    isEditor() &&
    checklistTotalCount > 0 &&
    checklistAllDone &&
    Number(selected) < _lastStageIdx &&
    _sopAutoAdvanceTried !== _autoKey
  ) {
    _sopAutoAdvanceTried = _autoKey;
    try {
      await api(`/projects/${pid}/sop/${sop.current_stage}/complete`, { method: "POST", body: {}, silent: true });
      toast("本階段已 100% 完成,自動進入下一階段", "success");
      await loadDashboard();
      await renderSopSummary();
      state.sopSelectedStage = null;
      renderSopTab(el);
      refreshReminderBell();
      return;
    } catch (err) { }
  }
  const forceBtn = document.getElementById("force-stage-btn");
  if (forceBtn) {
    forceBtn.addEventListener("click", () => {
      openForceReasonModal("強制完成關卡", "強制完成", async (reason) => {
        try {
          await api(`/projects/${pid}/sop/${forceBtn.dataset.forceStage ?? sop.current_stage}/complete`, { method: "POST", body: { force: true, reason } });
          toast("已強制完成關卡", "success");
          await renderSopSummary();
          state.sopSelectedStage = null;
          renderSopTab(el);
          refreshReminderBell();
        } catch (err) { }
      });
    });
  }
  // ---- 階段任務清單上傳項目的預覽按鈕 ----
  // 待辦提醒點一下 → 捲到上面階段任務清單的同一項並閃一下
  el.querySelectorAll("[data-todo-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = [...el.querySelectorAll("[data-checklist-anchor]")].find((n) => n.dataset.checklistAnchor === btn.dataset.todoJump);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("sop-flash");
      void target.offsetWidth;
      target.classList.add("sop-flash");
    });
  });
  el.querySelectorAll("[data-sop-file-view]").forEach((btn) => {
    btn.addEventListener("click", () => viewDocument(Number(btn.dataset.sopFileView), btn.dataset.sopFileViewName));
  });
  el.querySelectorAll("[data-sop-deed-job]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const detail = await api(`/projects/${state.currentProjectId}/ocr-jobs/${btn.dataset.sopDeedJob}`);
      const docs = ((detail && detail.documents) || []).slice().sort((a, b) => a.page_order - b.page_order);
      if (!docs.length) {
        toast("找不到這次匯入的謄本檔案(可能已被刪除)", "error");
        return;
      }
      if (docs.length > 1) toast(`這次匯入共 ${docs.length} 份檔案,先開啟第一份`, "info");
      viewDocument(docs[0].document.id, docs[0].document.file_name);
    });
  });
}

async function renderConsentPanel(el, stage) {
  const pid = state.currentProjectId;
  const [ratio, records, landowners] = await Promise.all([
    api(`/projects/${pid}/consent-ratio`, { params: { stage } }),
    api(`/projects/${pid}/sop/${stage}/consent`),
    api(`/projects/${pid}/landowners`),
  ]);
  const recordByLandowner = Object.fromEntries(records.map((r) => [r.landowner_id, r]));

  el.innerHTML = `
    <div class="gate-bars">
      <div>
        <div class="gate-bar-label"><span>人數同意率</span><span>${fmtPct(ratio.headcount_ratio)} (${ratio.headcount_agreed}/${ratio.headcount_total})</span></div>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(ratio.headcount_ratio * 100, 100)}%"></div></div>
      </div>
      <div>
        <div class="gate-bar-label"><span>面積同意率</span><span>${fmtPct(ratio.land_share_ratio)} (${ratio.land_share_agreed_sqm.toFixed(1)}/${ratio.land_share_total_sqm.toFixed(1)} m²)</span></div>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(ratio.land_share_ratio * 100, 100)}%"></div></div>
      </div>
      <div class="helper-text">需人數與面積同意率皆 ≥ 80% 才能通過雙門檻${ratio.dual_gate_passed ? " · <strong style='color:var(--success)'>已達標</strong>" : ""}</div>
    </div>
    ${isEditor()
      ? `<p class="helper-text" style="margin:10px 0 6px">
            ⓘ 下面這張「本輪同意狀態」是這一輪單獨的追蹤紀錄,跟上面「人數/面積同意率」
            是兩套獨立資料——同意率是看地主聯絡簿「電訪同意」+「已簽約」狀態算出來的,
            按這裡的同意/反對不會改變上面的比例;正式算進雙門檻請到地主聯絡簿更新
            拜訪結果與簽約狀態。
          </p>
         <div class="table-wrap">
            <table>
              <thead><tr><th>地主</th><th>統一編號</th><th>本輪同意狀態</th><th>操作</th></tr></thead>
              <tbody>
                ${landowners
                  .map((o) => {
                    const rec = recordByLandowner[o.id];
                    const status = rec ? rec.consent_status : "pending";
                    return `<tr>
                      <td>${escapeHtml(o.name)}</td>
                      <td>${escapeHtml(o.id_number) || "-"}</td>
                      <td><span class="consent-status-badge cs-${status}">${CONSENT_STATUS_LABEL[status]}</span></td>
                      <td class="actions-cell">
                        <button class="btn-secondary btn-sm" data-consent="${o.id}" data-status="agreed">同意</button>
                        <button class="btn-secondary btn-sm" data-consent="${o.id}" data-status="opposed">反對</button>
                      </td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>`
      : ""
    }
  `;

  el.querySelectorAll("[data-consent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/sop/${stage}/consent`, {
          method: "POST",
          body: { landowner_id: Number(btn.dataset.consent), consent_status: btn.dataset.status },
        });
        toast("已登記同意狀態", "success");
        renderConsentPanel(el, stage);
      } catch (err) { }
    });
  });
}

const STAGE_FORM_STATUS_OPTIONS = [
  "草擬中",
  "待主管核准",
  "待發文",
  "已發文",
  "待回覆",
  "已回覆",
  "退件補正",
  "作廢",
  "已完成",
];

const CONSENT_INTENT_DEFAULT =
  "本人已悉本案都市更新相關說明，並同意依案件程序辦理後續相關作業。";

const CONTRACT_PURPOSE_DEFAULT = "雙方就本都市更新案件之合作事項，依本契約約定辦理。";
const CONTRACT_COOPERATION_DEFAULT =
  "一、案件資料提供與確認。\n二、都市更新相關文件之簽署與管理。\n三、案件進度及必要事項之協調。";
const CONTRACT_DOCUMENTS_DEFAULT =
  "乙方應依甲方通知提供土地、建物及身分相關文件。\n甲方應妥善保存案件資料，並依約定用途使用。";
const CONTRACT_PERIOD_DEFAULT = "契約期間：自民國115年__月__日起至案件完成相關程序止。";

// Per-範本 field schema. Falls back to the 同意書 set for anything unlisted.
const STAGE_FORM_SCHEMAS = {
  consent_form_template: {
    sections: [
      {
        title: "案件資料",
        fields: [
          { name: "case_name", label: "案件名稱", default: (p) => p.name },
          { name: "case_number", label: "案件編號", default: (p) => p.project_code },
          { name: "implementer_unit", label: "實施單位", full: true },
        ],
      },
      {
        title: "權利人資料",
        fields: [
          { name: "holder_name", label: "姓名" },
          { name: "holder_id", label: "身分證字號" },
          { name: "holder_address", label: "聯絡地址", full: true },
        ],
      },
      {
        title: "土地及建物資料",
        fields: [
          { name: "land_parcel_number", label: "土地地號" },
          { name: "building_number", label: "建物建號" },
          { name: "land_share", label: "土地持分" },
          { name: "building_share", label: "建物持分" },
        ],
      },
      {
        title: "同意事項",
        fields: [
          { name: "consent_content", label: "同意事項", type: "textarea", full: true, rows: 3, default: () => CONSENT_INTENT_DEFAULT },
        ],
      },
    ],
  },
  contract_template: {
    sections: [
      {
        title: "契約雙方",
        fields: [
          { name: "party_a", label: "甲方" },
          { name: "party_b", label: "乙方" },
          { name: "case_name", label: "案件名稱", default: (p) => p.name },
          { name: "contract_number", label: "契約編號" },
        ],
      },
      {
        title: "契約條款",
        fields: [
          { name: "contract_purpose", label: "第一條 契約目的", type: "textarea", full: true, rows: 2, default: () => CONTRACT_PURPOSE_DEFAULT },
          { name: "contract_cooperation", label: "第二條 合作內容", type: "textarea", full: true, rows: 3, default: () => CONTRACT_COOPERATION_DEFAULT },
          { name: "contract_documents", label: "第三條 文件與資料", type: "textarea", full: true, rows: 3, default: () => CONTRACT_DOCUMENTS_DEFAULT },
          { name: "contract_period", label: "第四條 契約期限", type: "textarea", full: true, rows: 2, default: () => CONTRACT_PERIOD_DEFAULT },
        ],
      },
    ],
  },
};

// Online form for a 第0關 範本 checklist item. Submitting it counts as completing that
// item (see save_stage_form on the backend); re-opening pre-fills the saved values.
function openStageFormModal(pid, stage, docType, existing, onSaved) {
  const label = (typeof DOC_TYPE_LABEL !== "undefined" && DOC_TYPE_LABEL[docType]) || docType;
  const f = (existing && existing.fields) || {};
  const proj = state.currentProject || {};
  const today = new Date().toISOString().slice(0, 10);
  const schema = STAGE_FORM_SCHEMAS[docType] || STAGE_FORM_SCHEMAS.consent_form_template;

  const fieldValue = (fld) => {
    const cur = f[fld.name];
    if (cur != null && cur !== "") return cur;
    return typeof fld.default === "function" ? fld.default(proj) || "" : fld.default || "";
  };
  const renderField = (fld) => {
    const style = fld.full ? ' style="grid-column:1 / -1"' : "";
    const val = escapeHtml(fieldValue(fld));
    const input =
      fld.type === "textarea"
        ? `<textarea name="${fld.name}" rows="${fld.rows || 3}" style="resize:vertical">${val}</textarea>`
        : `<input name="${fld.name}" value="${val}">`;
    return `<label class="field"${style}><span>${escapeHtml(fld.label)}</span>${input}</label>`;
  };
  const renderSection = (sec) => `
    <div>
      ${sec.title ? `<div style="font-weight:600;margin-bottom:8px;color:var(--text-primary)">${escapeHtml(sec.title)}</div>` : ""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${sec.fields.map(renderField).join("")}</div>
    </div>`;

  const statusOpts = STAGE_FORM_STATUS_OPTIONS.map(
    (s) => `<option value="${escapeHtml(s)}" ${f.status === s ? "selected" : ""}>${escapeHtml(s)}</option>`
  ).join("");

  const bodyHtml = `
    <form id="stage-form" style="display:flex;flex-direction:column;gap:14px">
      ${schema.sections.map(renderSection).join("")}
      <div>
        <div style="font-weight:600;margin-bottom:8px;color:var(--text-primary)">文件狀態</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label class="field"><span>發文日期</span><input type="date" name="issue_date" value="${escapeHtml(f.issue_date || today)}"></label>
          <label class="field"><span>文件狀態</span><select name="status">${statusOpts}</select></label>
          <label class="field" style="grid-column:1 / -1"><span>備註</span><textarea name="remark" rows="3" style="resize:vertical">${escapeHtml(f.remark || "")}</textarea></label>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:4px">
        ${existing ? `<button type="button" class="btn-link btn-sm" id="stage-form-clear" style="color:var(--danger);margin-right:auto">清除此填表</button>` : ""}
        <button type="button" class="btn-secondary" id="stage-form-cancel">取消</button>
        <button type="submit" class="btn-primary">${existing ? "儲存修改" : "送出"}</button>
      </div>
    </form>`;

  const root = openModal(`${label} · 線上填表`, bodyHtml, { width: "640px" });
  const form = root.querySelector("#stage-form");
  root.querySelector("#stage-form-cancel").onclick = closeModal;

  const clearBtn = root.querySelector("#stage-form-clear");
  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (!confirm("確定要清除這份填表內容嗎?")) return;
      try {
        await api(`/projects/${pid}/sop/${stage}/form`, { method: "POST", body: { doc_type: docType, form_data: null } });
        toast("已清除填表", "success");
        closeModal();
        onSaved && onSaved();
      } catch (err) { }
    };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const form_data = {};
    fd.forEach((val, key) => { form_data[key] = String(val).trim(); });
    try {
      await api(`/projects/${pid}/sop/${stage}/form`, { method: "POST", body: { doc_type: docType, form_data } });
      toast(existing ? "填表已更新" : "填表已送出", "success");
      closeModal();
      onSaved && onSaved();
    } catch (err) { }
  });
}
