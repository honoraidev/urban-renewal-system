"use strict";

const DUAL_GATE_STAGES = [4, 8, 9];
const CONTACT_RATE_THRESHOLD = 0.95;

function sopStageLabel(key, stageObj) {
  if (stageObj && stageObj.custom_name) return stageObj.custom_name;
  const labels = {
    0: "初始核定立案",
    1: "籌備階段",
    2: "意願調查",
    3: "都更說明會",
    4: "同意書簽署(第一輪)",
    5: "都更規劃與估價",
    6: "事業計畫說明會",
    7: "權利變換說明會",
    8: "同意書補強(第二輪)",
    9: "送件審查",
  };
  return labels[Number(key)] || `第${key}關`;
}

const SOP_STAGE_CHECKLISTS = {
  0: [
    { key: "dev_letter_template", label: "上傳開發信範本", docType: "dev_letter_template", form: true },
    { key: "willingness_form_template", label: "上傳意願書範本", docType: "willingness_form_template", form: true },
    { key: "consent_form_template", label: "上傳同意書範本", docType: "consent_form_template", form: true },
    { key: "contract_template", label: "上傳合約範本", docType: "contract_template", form: true },
  ],
  1: [
    { key: "cadastral_map", label: "上傳地籍圖", docType: "cadastral_map" },
    { key: "land_deed", label: "上傳土地謄本PDF", countOf: "land" },
    { key: "building_deed", label: "上傳建物謄本PDF", countOf: "building" },
    { key: "landowner_roster_confirmed", label: "確認地主清冊正確", manual: true },
  ],
  2: [
    { key: "contact_info_established", label: "地主聯絡方式建立", countOf: "landowner_with_phone" },
    { key: "contact_rate_95", label: "達到95%聯絡門檻", contactRate: true },
  ],
  3: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_3", label: "主管審核通過", manual: true },
  ],
  5: [
    { key: "consultant_document", label: "上傳顧問文件", docType: "consultant_document" },
    { key: "consultant_reviewed", label: "主管審核通過", manual: true },
  ],
  6: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_6", label: "主管審核通過", manual: true },
  ],
  7: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_7", label: "主管審核通過", manual: true },
  ],
};

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

  const stageKeys = Object.keys(sop.stages).sort((a, b) => Number(a) - Number(b));
  const maxStage = Math.max(...stageKeys.map(Number));
  const isFinished = sop.final.status !== "pending";
  const progressNum = isFinished ? maxStage : sop.current_stage;

  let finalBanner = "";
  if (sop.final.status === "completed") {
    finalBanner = `<div class="final-banner">✓ 案件已 100% 同意結案${sop.final.closed_at ? "(" + fmtDateTime(sop.final.closed_at) + ")" : ""}</div>`;
  } else if (sop.final.status === "force_closed") {
    finalBanner = `<div class="final-banner warning">案件已由主管強制結案${sop.final.reason ? ":" + escapeHtml(sop.final.reason) : ""}</div>`;
  }

  const currentStageObj = sop.stages[String(sop.current_stage)];
  const currentLabel = isFinished
    ? "已結案"
    : currentStageObj
      ? `第${sop.current_stage}關・${sopStageLabel(sop.current_stage, currentStageObj)}`
      : "";

  const headerActions = document.getElementById("pd-header-actions");
  if (headerActions) {
    headerActions.innerHTML =
      isManager() && !isFinished ? `<button class="btn-danger btn-sm" id="force-close-project-btn">強制結案</button>` : "";
  }

  el.innerHTML = `
    ${finalBanner}
    <div class="sop-progress-bar">
      <span class="sop-progress-num">進度 ${progressNum}/${maxStage}</span>
      <div class="progress-bar-track" style="flex:1"><div class="progress-bar-fill" style="width:${((progressNum / maxStage) * 100).toFixed(0)}%"></div></div>
      <span class="sop-progress-current">${escapeHtml(currentLabel)}</span>
    </div>
  `;

  const forceCloseBtn = document.getElementById("force-close-project-btn");
  if (forceCloseBtn) {
    forceCloseBtn.addEventListener("click", async () => {
      const reason = prompt("請輸入強制結案原因:");
      if (reason === null) return;
      try {
        await api(`/projects/${pid}/sop/force-close`, { method: "POST", body: { force: true, reason } });
        toast("案件已強制結案", "success");
        await loadDashboard();
        await renderSopSummary();
        if (state.activeTab === "sop") renderTab("sop");
      } catch (err) { }
    });
  }
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

  const navItemsHtml = stageKeys
    .map((key, i) => {
      const stage = sop.stages[key];
      const num = Number(key);
      const isCurrent = num === sop.current_stage && !isFinished;
      const isDone = stage.status === "completed" || stage.status === "force_closed";
      const statusText = isDone ? (stage.status === "force_closed" ? "已強制完成" : "已完成") : isCurrent ? "進行中" : "未解鎖";
      const cls = isDone ? "done" : isCurrent ? "current" : "locked";
      const label = sopStageLabel(key, stage);
      const isLast = i === stageKeys.length - 1;
      return `
      <div class="sop-nav-item ${cls} ${num === Number(selected) ? "selected" : ""}" data-sop-nav="${key}">
        <div class="sop-nav-circle-wrap">
          <div class="sop-nav-circle">${isDone ? "✓" : key}</div>
          ${isLast ? "" : `<div class="sop-nav-line ${isDone ? "done" : ""}"></div>`}
        </div>
        <div class="sop-nav-text">
          <div class="sop-nav-label">第${key}關 ${escapeHtml(label)}</div>
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
  const isDualGate = selectedIsCurrent && DUAL_GATE_STAGES.includes(Number(selected));

  let checklistHtml = "";
  let checklistAllDone = true;
  const checklistConfig = SOP_STAGE_CHECKLISTS[Number(selected)] || null;
  if (checklistConfig) {
    const needsDocs = checklistConfig.some((item) => item.docType);
    const needsLandowners = checklistConfig.some((item) => item.countOf || item.contactRate);
    const [docs, landowners] = await Promise.all([
      needsDocs ? api(`/projects/${pid}/documents`, { silent: true }).catch(() => []) : Promise.resolve([]),
      needsLandowners ? api(`/projects/${pid}/landowners`, { silent: true }).catch(() => []) : Promise.resolve([]),
    ]);
    const latestByType = {};
    docs.forEach((d) => {
      if (!latestByType[d.doc_type] || new Date(d.uploaded_at) > new Date(latestByType[d.doc_type].uploaded_at)) {
        latestByType[d.doc_type] = d;
      }
    });
    const landCount = landowners.reduce((sum, o) => sum + (o.land_records || []).length, 0);
    const buildingCount = landowners.reduce((sum, o) => sum + (o.building_records || []).length, 0);
    const phoneCount = landowners.filter((o) => (o.phone || "").trim()).length;
    const contactedCount = landowners.filter((o) => o.contact_status && o.contact_status !== "not_contacted").length;
    const contactRate = landowners.length > 0 ? contactedCount / landowners.length : 0;
    const confirmedChecklist = (selectedStage.data && selectedStage.data.checklist) || {};
    const stageForms = (selectedStage.data && selectedStage.data.forms) || {};
    checklistAllDone = true;

    const itemsHtml = checklistConfig
      .map((item) => {
        let done = true;
        let sub = item.sub || "";
        if (item.docType) {
          const doc = latestByType[item.docType];
          const formEntry = item.form ? stageForms[item.docType] : null;
          done = !!doc || !!formEntry;
          if (formEntry) {
            sub = `已填表・${fmtDateTime(formEntry.submitted_at)}${doc ? "・另有上傳檔案" : ""}`;
          } else {
            sub = doc ? `已上傳・${fmtDateTime(doc.uploaded_at)}` : "尚未上傳";
          }
        } else if (item.countOf === "landowner_with_phone") {
          done = phoneCount > 0;
          sub = `${phoneCount}/${landowners.length} 位已建立聯絡方式`;
        } else if (item.countOf) {
          const count = item.countOf === "land" ? landCount : buildingCount;
          done = count > 0;
          sub = done ? `共 ${count} 筆` : "尚未匯入";
        } else if (item.contactRate) {
          done = contactRate >= CONTACT_RATE_THRESHOLD;
          sub = `已聯絡 ${contactedCount}/${landowners.length}(${Math.round(contactRate * 100)}%)`;
        } else if (item.manual) {
          const confirmed = confirmedChecklist[item.key];
          done = !!confirmed;
          sub = done ? `已確認・${fmtDate(confirmed.confirmed_at)}` : "尚未確認";
        }
        if (!done) checklistAllDone = false;
        const confirmBtn =
          item.manual && isEditor()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-confirm="${item.key}" data-checklist-confirmed="${done}">${done ? "取消確認" : "確認"}</button>`
            : "";
        const uploadBtn =
          item.docType && canOcr()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-upload="${item.docType}">${done ? "重新上傳" : "上傳"}</button>
               <input type="file" data-checklist-upload-input="${item.docType}" style="display:none">`
            : "";
        const formBtn =
          item.form && isEditor()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-form="${item.docType}">${stageForms[item.docType] ? "編輯" : "填表"}</button>`
            : "";
        const rosterBtn =
          item.key === "landowner_roster_confirmed" && done && !isLandowner()
            ? `<button type="button" class="btn-primary btn-sm" id="roster-xlsx-btn">📊 產生地主清冊 Excel</button>`
            : "";
        return `
        <div class="sop-checklist-item ${done ? "done" : ""}">
          <div class="sop-checklist-icon">${done ? "✓" : ""}</div>
          <div style="flex:1">
            <div class="sop-checklist-label">${escapeHtml(item.label)}</div>
            <div class="sop-checklist-sub">${escapeHtml(sub)}</div>
          </div>
          ${rosterBtn}${confirmBtn}${formBtn}${uploadBtn}
        </div>`;
      })
      .join("");
    checklistHtml = `<div class="sop-checklist">${itemsHtml}</div>`;
  }

  el.innerHTML = `
    <div class="sop-panel-layout">
      <div class="sop-nav-list">${navItemsHtml}</div>
      <div class="sop-detail-card">
        <div class="sop-detail-header">
          <h3>第${selected}關・${escapeHtml(selectedLabel)}</h3>
          <span class="status-badge ${statusBadgeCls}">${statusBadgeText}</span>
        </div>
        ${checklistHtml}
        ${isDualGate && !isLandowner() ? `<div id="sop-tab-consent-panel" style="margin-top:14px"></div>` : ""}
        ${selectedIsCurrent && isEditor()
          ? `<div style="display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap">
                <button class="btn-primary btn-sm" id="complete-stage-btn" ${checklistAllDone ? "" : "disabled title=\"還有項目未完成\""}>完成本關卡</button>
                ${!checklistAllDone ? `<span class="helper-text">還有項目未完成,無法進入下一關</span>` : ""}
                ${isManager() ? `<button class="btn-warning btn-sm" id="force-stage-btn">主管強制完成</button>` : ""}
              </div>`
          : !selectedIsCurrent
            ? `<div class="helper-text" style="margin-top:16px">${selectedIsDone ? "這一關已經完成。" : "這一關還沒開始,要先完成前面的關卡才會解鎖。"}</div>`
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

  el.querySelectorAll("[data-checklist-confirm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.checklistConfirm;
      const currentlyConfirmed = btn.dataset.checklistConfirmed === "true";
      try {
        await api(`/projects/${pid}/sop/${selected}/checklist`, {
          method: "POST",
          body: { key, confirmed: !currentlyConfirmed },
        });
        toast(currentlyConfirmed ? "已取消確認" : "已確認", "success");
        renderSopTab(el);
      } catch (err) { }
    });
  });

  const rosterBtn = document.getElementById("roster-xlsx-btn");
  if (rosterBtn) {
    rosterBtn.addEventListener("click", async () => {
      rosterBtn.disabled = true;
      const orig = rosterBtn.textContent;
      rosterBtn.textContent = "產生中…";
      try {
        const res = await api(`/projects/${pid}/roster.xlsx`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const proj = state.currentProject || {};
        a.download = `${proj.project_code || "roster"}_地主清冊.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast("地主清冊已下載", "success");
      } catch (err) {
      } finally {
        rosterBtn.disabled = false;
        rosterBtn.textContent = orig;
      }
    });
  }

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
      try {
        await api(`/projects/${pid}/documents`, { method: "POST", body: fd, isForm: true });
        const label = DOC_TYPE_LABEL[docType] || docType;
        toast(`【${label}】已成功上傳`, "success");
        renderSopTab(el);
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
      } catch (err) { }
    });
  }
  const forceBtn = document.getElementById("force-stage-btn");
  if (forceBtn) {
    forceBtn.addEventListener("click", async () => {
      const reason = prompt("請輸入強制完成原因:");
      if (reason === null) return;
      try {
        await api(`/projects/${pid}/sop/${sop.current_stage}/complete`, { method: "POST", body: { force: true, reason } });
        toast("已強制完成關卡", "success");
        await renderSopSummary();
        state.sopSelectedStage = null;
        renderSopTab(el);
      } catch (err) { }
    });
  }
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
      ? `<div class="table-wrap">
            <table>
              <thead><tr><th>地主</th><th>本輪同意狀態</th><th>操作</th></tr></thead>
              <tbody>
                ${landowners
                  .map((o) => {
                    const rec = recordByLandowner[o.id];
                    const status = rec ? rec.consent_status : "pending";
                    return `<tr>
                      <td>${escapeHtml(o.name)}</td>
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

const WILLINGNESS_INTENT_DEFAULT =
  "本人願意參與本都市更新案件之相關整合及後續程序。\n本人同意由案件工作人員依相關規定聯繫、說明及辦理必要文件。";
const CONSENT_INTENT_DEFAULT =
  "本人已悉本案都市更新相關說明，並同意依案件程序辦理後續相關作業。";

const CONTRACT_PURPOSE_DEFAULT = "雙方就本都市更新案件之合作事項，依本契約約定辦理。";
const CONTRACT_COOPERATION_DEFAULT =
  "一、案件資料提供與確認。\n二、都市更新相關文件之簽署與管理。\n三、案件進度及必要事項之協調。";
const CONTRACT_DOCUMENTS_DEFAULT =
  "乙方應依甲方通知提供土地、建物及身分相關文件。\n甲方應妥善保存案件資料，並依約定用途使用。";
const CONTRACT_PERIOD_DEFAULT = "契約期間：自民國115年__月__日起至案件完成相關程序止。";

// Applicant + 不動產 blocks shared by 意願書 / 同意書 (the applicant's own data, not
// case-level, so no auto-fill from the project).
const APPLICANT_SECTIONS = [
  {
    title: "申請人資料",
    fields: [
      { name: "applicant_name", label: "姓名" },
      { name: "applicant_id", label: "身分證字號" },
      { name: "applicant_phone", label: "聯絡電話" },
      { name: "applicant_address", label: "通訊地址", full: true },
    ],
  },
  {
    title: "不動產資料",
    fields: [
      { name: "estate_section", label: "段名" },
      { name: "estate_parcel_number", label: "地號" },
      { name: "estate_building_number", label: "建號" },
      { name: "estate_share", label: "權利範圍" },
    ],
  },
];

// 案件層級基本資料 (auto-filled from the project) - used by 開發信 / 合約.
const CASE_BASIC_SECTION = {
  title: "基本資料",
  fields: [
    { name: "case_name", label: "案件名稱", default: (p) => p.name },
    { name: "case_number", label: "案件編號", default: (p) => p.project_code },
    { name: "dev_unit", label: "開發單位" },
    { name: "contact_name", label: "聯絡窗口 · 姓名" },
    { name: "contact_phone", label: "聯絡窗口 · 電話" },
    {
      name: "case_address",
      label: "案件地址",
      full: true,
      default: (p) => [p.city, p.district, p.address].filter(Boolean).join(""),
    },
  ],
};

// Per-範本 field schema. Falls back to the 案件基本資料 set for anything unlisted.
const STAGE_FORM_SCHEMAS = {
  willingness_form_template: {
    sections: [
      ...APPLICANT_SECTIONS,
      {
        title: "意願內容",
        fields: [
          { name: "intent_content", label: "意願內容", type: "textarea", full: true, rows: 3, default: () => WILLINGNESS_INTENT_DEFAULT },
        ],
      },
    ],
  },
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
  dev_letter_template: {
    sections: [
      CASE_BASIC_SECTION,
      { title: "", fields: [{ name: "dev_note", label: "開發說明", type: "textarea", full: true, rows: 4 }] },
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
  const schema = STAGE_FORM_SCHEMAS[docType] || STAGE_FORM_SCHEMAS.dev_letter_template;

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
