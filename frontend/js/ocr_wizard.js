"use strict";

const PING_PER_SQM = 0.3025;
let titleDeedWizard = null;

function openTitleDeedWizard() {
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "land", lockRecordType: true };
  renderWizardStep0();
}

function openBuildingTitleDeedWizard() {
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "building", lockRecordType: true };
  renderWizardStep0();
}

function wizardProgressHtml(label) {
  return `<div class="wizard-progress-label">📝 ${escapeHtml(label)}</div>`;
}

function normalizeTitleDeedData(raw) {
  raw = raw || {};
  const deedCategory = raw.deed_category || "";
  const cleanAddr = (a) => {
    const s = (a || "").trim();
    return ["(空白)", "（空白）", "空白", "無", "null", "None", "-"].includes(s) ? "" : s;
  };
  const toLandOwnerRow = (o) => {
    o = o || {};
    return {
      registration_order: o.registration_order || "",
      owner_name: o.owner_name || "",
      id_number: o.id_number || "",
      ownership_numerator: o.ownership_numerator || 1,
      ownership_denominator: o.ownership_denominator || 1,
      address: cleanAddr(o.address),
      // Per-owner, not per-parcel - co-owners of the same parcel often acquired their
      // share at different times/prices, each with their own 前次移轉現值或原規定地價.
      declared_value_per_sqm: o.declared_value_per_sqm ?? "",
      declared_value_period: o.declared_value_period || "",
    };
  };
  const toBuildingOwnerRow = (o) => {
    o = o || {};
    return {
      registration_order: o.registration_order || "",
      owner_name: o.owner_name || "",
      id_number: o.id_number || "",
      ownership_numerator: o.ownership_numerator || 1,
      ownership_denominator: o.ownership_denominator || 1,
      address: cleanAddr(o.address),
    };
  };

  const toEncumbranceRow = (e) => {
    e = e || {};
    return {
      registration_order: e.registration_order || "",
      applies_to_parcels: e.applies_to_parcels || "",
      right_type: e.right_type || "",
      right_holder: e.right_holder || "",
      debtor_info: e.debtor_info || "",
    };
  };

  const parcels = (raw.land_parcels || []).map((p) => ({
    township: p.township || "",
    section: p.section || "",
    subsection: p.subsection || "",
    parcel_number: p.parcel_number || "",
    area_sqm: p.area_sqm ?? "",
    owners: (p.owners || []).map(toLandOwnerRow),
    encumbrances: (p.encumbrances || []).map(toEncumbranceRow),
  }));

  const buildings = (raw.buildings || []).map((b) => ({
    building_number: b.building_number || "",
    building_address: b.building_address || "",
    parcel_number: b.parcel_number || "",
    total_floors: b.total_floors || "",
    floor: b.floor || "",
    total_area_sqm: b.total_area_sqm ?? "",
    floor_area_sqm: b.floor_area_sqm ?? "",
    owners: (b.owners || []).map(toBuildingOwnerRow),
  }));

  const encumbrances = (raw.encumbrances || []).map(toEncumbranceRow);
  return { deed_category: deedCategory, parcels, buildings, encumbrances };
}

function jumpToWizardRecordOwners(type, idx) {
  titleDeedWizard.activeType = type;
  titleDeedWizard.activeIndex = idx;
  titleDeedWizard.returnToConfirm = true;
  if (type === "parcel") {
    titleDeedWizard.parcelSubStep = 1;
    titleDeedWizard.step = 2;
  } else {
    titleDeedWizard.buildingSubStep = 1;
    titleDeedWizard.step = 3;
  }
  renderWizardStep();
}

function renderWizardStep() {
  const steps = {
    2: renderWizardStepParcelEditor,
    3: renderWizardStepBuildingEditor,
    4: renderWizardStepConfirm,
  };
  if (steps[titleDeedWizard.step]) {
    steps[titleDeedWizard.step]();
  }
}

function startWizardReview() {
  const d = titleDeedWizard.data;
  titleDeedWizard.parcelSubStep = 0;
  titleDeedWizard.buildingSubStep = 0;
  titleDeedWizard.returnToConfirm = false;
  if (d.parcels.length) {
    titleDeedWizard.activeType = "parcel";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 2;
  } else if (d.buildings.length) {
    titleDeedWizard.activeType = "building";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 3;
  } else {
    titleDeedWizard.step = 4;
  }
  renderWizardStep();
}

const WIZARD_RECORD_TYPE_LABEL = { both: "土地+建物謄本混合", land: "土地謄本(地號)", building: "建物謄本(建號)" };

function renderWizardStep0() {
  openModal(
    "掃描謄本匯入",
    `
    <div class="field">
      <label>選擇謄本圖片或 PDF(可多選;拍照多張時請依謄本頁面順序選取)</label>
      <input type="file" id="wizard-file-input" accept="image/*,application/pdf" multiple>
    </div>
    <div style="margin:-4px 0 10px">
      <button type="button" class="btn-link" id="wizard-pick-document-btn">或從本案件已上傳的文件選擇,不用重新下載再上傳</button>
    </div>
    <div id="wizard-file-list"></div>
    <div class="field" style="margin-top:6px">
      <label>謄本類別</label>
      <select id="wizard-deed-category-step0">
        <option value="">自動偵測(依內文判斷)</option>
        <option value="第一類謄本">第一類謄本</option>
        <option value="第二類謄本">第二類謄本</option>
        <option value="第三類謄本">第三類謄本</option>
      </select>
      <div class="helper-text">指定後即以此為準,不再依 OCR 內文自動判斷</div>
    </div>
    <div class="helper-text">若有多張照片或多頁,請用下方的 ▲▼ 調整順序,順序需與謄本頁面順序一致</div>
    <div id="wizard-ocr-progress-wrap" style="display:none;margin-top:14px">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-ocr-progress-fill" style="width:0%"></div></div>
      <div class="helper-text" id="wizard-ocr-progress-label" style="margin-top:4px;text-align:center"></div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-primary" id="wizard-start-ocr-btn">開始辨識</button>
    </div>`,
    { width: "560px" }
  );

  renderWizardFileList();

  document.getElementById("wizard-file-input").addEventListener("change", (e) => {
    titleDeedWizard.files.push(...Array.from(e.target.files));
    e.target.value = "";
    renderWizardFileList();
  });
  const recordTypeSelect = document.getElementById("wizard-record-type");
  if (recordTypeSelect) {
    recordTypeSelect.addEventListener("change", (e) => {
      titleDeedWizard.recordType = e.target.value;
    });
  }
  const deedCatStep0 = document.getElementById("wizard-deed-category-step0");
  if (deedCatStep0) {
    deedCatStep0.value = titleDeedWizard.manualDeedCategory || "";
    deedCatStep0.addEventListener("change", (e) => {
      titleDeedWizard.manualDeedCategory = e.target.value;
    });
  }
  document.getElementById("wizard-pick-document-btn").addEventListener("click", openWizardDocumentPicker);
  document.getElementById("wizard-start-ocr-btn").addEventListener("click", runTitleDeedOcr);
}

async function openWizardDocumentPicker() {
  let documents;
  try {
    documents = await api(`/projects/${state.currentProjectId}/documents`);
  } catch (e) {
    return;
  }
  documents = documents.filter((d) => (d.mime_type || "").startsWith("image/") || d.mime_type === "application/pdf");

  openModal(
    "從本案件文件選擇",
    `
    ${documents.length ? `<div class="helper-text" style="margin-bottom:10px">可勾選多個文件一次加入</div>` : ""}
    <div id="wizard-document-picker-list">
      ${documents.length
      ? documents
        .map(
          (d) => `
              <label class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer">
                <input type="checkbox" class="wizard-document-checkbox" value="${d.id}" style="width:auto;flex-shrink:0">
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.file_name)}${d.description ? ` · ${escapeHtml(d.description)}` : ""}</span>
              </label>`
        )
        .join("")
      : `<div class="helper-text">本案件尚未有可選擇的圖片或 PDF 文件</div>`
    }
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="renderWizardStep0()">返回</button>
      ${documents.length ? `<button type="button" class="btn-primary" id="wizard-document-picker-confirm-btn">加入選取的文件</button>` : ""}
    </div>`,
    { width: "560px" }
  );

  const confirmBtn = document.getElementById("wizard-document-picker-confirm-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      const checked = Array.from(document.querySelectorAll(".wizard-document-checkbox:checked"));
      if (!checked.length) {
        toast("請至少勾選一個文件", "error");
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "載入中...";
      try {
        for (const checkbox of checked) {
          const doc = documents.find((d) => d.id === Number(checkbox.value));
          const res = await api(`/projects/${state.currentProjectId}/documents/${doc.id}/download`);
          const blob = await res.blob();
          const file = new File([blob], doc.file_name, { type: doc.mime_type });
          file.sourceDocumentId = doc.id;
          titleDeedWizard.files.push(file);
        }
        renderWizardStep0();
      } catch (e) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "加入選取的文件";
      }
    });
  }
}

function renderWizardFileList() {
  const wrap = document.getElementById("wizard-file-list");
  if (!wrap) return;
  if (!titleDeedWizard.files.length) {
    wrap.innerHTML = `<div class="helper-text">尚未選擇檔案</div>`;
    return;
  }
  wrap.innerHTML = titleDeedWizard.files
    .map(
      (f, i) => `
      <div class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${escapeHtml(f.name)}</span>
        <button type="button" class="btn-secondary btn-sm" data-move-up="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="btn-secondary btn-sm" data-move-down="${i}" ${i === titleDeedWizard.files.length - 1 ? "disabled" : ""
        }>▼</button>
        <button type="button" class="btn-danger btn-sm" data-remove-file="${i}">移除</button>
      </div>`
    )
    .join("");

  wrap.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.moveUp);
      [titleDeedWizard.files[i - 1], titleDeedWizard.files[i]] = [titleDeedWizard.files[i], titleDeedWizard.files[i - 1]];
      renderWizardFileList();
    });
  });
  wrap.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.moveDown);
      [titleDeedWizard.files[i + 1], titleDeedWizard.files[i]] = [titleDeedWizard.files[i], titleDeedWizard.files[i + 1]];
      renderWizardFileList();
    });
  });
  wrap.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      titleDeedWizard.files.splice(Number(btn.dataset.removeFile), 1);
      renderWizardFileList();
    });
  });
}

function startFakeProgress(wrapId, fillId, labelId, tauSeconds = 20, labelPrefix = "偵測中") {
  const wrap = document.getElementById(wrapId);
  const fill = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  if (!wrap || !fill || !label) return { finish() { }, stop() { } };

  const startedAt = Date.now();
  wrap.style.display = "";
  const timer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const pct = 92 * (1 - Math.exp(-elapsed / tauSeconds));
    fill.style.width = `${pct}%`;
    label.textContent = `${labelPrefix}...已等待 ${Math.floor(elapsed)} 秒,頁數多可能需要數分鐘`;
  }, 250);
  return {
    finish() {
      clearInterval(timer);
      fill.style.width = "100%";
      label.textContent = "完成";
      setTimeout(() => {
        wrap.style.display = "none";
      }, 400);
    },
    stop() {
      clearInterval(timer);
      wrap.style.display = "none";
    },
  };
}

async function runTitleDeedOcr() {
  if (!titleDeedWizard.files.length) {
    toast("請先選擇至少一個檔案", "error");
    return;
  }
  const btn = document.getElementById("wizard-start-ocr-btn");
  btn.disabled = true;
  btn.textContent = "辨識中...(請稍候，勿關閉視窗)";
  const progress = startFakeProgress(
    "wizard-ocr-progress-wrap",
    "wizard-ocr-progress-fill",
    "wizard-ocr-progress-label",
    Math.max(20, titleDeedWizard.files.length * 3)
  );
  try {
    const fd = new FormData();
    titleDeedWizard.files.forEach((f) => {
      fd.append("files", f);
      fd.append("source_document_ids", f.sourceDocumentId ? String(f.sourceDocumentId) : "");
    });
    fd.append("record_type", titleDeedWizard.recordType);
    const result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });

    if (!result || !result.job || result.job.status !== "completed") {
      const errMsg = (result && result.job && result.job.error_message) || "辨識失敗,請確認檔案或聯絡管理員";
      toast(errMsg, "error");
      progress.stop();
      btn.disabled = false;
      btn.textContent = "開始辨識";
      return;
    }

    if (result.job.error_message) {
      titleDeedWizard.warning = result.job.error_message;
      toast(result.job.error_message, "error");
    } else {
      titleDeedWizard.warning = null;
    }

    titleDeedWizard.data = normalizeTitleDeedData(result.data);
    if (titleDeedWizard.manualDeedCategory) {
      const prefix = titleDeedWizard.recordType === "building" ? "建物登記" : "土地登記";
      titleDeedWizard.data.deed_category = `${prefix}${titleDeedWizard.manualDeedCategory}`;
    }
    titleDeedWizard.data.parcels.forEach((p) => {
      p._sourceOcrJobId = result.job.id;
    });
    titleDeedWizard.data.buildings.forEach((b) => {
      b._sourceOcrJobId = result.job.id;
    });
    toast("辨識完成,請逐步核對每個區塊", "success");
    progress.finish();
    startWizardReview();
  } catch (err) {
    progress.stop();
    btn.disabled = false;
    btn.textContent = "開始辨識";
    if (err && err.message && err.message !== "unauthorized" && !document.querySelector(".toast-error")) {
      toast(err.message, "error");
    }
  }
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function showImageLightbox(base64, mime) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:24px";
  overlay.innerHTML = `<img src="data:${mime};base64,${base64}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.5)">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function wireThumbnailLightbox(container, pages) {
  container.querySelectorAll("img[data-page-index]").forEach((img) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => {
      const p = pages[Number(img.dataset.pageIndex)];
      showImageLightbox(p.image_base64, p.mime_type);
    });
  });
}

function isThirdCategoryDeed() {
  const cat = (titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.deed_category) || "";
  return cat.includes("第三類");
}

function deedCategorySelectorHtml(containerId = "", prefix = "") {
  const isBuilding = titleDeedWizard && titleDeedWizard.recordType === "building";
  const defaultPrefix = isBuilding ? "建物登記" : "土地登記";
  let currentCat = (titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.deed_category) || `${defaultPrefix}第二類謄本`;

  if (!currentCat.includes("登記")) {
    currentCat = `${defaultPrefix}${currentCat}`;
  }

  const cats = [
    `${defaultPrefix}第一類謄本`,
    `${defaultPrefix}第二類謄本`,
    `${defaultPrefix}第三類謄本`,
  ];

  let color = "#2563eb";
  let bg = "#eff6ff";
  let border = "#bfdbfe";
  if (currentCat.includes("第一類")) {
    color = "#15803d";
    bg = "#f0fdf4";
    border = "#bbf7d0";
  } else if (currentCat.includes("第二類")) {
    color = "#b45309";
    bg = "#fffbeb";
    border = "#fde68a";
  } else if (currentCat.includes("第三類")) {
    color = "#6b21a8";
    bg = "#faf5ff";
    border = "#e9d5ff";
  }

  const containerAttr = containerId ? `data-container-id="${containerId}"` : "";
  const prefixAttr = prefix ? `data-prefix="${prefix}"` : "";

  return `
    <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;font-size:0.82rem;border-radius:12px;background:${bg};color:${color};border:1px solid ${border};font-weight:600;margin-left:8px">
      🏷️ <select id="wizard-deed-category-select" ${containerAttr} ${prefixAttr} style="background:transparent;border:none;color:inherit;font-weight:700;font-size:inherit;padding:0;cursor:pointer;outline:none">
        ${cats.map((c) => `<option value="${c}" ${currentCat.includes(c.slice(-5, -2)) ? "selected" : ""}>${c}</option>`).join("")}
      </select>
    </span>`;
}

function wireDeedCategorySelector() {
  const select = document.getElementById("wizard-deed-category-select");
  if (!select) return;
  select.addEventListener("change", (e) => {
    const val = e.target.value;
    if (titleDeedWizard && titleDeedWizard.data) {
      titleDeedWizard.data.deed_category = val;
    }
    const isThird = val.includes("第三類");
    const containerId = select.dataset.containerId;
    const prefix = select.dataset.prefix;

    if (containerId && prefix) {
      const container = document.getElementById(containerId);
      if (container) {
        container.querySelectorAll(`.${prefix}-idnum-wrap`).forEach((wrap) => {
          wrap.style.display = isThird ? "none" : "block";
        });
      }
    }

    let color = "#2563eb";
    let bg = "#eff6ff";
    let border = "#bfdbfe";
    if (val.includes("第一類")) {
      color = "#15803d"; bg = "#f0fdf4"; border = "#bbf7d0";
    } else if (val.includes("第二類")) {
      color = "#b45309"; bg = "#fffbeb"; border = "#fde68a";
    } else if (val.includes("第三類")) {
      color = "#6b21a8"; bg = "#faf5ff"; border = "#e9d5ff";
    }
    const parentSpan = select.closest("span");
    if (parentSpan) {
      parentSpan.style.background = bg;
      parentSpan.style.color = color;
      parentSpan.style.borderColor = border;
    }
  });
}

function parcelSummaryHtml(p, mode = "owners") {
  const place = `${p.township || ""}${p.section || ""}${p.subsection || ""}`;
  const countStr =
    mode === "encumbrances"
      ? `${(p.encumbrances || []).length} 筆他項權利`
      : `${(p.owners || []).length} 位所有權人`;
  const catSelector = deedCategorySelectorHtml("wizard-land-owners", "lo");
  return `<span>${escapeHtml(place || "(未填寫鄉鎮市區/地段)")} · 地號 ${escapeHtml(p.parcel_number || "-")} · ${countStr}</span>${catSelector}`;
}

function buildingSummaryHtml(b) {
  const catSelector = deedCategorySelectorHtml("wizard-building-owners", "bo");
  return `<span>建號 ${escapeHtml(b.building_number || "-")} · ${escapeHtml(b.building_address || "(未填寫門牌)")} · ${b.owners.length} 位所有權人</span>${catSelector}`;
}

function ownerRowHtml(prefix, o, areaSqm) {
  const numerator = o.ownership_numerator || 1;
  const denominator = o.ownership_denominator || 1;
  let areaFieldsHtml = "";
  if (areaSqm) {
    const ownedSqm = (areaSqm * numerator) / denominator;
    const ownedPing = ownedSqm * PING_PER_SQM;
    areaFieldsHtml = `
      <div class="field" style="flex:0 0 130px">
        <label>持分面積(m²)</label>
        <div class="${prefix}-area-sqm" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedSqm.toFixed(2)}</div>
      </div>
      <div class="field" style="flex:0 0 130px">
        <label>持分面積(坪)</label>
        <div class="${prefix}-area-ping" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedPing.toFixed(3)}</div>
      </div>`;
  }
  const declaredValueFieldHtml =
    prefix === "lo"
      ? `<div class="field" style="flex:1 1 220px;min-width:220px">
          <label>前次移轉現值或原規定地價(元/m²)</label>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="flex:0 0 100px">${minguoYearMonthPickerHtml(`${prefix}-declared-period`, o.declared_value_period)}</span>
            <input class="${prefix}-declared-value" type="number" step="1" value="${escapeHtml(o.declared_value_per_sqm)}" autocomplete="off" style="flex:1;min-width:0">
          </div>
        </div>`
      : "";

  const isThird = isThirdCategoryDeed();

  return `
    <div class="field-row">
      <div class="field" style="flex:0 0 88px"><label>登記次序</label><input class="${prefix}-order" value="${escapeHtml(o.registration_order)}" autocomplete="off"></div>
      <div class="field" style="flex:2 1 180px"><label>所有權人姓名</label><input class="${prefix}-name" value="${escapeHtml(o.owner_name)}" autocomplete="off"></div>
      <div class="field">
        <label>權利範圍</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="${prefix}-num" type="number" value="${numerator}" placeholder="分子" style="width:72px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input class="${prefix}-den" type="number" value="${denominator}" placeholder="分母" style="width:72px" autocomplete="off">
        </div>
      </div>
    </div>
    <div class="field ${prefix}-idnum-wrap" style="display:${isThird ? "none" : "block"}">
      <label>統一編號</label>
      <input class="${prefix}-idnum" value="${escapeHtml(o.id_number)}" placeholder="例如 A123456789 (一類完整、二類隱匿)" autocomplete="off">
    </div>
    <div class="field"><label>戶籍地址</label><input class="${prefix}-address" value="${escapeHtml(o.address)}" autocomplete="off"></div>
    <div class="field-row">
      ${areaFieldsHtml}
      ${declaredValueFieldHtml}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:8px;border-top:1px dashed var(--border-light, #e2e8f0)">
      <button type="button" class="btn-link btn-sm remove-wizard-row-btn" style="color:var(--danger)">刪除此筆</button>
      <button type="button" class="btn-secondary btn-sm insert-wizard-row-btn">+ 新增共有人</button>
    </div>`;
}

function renderOwnerRowsContainer(containerId, owners, prefix, areaSqm) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  // Dynamically update the header summary count (e.g. "11 位所有權人") when owners are added or deleted
  if (prefix === "lo") {
    const summaryEl = document.getElementById("wizard-parcel-summary");
    if (summaryEl && titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.parcels) {
      const p = titleDeedWizard.data.parcels[titleDeedWizard.activeIndex || 0];
      if (p) summaryEl.innerHTML = parcelSummaryHtml(p);
    }
  } else if (prefix === "bo") {
    const summaryEl = document.getElementById("wizard-building-summary");
    if (summaryEl && titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.buildings) {
      const b = titleDeedWizard.data.buildings[titleDeedWizard.activeIndex || 0];
      if (b) summaryEl.innerHTML = buildingSummaryHtml(b);
    }
  }

  wrap.innerHTML = `
    <div class="pooled-ownership-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span class="helper-text" style="margin:0">🔗 勾選 2 位以上「公同」共有人,系統會自動把整組權利範圍 ÷ 人數均分(取消勾選會還原)</span>
    </div>
    ${owners
      .map(
        (o, i) =>
          `<div class="record-row wizard-row" data-index="${i}"><div class="wizard-row-index" style="display:flex;align-items:center;gap:8px">共有人 #${i + 1}${o._pooled ? ` <span style="font-size:0.75rem;padding:1px 6px;border-radius:8px;background:#faf5ff;color:#6b21a8;border:1px solid #e9d5ff;font-weight:700">公同共有</span>` : ""}<label style="margin-left:auto;font-weight:400;font-size:0.8rem;display:inline-flex;align-items:center;gap:3px"><input type="checkbox" class="${prefix}-pooled-check" ${o._pooled ? "checked" : ""} style="width:auto">公同</label></div>${ownerRowHtml(prefix, o, areaSqm)}</div>`
      )
      .join("")}`;
  wireYearMonthPickers(wrap);
  wireDeedCategorySelector();

  // Checking the 「公同」 box on 2+ owners auto-splits: each pooled owner's 權利範圍
  // becomes groupNum / (groupDen × pooledCount). The group total is remembered per
  // owner in _pooledOrig so unchecking (or adding another) recomputes correctly and
  // unchecking fully restores the original fraction.
  const recomputePooled = () => {
    const latest = readOwnerRowsContainer(containerId, prefix, owners);
    owners.length = 0;
    owners.push(...latest);

    const checkedIdx = [...wrap.querySelectorAll(`.${prefix}-pooled-check`)]
      .map((c, i) => (c.checked ? i : -1))
      .filter((i) => i >= 0);

    // Restore + unmark any row that is no longer checked.
    owners.forEach((o, i) => {
      if (!checkedIdx.includes(i) && o._pooled) {
        if (o._pooledOrig) {
          o.ownership_numerator = o._pooledOrig.num;
          o.ownership_denominator = o._pooledOrig.den;
        }
        delete o._pooled;
        delete o._pooledOrig;
      }
    });

    if (checkedIdx.length === 1) {
      const o = owners[checkedIdx[0]];
      if (o._pooledOrig) {
        o.ownership_numerator = o._pooledOrig.num;
        o.ownership_denominator = o._pooledOrig.den;
      }
      delete o._pooled;
      delete o._pooledOrig;
      renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
      return;
    }
    if (checkedIdx.length < 1) {
      renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
      return;
    }

    // Group total 權利範圍: an already-pooled row remembers it; otherwise a freshly
    // checked row's current fraction is the group total.
    let g = null;
    for (const i of checkedIdx) {
      if (owners[i]._pooledOrig) { g = { ...owners[i]._pooledOrig }; break; }
    }
    if (!g) {
      for (const i of checkedIdx) {
        if (!owners[i]._pooled) {
          g = { num: Number(owners[i].ownership_numerator) || 1, den: Number(owners[i].ownership_denominator) || 1 };
          break;
        }
      }
    }
    if (!g) {
      const f = owners[checkedIdx[0]];
      g = { num: Number(f.ownership_numerator) || 1, den: Number(f.ownership_denominator) || 1 };
    }

    const gDen = g.den * checkedIdx.length;
    checkedIdx.forEach((i) => {
      if (!owners[i]._pooledOrig) owners[i]._pooledOrig = { num: g.num, den: g.den };
      owners[i]._pooled = true;
      owners[i].ownership_numerator = g.num;
      owners[i].ownership_denominator = gDen;
    });
    renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
    toast(`已將 ${checkedIdx.length} 位公同共有人各設為 ${g.num}/${gDen}`, "success");
  };

  wrap.querySelectorAll(`.${prefix}-pooled-check`).forEach((cb) => {
    cb.addEventListener("change", recomputePooled);
  });

  // Bind real-time input sync so typing into any field instantly updates in-memory owner object!
  wrap.querySelectorAll(".wizard-row").forEach((row) => {
    const idx = Number(row.dataset.index);
    if (isNaN(idx) || !owners[idx]) return;
    const o = owners[idx];

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        if (input.classList.contains(`${prefix}-order`)) o.registration_order = input.value.trim();
        if (input.classList.contains(`${prefix}-name`)) o.owner_name = input.value.trim();
        if (input.classList.contains(`${prefix}-idnum`)) o.id_number = input.value.trim();
        if (input.classList.contains(`${prefix}-num`)) o.ownership_numerator = Number(input.value) || 1;
        if (input.classList.contains(`${prefix}-den`)) o.ownership_denominator = Number(input.value) || 1;
        if (input.classList.contains(`${prefix}-address`)) o.address = input.value.trim();
        if (input.classList.contains(`${prefix}-declared-value`)) o.declared_value_per_sqm = input.value.trim();

        if (areaSqm && (input.classList.contains(`${prefix}-num`) || input.classList.contains(`${prefix}-den`))) {
          const num = Number(row.querySelector(`.${prefix}-num`)?.value) || 0;
          const den = Number(row.querySelector(`.${prefix}-den`)?.value) || 1;
          const ownedSqm = (areaSqm * num) / den;
          const areaSqmEl = row.querySelector(`.${prefix}-area-sqm`);
          const areaPingEl = row.querySelector(`.${prefix}-area-ping`);
          if (areaSqmEl) areaSqmEl.textContent = ownedSqm.toFixed(2);
          if (areaPingEl) areaPingEl.textContent = (ownedSqm * PING_PER_SQM).toFixed(3);
        }
      });
    });
  });

  wrap.querySelectorAll(".remove-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest(".wizard-row");
      const index = Number(row.dataset.index);
      readOwnerRowsContainer(containerId, prefix, owners);
      owners.splice(index, 1);
      renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
    });
  });

  wrap.querySelectorAll(".insert-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest(".wizard-row");
      const index = Number(row.dataset.index);
      readOwnerRowsContainer(containerId, prefix, owners);
      const newBlankOwner = {
        registration_order: "",
        owner_name: "",
        id_number: "",
        ownership_numerator: 1,
        ownership_denominator: 1,
        address: "",
        declared_value_per_sqm: "",
        declared_value_period: "",
      };
      owners.splice(index + 1, 0, newBlankOwner);
      renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);

      const insertedRow = wrap.querySelector(`.wizard-row[data-index="${index + 1}"]`);
      if (insertedRow) {
        insertedRow.scrollIntoView({ behavior: "smooth", block: "center" });
        const nameInput = insertedRow.querySelector(`.${prefix}-name`);
        if (nameInput) nameInput.focus();
      }
    });
  });
}

function readOwnerRowsContainer(containerId, prefix, originalOwners = []) {
  const rows = [...document.querySelectorAll(`#${containerId} .wizard-row`)];
  const result = rows.map((row, i) => {
    const orig = originalOwners[i] || {};
    const orderEl = row.querySelector(`.${prefix}-order`);
    const nameEl = row.querySelector(`.${prefix}-name`);
    const numEl = row.querySelector(`.${prefix}-num`);
    const denEl = row.querySelector(`.${prefix}-den`);
    const addrEl = row.querySelector(`.${prefix}-address`);

    const obj = {
      ...orig,
      registration_order: orderEl ? orderEl.value.trim() : (orig.registration_order || ""),
      owner_name: nameEl ? nameEl.value.trim() : (orig.owner_name || ""),
      ownership_numerator: numEl ? (Number(numEl.value) || 1) : (orig.ownership_numerator || 1),
      ownership_denominator: denEl ? (Number(denEl.value) || 1) : (orig.ownership_denominator || 1),
      address: addrEl ? addrEl.value.trim() : (orig.address || ""),
    };

    const idInput = row.querySelector(`.${prefix}-idnum`);
    if (idInput) {
      obj.id_number = idInput.value.trim();
    }

    if (prefix === "lo") {
      const declaredValEl = row.querySelector(`.${prefix}-declared-value`);
      if (declaredValEl) {
        obj.declared_value_per_sqm = declaredValEl.value.trim();
      }
      const periodWrap = row.querySelector(`[data-ymp-name="${prefix}-declared-period"]`);
      if (periodWrap && periodWrap.dataset.ympYear && periodWrap.dataset.ympMonth) {
        obj.declared_value_period = `${periodWrap.dataset.ympYear}年${String(periodWrap.dataset.ympMonth).padStart(2, "0")}月`;
      }
    }
    return obj;
  });

  if (originalOwners && originalOwners.length === result.length) {
    for (let i = 0; i < result.length; i++) {
      Object.assign(originalOwners[i], result[i]);
    }
  }
  return result;
}

function openWizardSingleRecordRescan(recordType, record, rerender) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.multiple = true;
  input.addEventListener("change", async () => {
    if (!input.files.length) return;
    const btn = document.getElementById("wizard-rescan-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "重新辨識中...(請稍候，勿關閉視窗)";
      const wrap = document.createElement("div");
      wrap.id = "wizard-rescan-progress-wrap";
      wrap.style.marginTop = "8px";
      wrap.innerHTML = `
        <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-rescan-progress-fill" style="width:0%"></div></div>
        <div class="helper-text" id="wizard-rescan-progress-label" style="margin-top:4px;text-align:center"></div>`;
      btn.insertAdjacentElement("afterend", wrap);
    }
    var progress = btn
      ? startFakeProgress("wizard-rescan-progress-wrap", "wizard-rescan-progress-fill", "wizard-rescan-progress-label", 20, "重新辨識中")
      : null;
    try {
      const fd = new FormData();
      Array.from(input.files).forEach((f) => fd.append("files", f));
      fd.append("record_type", recordType === "parcel" ? "land" : "building");
      const result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });
      const normalized = normalizeTitleDeedData(result.data);
      const list = recordType === "parcel" ? normalized.parcels : normalized.buildings;
      if (list.length) {
        Object.assign(record, list[0]);
        toast("已重新辨識,請核對欄位", "success");
      } else {
        toast(`這份檔案沒有偵測到${recordType === "parcel" ? "地號" : "建物"}資料`, "error");
      }
      if (progress) progress.finish();
    } catch (e) {
      if (progress) progress.stop();
    } finally {
      rerender();
    }
  });
  input.click();
}

function advanceFromParcel(idx) {
  const d = titleDeedWizard.data;
  titleDeedWizard.parcelSubStep = 0;
  if (titleDeedWizard.returnToConfirm) {
    titleDeedWizard.returnToConfirm = false;
    titleDeedWizard.step = 4;
    renderWizardStep();
    return;
  }
  if (idx < d.parcels.length) {
    titleDeedWizard.activeIndex = idx;
    renderWizardStep();
  } else if (d.buildings.length) {
    titleDeedWizard.activeType = "building";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.buildingSubStep = 0;
    titleDeedWizard.step = 3;
    renderWizardStep();
  } else {
    titleDeedWizard.step = 4;
    renderWizardStep();
  }
}

function renderWizardStepParcelEditor() {
  const substeps = [renderParcelDescriptionSubStep, renderParcelOwnersSubStep, renderParcelEncumbrancesSubStep];
  substeps[titleDeedWizard.parcelSubStep || 0](titleDeedWizard.activeIndex);
}

function renderParcelDescriptionSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 1/3 土地標示部`)}
    <div style="margin-bottom:10px">
      <button type="button" class="btn-secondary btn-sm" id="wizard-rescan-btn">重新上傳這一筆的謄本檔案並辨識</button>
    </div>
    <form id="wizard-step-form" autocomplete="off">
      <div class="field-row">
        <div class="field"><label>鄉鎮市區</label><input name="township" value="${escapeHtml(p.township)}" autocomplete="off"></div>
        <div class="field"><label>地段</label><input name="section" value="${escapeHtml(p.section)}" autocomplete="off"></div>
        <div class="field"><label>小段</label><input name="subsection" value="${escapeHtml(p.subsection)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(p.parcel_number)}" autocomplete="off"></div>
        <div class="field"><label>土地面積(㎡)</label><input name="area_sqm" type="number" step="0.01" value="${escapeHtml(p.area_sqm)}" autocomplete="off"></div>
      </div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="wizard-delete-parcel-btn">刪除此筆</button>
      ${idx > 0 && !titleDeedWizard.returnToConfirm ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地所有權部</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-rescan-btn").addEventListener("click", () => {
    openWizardSingleRecordRescan("parcel", p, () => renderParcelDescriptionSubStep(idx));
  });

  const saveFields = () => {
    const fd = new FormData(document.getElementById("wizard-step-form"));
    Object.assign(p, {
      township: (fd.get("township") || "").trim(),
      section: (fd.get("section") || "").trim(),
      subsection: (fd.get("subsection") || "").trim(),
      parcel_number: (fd.get("parcel_number") || "").trim(),
      area_sqm: fd.get("area_sqm") || "",
    });
  };

  const prevBtn = document.getElementById("wizard-prev-item-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      saveFields();
      titleDeedWizard.activeIndex = idx - 1;
      titleDeedWizard.parcelSubStep = 2;
      renderWizardStep();
    });
  }
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    saveFields();
    titleDeedWizard.parcelSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-delete-parcel-btn").addEventListener("click", () => {
    parcels.splice(idx, 1);
    advanceFromParcel(idx);
  });
}

function renderParcelOwnersSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 2/3 土地所有權部`)}
    <div class="helper-text" id="wizard-parcel-summary" style="margin-bottom:10px">${parcelSummaryHtml(p)}</div>
    <div id="wizard-land-owners" style="margin:6px 0"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地他項權利部</button>
    </div>`,
    { width: "620px" }
  );

  const areaSqm = Number(p.area_sqm) || null;
  renderOwnerRowsContainer("wizard-land-owners", p.owners, "lo", areaSqm);

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    p.owners = readOwnerRowsContainer("wizard-land-owners", "lo", p.owners);
    titleDeedWizard.parcelSubStep = 0;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    p.owners = readOwnerRowsContainer("wizard-land-owners", "lo", p.owners);
    titleDeedWizard.parcelSubStep = 2;
    renderWizardStep();
  });
}

function renderParcelEncumbrancesSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  const isLast = idx === parcels.length - 1 || titleDeedWizard.returnToConfirm;
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 3/3 土地他項權利部`)}
    <div class="helper-text" id="wizard-parcel-enc-summary" style="margin-bottom:10px">${parcelSummaryHtml(p, "encumbrances")}</div>
    <div id="wizard-parcel-encumbrances" style="margin:6px 0"></div>
    <button type="button" class="btn-secondary btn-sm" id="wizard-add-parcel-encumbrance-btn">+ 新增他項權利</button>
    <div class="helper-text" style="margin-top:6px">若這筆地號沒有他項權利部,可直接略過。跨好幾筆地號的他項權利,留到最後「他項權利部」步驟處理即可</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "下一步" : "下一筆地號"}</button>
    </div>`,
    { width: "620px" }
  );

  renderEncumbranceRows("wizard-parcel-encumbrances", p.encumbrances);

  document.getElementById("wizard-add-parcel-encumbrance-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    p.encumbrances.push({
      registration_order: "",
      applies_to_parcels: p.parcel_number || "",
      right_type: "",
      right_holder: "",
      debtor_info: "",
    });
    renderEncumbranceRows("wizard-parcel-encumbrances", p.encumbrances);
  });

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    titleDeedWizard.parcelSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    advanceFromParcel(idx + 1);
  });
}

const ENCUMBRANCE_RIGHT_TYPE_OPTIONS = ["最高限額抵押權", "抵押權"];

function levenshteinAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (shorter.length === longer.length) i++;
    j++;
  }
  return true;
}

function parseDebtorRatio(debtorInfo) {
  const match = (debtorInfo || "").match(/(\d+)\s*(?:分之|\/)\s*(\d+)/);
  return match ? { denominator: match[1], numerator: match[2] } : { denominator: "", numerator: "" };
}

function encumbranceRightTypeOptionsHtml(rawType) {
  const closeMatch = ENCUMBRANCE_RIGHT_TYPE_OPTIONS.find((t) => t === rawType || levenshteinAtMostOne(rawType, t));
  const currentType = closeMatch || rawType || "";
  const isKnownType = !!closeMatch;
  return `
    <option value="" ${currentType ? "" : "selected"}>請選擇</option>
    ${ENCUMBRANCE_RIGHT_TYPE_OPTIONS.map(
    (t) => `<option value="${escapeHtml(t)}" ${currentType === t ? "selected" : ""}>${escapeHtml(t)}</option>`
  ).join("")}
    ${currentType && !isKnownType ? `<option value="${escapeHtml(currentType)}" selected>${escapeHtml(currentType)}(AI 辨識,非標準選項)</option>` : ""}
  `;
}

function encumbranceRowHtml(e) {
  const ratio = parseDebtorRatio(e.debtor_info);
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input class="enc-order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
      <div class="field"><label>對應地號</label><input class="enc-parcels" value="${escapeHtml(e.applies_to_parcels)}" autocomplete="off"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>權利種類</label>
        <select class="enc-type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
      </div>
      <div class="field"><label>他項權利人</label><input class="enc-holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
    </div>
    <div class="field">
      <label>債務額比例</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="enc-debtor-num" type="number" value="${escapeHtml(ratio.numerator)}" placeholder="分子" style="width:90px" autocomplete="off">
        <span style="color:var(--text-muted)">/</span>
        <input class="enc-debtor-den" type="number" value="${escapeHtml(ratio.denominator)}" placeholder="分母" style="width:90px" autocomplete="off">
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-wizard-row-btn">刪除此筆</button>`;
}

function renderEncumbranceRows(containerId, list) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  const summaryEl = document.getElementById("wizard-parcel-enc-summary");
  if (summaryEl && titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.parcels) {
    const p = titleDeedWizard.data.parcels[titleDeedWizard.activeIndex || 0];
    if (p) summaryEl.innerHTML = parcelSummaryHtml(p, "encumbrances");
  }

  wrap.innerHTML = list.map((e) => `<div class="record-row wizard-row">${encumbranceRowHtml(e)}</div>`).join("");
  wrap.querySelectorAll(".remove-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const row = e.target.closest(".wizard-row");
      const rows = [...wrap.querySelectorAll(".wizard-row")];
      const index = rows.indexOf(row);
      if (index !== -1) {
        list.splice(index, 1);
        renderEncumbranceRows(containerId, list);
      }
    });
  });
}

function readEncumbranceRows(containerId) {
  return [...document.querySelectorAll(`#${containerId} .wizard-row`)]
    .map((row) => {
      const numerator = row.querySelector(".enc-debtor-num").value.trim();
      const denominator = row.querySelector(".enc-debtor-den").value.trim();
      return {
        registration_order: row.querySelector(".enc-order").value.trim(),
        applies_to_parcels: row.querySelector(".enc-parcels").value.trim(),
        right_type: row.querySelector(".enc-type").value.trim(),
        right_holder: row.querySelector(".enc-holder").value.trim(),
        debtor_info: numerator && denominator ? `${denominator}分之${numerator}` : "",
      };
    })
    .filter((e) => e.right_type || e.right_holder);
}

function advanceFromBuilding(idx) {
  const d = titleDeedWizard.data;
  titleDeedWizard.buildingSubStep = 0;
  if (titleDeedWizard.returnToConfirm) {
    titleDeedWizard.returnToConfirm = false;
    titleDeedWizard.step = 4;
    renderWizardStep();
    return;
  }
  if (idx < d.buildings.length) {
    titleDeedWizard.activeIndex = idx;
    renderWizardStep();
  } else {
    titleDeedWizard.step = 4;
    renderWizardStep();
  }
}

function renderWizardStepBuildingEditor() {
  const substeps = [renderBuildingDescriptionSubStep, renderBuildingOwnersSubStep];
  substeps[titleDeedWizard.buildingSubStep || 0](titleDeedWizard.activeIndex);
}

function renderBuildingDescriptionSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 1/2 建物標示部`)}
    <div style="margin-bottom:10px">
      <button type="button" class="btn-secondary btn-sm" id="wizard-rescan-btn">重新上傳這一筆的建物謄本檔案並辨識</button>
    </div>
    <form id="wizard-step-form" autocomplete="off">
      <div class="field-row">
        <div class="field"><label>建號</label><input name="building_number" value="${escapeHtml(b.building_number)}" autocomplete="off"></div>
        <div class="field"><label>建號門牌</label><input name="building_address" value="${escapeHtml(b.building_address)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(b.parcel_number)}" autocomplete="off"></div>
        <div class="field"><label>層數</label><input name="total_floors" value="${escapeHtml(b.total_floors)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>層次</label><input name="floor" value="${escapeHtml(b.floor)}" autocomplete="off"></div>
        <div class="field"><label>建物總面積(㎡)</label><input name="total_area_sqm" value="${escapeHtml(b.total_area_sqm)}" type="number" step="0.01" autocomplete="off"></div>
      </div>
      <div class="field"><label>層次面積(㎡)</label><input name="floor_area_sqm" value="${escapeHtml(b.floor_area_sqm)}" type="number" step="0.01" autocomplete="off"></div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="wizard-delete-building-btn">刪除此筆</button>
      ${idx > 0 && !titleDeedWizard.returnToConfirm ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:建物所有權部</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-rescan-btn").addEventListener("click", () => {
    openWizardSingleRecordRescan("building", b, () => renderBuildingDescriptionSubStep(idx));
  });

  const saveFields = () => {
    const fd = new FormData(document.getElementById("wizard-step-form"));
    Object.assign(b, {
      building_number: (fd.get("building_number") || "").trim(),
      building_address: (fd.get("building_address") || "").trim(),
      parcel_number: (fd.get("parcel_number") || "").trim(),
      total_floors: (fd.get("total_floors") || "").trim(),
      floor: (fd.get("floor") || "").trim(),
      total_area_sqm: fd.get("total_area_sqm") || "",
      floor_area_sqm: fd.get("floor_area_sqm") || "",
    });
  };

  const prevBtn = document.getElementById("wizard-prev-item-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      saveFields();
      titleDeedWizard.activeIndex = idx - 1;
      titleDeedWizard.buildingSubStep = 1;
      renderWizardStep();
    });
  }
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    saveFields();
    titleDeedWizard.buildingSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-delete-building-btn").addEventListener("click", () => {
    buildings.splice(idx, 1);
    advanceFromBuilding(idx);
  });
}

function renderBuildingOwnersSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  const isLast = idx === buildings.length - 1 || titleDeedWizard.returnToConfirm;
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 2/2 建物所有權部`)}
    <div class="helper-text" id="wizard-building-summary" style="margin-bottom:10px">${buildingSummaryHtml(b)}</div>
    <div id="wizard-building-owners" style="margin:6px 0"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "下一步" : "下一筆建號"}</button>
    </div>`,
    { width: "620px" }
  );
  const areaSqm = Number(b.total_area_sqm) || Number(b.floor_area_sqm) || null;
  renderOwnerRowsContainer("wizard-building-owners", b.owners, "bo", areaSqm);

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo", b.owners);
    titleDeedWizard.buildingSubStep = 0;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo", b.owners);
    advanceFromBuilding(idx + 1);
  });
}

function renderWizardStepConfirm() {
  const d = titleDeedWizard.data;
  const shareSum = (owners) =>
    owners.reduce((sum, o) => sum + (Number(o.ownership_numerator) || 0) / (Number(o.ownership_denominator) || 1), 0);
  const shareSumWarningHtml = (owners) => {
    if (!owners.length) return "";
    const sum = shareSum(owners);
    if (Math.abs(sum - 1) <= 0.05) return "";
    return `<div class="wizard-confirm-card-row" style="color:var(--danger)">⚠ 權利範圍加總為 ${(sum * 100).toFixed(1)}%,明顯偏離 100%,請重點核對這幾位所有權人的權利範圍</div>`;
  };

  const suspiciousOwnerFindings = (owners, item = null) => {
    const findings = [];
    if (item) {
      if (item.parcel_number !== undefined && (item.area_sqm === "" || item.area_sqm === null)) {
        findings.push(`地號「${escapeHtml(item.parcel_number) || "-"}」缺少土地面積，請對照原始檔案補填`);
      }
      if (item.building_number !== undefined && item.total_area_sqm === "" && item.floor_area_sqm === "") {
        findings.push(`建號「${escapeHtml(item.building_number) || "-"}」缺少建物面積，請對照原始檔案補填`);
      }
    }
    const orderCounts = new Map();
    owners.forEach((o) => {
      const order = (o.registration_order || "").trim();
      if (order) orderCounts.set(order, (orderCounts.get(order) || 0) + 1);
    });
    owners.forEach((o) => {
      const order = (o.registration_order || "").trim();
      if (order && orderCounts.get(order) > 1) {
        findings.push(`「${escapeHtml(o.owner_name) || "-"}」的登記次序「${escapeHtml(order)}」跟同一筆裡其他共有人重複`);
      }
      if (!order && o.owner_name) {
        findings.push(`「${escapeHtml(o.owner_name)}」沒有登記次序,可能是這一行在原始掃描件裡沒被辨識到,請對照原件補上`);
      }
      if (!o.address && o.owner_name) {
        findings.push(`「${escapeHtml(o.owner_name)}」缺少戶籍地址，建議對照原件補填`);
      }
      if ((o.ownership_numerator || 0) > (o.ownership_denominator || 1)) {
        findings.push(`「${escapeHtml(o.owner_name) || "-"}」的權利範圍分子大於分母(${o.ownership_numerator}/${o.ownership_denominator})`);
      }
      if ((o.ownership_denominator || 0) <= 0) {
        findings.push(`「${escapeHtml(o.owner_name) || "-"}」的權利範圍分母無效(${o.ownership_denominator})，請重新填寫`);
      }
      if (/里\d+[路街巷]/.test(o.address || "")) {
        findings.push(`「${escapeHtml(o.owner_name) || "-"}」的地址「${escapeHtml(o.address)}」看起來像漏掉「鄰」字`);
      }
    });
    const names = owners.map((o) => (o.owner_name || "").trim()).filter(Boolean);
    owners.forEach((o) => {
      const name = (o.owner_name || "").trim();
      if (name.length < 2) return;
      const isPrefixOfLonger = names.some((other) => other !== name && other.startsWith(name));
      if (isPrefixOfLonger) {
        findings.push(`「${escapeHtml(name)}」剛好是同一筆裡另一個人姓名的開頭,可能是漏了最後一個字`);
      }
    });
    return findings;
  };
  const suspiciousOwnerWarningHtml = (owners, item = null) => {
    const findings = suspiciousOwnerFindings(owners, item);
    if (!findings.length) return "";
    return `<div class="wizard-confirm-card-row" style="color:var(--warning);flex-direction:column;align-items:flex-start;gap:2px">${findings.map((f) => `<div>⚠ ${f}</div>`).join("")}</div>`;
  };
  const ownerChipsHtml = (owners) =>
    `<div class="wizard-confirm-chip-list">${owners
      .map((o) => `<span class="wizard-confirm-chip">${escapeHtml(o.owner_name) || "-"}(${o.ownership_numerator}/${o.ownership_denominator})</span>`)
      .join("")}</div>`;
  const parcelCardHtml = (p, idx) => `
    <div class="wizard-confirm-card">
      <div class="wizard-confirm-card-row" style="justify-content:space-between;align-items:center">
        <div class="wizard-confirm-card-title">${escapeHtml(parcelSummaryLabel(p))}</div>
        <button type="button" class="btn-link btn-sm" data-jump-parcel="${idx}">編輯</button>
      </div>
      <div class="wizard-confirm-card-row">
        <span class="wizard-confirm-card-label">所有權人</span>
        ${ownerChipsHtml(p.owners)}
      </div>
      ${shareSumWarningHtml(p.owners)}
      ${suspiciousOwnerWarningHtml(p.owners, p)}
      ${(p.encumbrances || []).length
      ? `<div class="wizard-confirm-card-row">
              <span class="wizard-confirm-card-label">他項權利</span>
              <div class="wizard-confirm-chip-list">${(p.encumbrances || []).map((e) => `<span class="wizard-confirm-chip encumbrance">${escapeHtml(e.right_type) || "-"} · ${escapeHtml(e.right_holder) || "-"}</span>`).join("")}</div>
            </div>`
      : ""
    }
    </div>`;
  const parcelsHtml = d.parcels.length
    ? d.parcels.map(parcelCardHtml).join("")
    : `<div class="helper-text" style="margin-top:8px">(本次未包含土地資料)</div>`;
  const buildingsSectionHtml = d.buildings.length
    ? `<div class="wizard-confirm-section-title">建物建號(${d.buildings.length})</div>
      ${d.buildings
      .map(
        (b, idx) => `
        <div class="wizard-confirm-card">
          <div class="wizard-confirm-card-row" style="justify-content:space-between;align-items:center">
            <div class="wizard-confirm-card-title">${escapeHtml(buildingSummaryLabel(b))}</div>
            <button type="button" class="btn-link btn-sm" data-jump-building="${idx}">編輯</button>
          </div>
          <div class="wizard-confirm-card-row">
            <span class="wizard-confirm-card-label">所有權人</span>
            ${ownerChipsHtml(b.owners)}
          </div>
          ${shareSumWarningHtml(b.owners)}
          ${suspiciousOwnerWarningHtml(b.owners, b)}
        </div>`
      )
      .join("")}`
    : "";

  const relationRowsHtml = d.parcels
    .map((p) => {
      const linkedBuildings = d.buildings.filter((b) => b.parcel_number && b.parcel_number === p.parcel_number);
      if (!linkedBuildings.length) return "";
      return `
        <div class="wizard-relation-row">
          <div class="wizard-relation-card">
            <div class="wizard-relation-card-title">📍 地號 ${escapeHtml(p.parcel_number) || "-"}</div>
            <div class="wizard-relation-card-sub">${escapeHtml(parcelSummaryLabel(p))}</div>
          </div>
          <div class="wizard-relation-arrow">→</div>
          <div class="wizard-relation-card">
            <div class="wizard-relation-card-title">🏢 建號 ${linkedBuildings.length} 筆</div>
            <div class="wizard-relation-card-sub">${linkedBuildings.map((b) => escapeHtml(b.building_number) || "-").join("、")}</div>
          </div>
        </div>`;
    })
    .join("");
  const relationSectionHtml = relationRowsHtml
    ? `<div class="wizard-confirm-section-title">地號 → 建號 關聯預覽</div>${relationRowsHtml}`
    : "";

  const backendWarningBannerHtml = titleDeedWizard.warning
    ? `<div class="final-banner danger" style="margin-bottom:12px;background:#fde8e8;color:#9b1c1c;border:1px solid #f8b4b4;font-weight:600">⚠️ 辨識提示與完整性警示：${escapeHtml(titleDeedWizard.warning)}</div>`
    : "";

  const noDataWarningHtml = (!d.parcels.length && !d.buildings.length)
    ? `<div class="final-banner danger" style="margin-bottom:16px;padding:12px;background:#fff5f5;border:1px solid #f8b4b4;border-radius:8px">
        <div style="font-weight:600;color:#c53030;margin-bottom:4px">⚠️ 辨識結果未包含地號或建號</div>
        <div style="font-size:13px;color:#4a5568;margin-bottom:8px">本次掃描未擷取到有效的土地地號或建物建號資料。請檢查：
          <ul style="margin:4px 0 8px 18px;padding:0">
            <li>檔案類別是否選擇正確（建議選擇「土地+建物謄本混合」）</li>
            <li>上傳的圖片/PDF 檔是否清楚完整</li>
          </ul>
        </div>
        <button type="button" class="btn-secondary btn-sm" onclick="renderWizardStep0()">← 返回重新選擇檔案與類別</button>
      </div>`
    : "";

  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml("確認建立")}
    ${backendWarningBannerHtml}
    ${noDataWarningHtml}
    <div class="final-banner warning" style="margin-bottom:16px">⚠️ 建立前最後確認：以下姓名、地址、面積等內容為 AI 辨識結果，可能有誤或臆測，請務必逐筆對照原始掃描件</div>
    ${relationSectionHtml}
    <div class="wizard-confirm-section-title">土地地號(${d.parcels.length})</div>
    ${parcelsHtml}
    ${buildingsSectionHtml}
    ${d.encumbrances.length
      ? `<div class="wizard-confirm-section-title">跨地號/建號的他項權利(${d.encumbrances.length})</div>
          <div class="wizard-confirm-card">
            <div class="wizard-confirm-chip-list">
              ${d.encumbrances.map((e) => `<span class="wizard-confirm-chip encumbrance">${escapeHtml(e.right_type) || "-"} · ${escapeHtml(e.right_holder) || "-"}</span>`).join("")}
            </div>
          </div>`
      : ""
    }
    <div class="helper-text" style="margin-top:14px;line-height:1.6">確認無誤後點「建立」，系統會自動比對／建立地主，並寫入土地、建物、他項權利資料。同一人若出現在多筆地號／建號，只會建立一筆地主。</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-confirm-btn" ${!d.parcels.length && !d.buildings.length ? "disabled" : ""}>建立</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-prev-btn").addEventListener("click", () => {
    const d = titleDeedWizard.data;
    if (d.buildings.length) {
      titleDeedWizard.activeType = "building";
      titleDeedWizard.activeIndex = d.buildings.length - 1;
      titleDeedWizard.buildingSubStep = 1;
      titleDeedWizard.step = 3;
    } else if (d.parcels.length) {
      titleDeedWizard.activeType = "parcel";
      titleDeedWizard.activeIndex = d.parcels.length - 1;
      titleDeedWizard.parcelSubStep = 2;
      titleDeedWizard.step = 2;
    } else {
      closeModal();
      return;
    }
    renderWizardStep();
  });
  document.getElementById("wizard-confirm-btn").addEventListener("click", submitTitleDeedWizard);
  document.querySelectorAll("[data-jump-parcel]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToWizardRecordOwners("parcel", Number(btn.dataset.jumpParcel)));
  });
  document.querySelectorAll("[data-jump-building]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToWizardRecordOwners("building", Number(btn.dataset.jumpBuilding)));
  });
}

async function findOrCreateLandownerByOwner(owner, createdCache) {
  const pid = state.currentProjectId;
  const idKey = (owner.id_number || "").trim();
  const nameKey = owner.owner_name.trim();
  const cacheKey = idKey || `name:${nameKey}`;
  if (createdCache.has(cacheKey)) return createdCache.get(cacheKey);

  // Match against every existing landowner, not just ones that already have this
  // import's record type (land/building) - landowners is one shared person table, so
  // someone who already owns land and is now being matched while importing a building
  // registry must still be found and reused, not treated as a new person just because
  // their existing record happens to be the other type. Filtering by matchRecordType
  // here used to do exactly that, silently creating a second landowner row for the same
  // real person on every land+building mixed case (confirmed against production data:
  // 27 duplicate names in one project, each split into a land-only row and a
  // building-only row with no shared landowner_id).
  const existingList = state.projectCache[pid].landowners;
  let existing = null;
  if (idKey) existing = existingList.find((o) => o.id_number && o.id_number === idKey);
  if (!existing) existing = existingList.find((o) => o.name === nameKey);

  let landownerId;
  if (existing) {
    landownerId = existing.id;
  } else {
    const created = await api(`/projects/${pid}/landowners`, {
      method: "POST",
      body: {
        name: nameKey,
        id_number: idKey || null,
        address: owner.address || null,
        notes: owner._pooled ? "公同共有(謄本掃描匯入,權利範圍已依人數均分)" : null,
        land_records: [],
        building_records: [],
      },
    });
    landownerId = created.id;
    existingList.push(created);
  }
  createdCache.set(cacheKey, landownerId);
  return landownerId;
}

// Guards against the whole batch getting submitted twice (confirmed happening in
// production: an entire ~34-record building batch was created twice, 21s apart, same
// source_ocr_job_id - almost certainly a double click landing before the "建立中..."
// disabled state visually registered). btn.disabled alone should already prevent a
// second click's handler from firing, but evidently didn't in practice, so this adds a
// second, unconditional guard that doesn't depend on DOM/button state at all.
let wizardSubmitInFlight = false;

async function submitTitleDeedWizard() {
  if (wizardSubmitInFlight) return;
  wizardSubmitInFlight = true;
  try {
    await submitTitleDeedWizardInner();
  } finally {
    wizardSubmitInFlight = false;
  }
}

async function submitTitleDeedWizardInner() {
  const d = titleDeedWizard.data;

  const badParcelIndex = d.parcels.findIndex((p) => p.owners.some((o) => o.owner_name) && !p.parcel_number);
  if (badParcelIndex !== -1) {
    toast(`第 ${badParcelIndex + 1} 筆地號缺少地號欄位,請返回編輯`, "error");
    titleDeedWizard.activeType = "parcel";
    titleDeedWizard.activeIndex = badParcelIndex;
    titleDeedWizard.step = 2;
    renderWizardStep();
    return;
  }

  const btn = document.getElementById("wizard-confirm-btn");
  btn.disabled = true;
  btn.textContent = "建立中...";
  const pid = state.currentProjectId;
  const createdCache = new Map();
  const landRecordIdByParcelOwner = new Map();
  const ownerIdentityKey = (owner) => (owner.id_number || "").trim() || `name:${(owner.owner_name || owner.name || "").trim()}`;
  const parcelOwnerKey = (parcelNumber, identityKey) => `${(parcelNumber || "").trim()}::${identityKey}`;
  const sourceOcrJobIds = new Set();

  try {
    if (!state.projectCache[pid]) state.projectCache[pid] = {};
    if (!state.projectCache[pid].landowners) {
      state.projectCache[pid].landowners = await api(`/projects/${pid}/landowners`);
    }

    for (const owner of state.projectCache[pid].landowners) {
      for (const lr of owner.land_records || []) {
        landRecordIdByParcelOwner.set(parcelOwnerKey(lr.parcel_number, ownerIdentityKey(owner)), lr.id);
      }
    }

    for (const p of d.parcels) {
      for (const owner of p.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache);
        // 前次移轉現值或原規定地價 is per-owner (see declared_value_per_sqm on the owner,
        // not the parcel - co-owners of the same parcel often acquired their share at
        // different times/prices). Multiply by this owner's own owned area (same
        // total_area_sqm × numerator/denominator formula the DB itself uses for
        // owned_area_sqm) to get their own original-value total for the 土增稅 estimate
        // (see land_value_tax.js).
        const numerator = owner.ownership_numerator || 1;
        const denominator = owner.ownership_denominator || 1;
        const ownedAreaSqm = ((Number(p.area_sqm) || 0) * numerator) / denominator;
        const declaredValuePerSqm = Number(owner.declared_value_per_sqm) || 0;
        const created = await api(`/projects/${pid}/landowners/${landownerId}/land-records`, {
          method: "POST",
          body: {
            parcel_number: p.parcel_number,
            township: p.township || null,
            section: p.section || null,
            subsection: p.subsection || null,
            registration_order: owner.registration_order || null,
            total_area_sqm: Number(p.area_sqm) || 0,
            ownership_numerator: numerator,
            ownership_denominator: denominator,
            source_ocr_job_id: p._sourceOcrJobId || null,
            ltt_original_value: declaredValuePerSqm ? Math.round(declaredValuePerSqm * ownedAreaSqm) : null,
            ltt_original_value_period: owner.declared_value_period || null,
          },
        });
        if (p._sourceOcrJobId) sourceOcrJobIds.add(p._sourceOcrJobId);
        landRecordIdByParcelOwner.set(parcelOwnerKey(p.parcel_number, ownerIdentityKey(owner)), created.id);
      }
      for (const enc of p.encumbrances || []) {
        if (!enc.right_type && !enc.right_holder) continue;
        await api(`/projects/${pid}/encumbrances`, { method: "POST", body: enc });
      }
    }

    for (const enc of d.encumbrances) {
      if (!enc.right_type && !enc.right_holder) continue;
      await api(`/projects/${pid}/encumbrances`, { method: "POST", body: enc });
    }

    for (const b of d.buildings) {
      const floorAreaSqm = Number(b.total_area_sqm) || Number(b.floor_area_sqm) || 0;
      for (const owner of b.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache);
        await api(`/projects/${pid}/landowners/${landownerId}/building-records`, {
          method: "POST",
          body: {
            land_record_id: landRecordIdByParcelOwner.get(parcelOwnerKey(b.parcel_number, ownerIdentityKey(owner))) || null,
            building_number: b.building_number || null,
            address: b.building_address || null,
            floor: b.floor || null,
            total_floors: b.total_floors || null,
            registration_order: owner.registration_order || null,
            structure_area_sqm: floorAreaSqm,
            auxiliary_area_sqm: 0,
            common_area_sqm: 0,
            ownership_numerator: owner.ownership_numerator || 1,
            ownership_denominator: owner.ownership_denominator || 1,
            source_ocr_job_id: b._sourceOcrJobId || null,
          },
        });
        if (b._sourceOcrJobId) sourceOcrJobIds.add(b._sourceOcrJobId);
      }
    }

    const hadParcels = d.parcels.length > 0;
    closeModal();
    toast("謄本資料已匯入", "success");
    titleDeedWizard = null;
    await renderTab(state.activeTab);
    if (sourceOcrJobIds.size === 1) {
      await goToOcrBatch([...sourceOcrJobIds][0]);
      return;
    }
    if (hadParcels) offerBuildingImportFollowUp();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "建立";
  }
}

function offerBuildingImportFollowUp() {
  openModal(
    "匯入建物謄本",
    `
    <p style="margin-top:0">地號資料已匯入完成。要不要現在就上傳這個案件的建物謄本？建物的「地號」欄位會自動比對剛剛匯入的地號資料。</p>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">稍後再說</button>
      <button type="button" class="btn-primary" id="start-building-import-btn">立即匯入建物謄本</button>
    </div>`,
    { width: "480px" }
  );
  document.getElementById("start-building-import-btn").addEventListener("click", async () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "buildings"));
    state.activeTab = "buildings";
    await renderTab("buildings");
    openBuildingTitleDeedWizard();
  });
}

let currentOcrBatch = null;
let activeBatchTab = "overview";

async function goToOcrBatch(jobId) {
  setActiveSidebarCase(state.currentProjectId);
  showView("view-ocr-batch");
  document.getElementById("batch-name").textContent = "載入中...";
  document.getElementById("batch-sub").textContent = "";
  document.getElementById("batch-status-badge").innerHTML = "";
  document.getElementById("batch-pipeline").innerHTML = "";
  document.getElementById("batch-tab-content").innerHTML = "";

  try {
    currentOcrBatch = await api(`/projects/${state.currentProjectId}/ocr-jobs/${jobId}`);
  } catch (err) {
    goToDashboard();
    return;
  }

  const project = state.currentProject;
  document.getElementById("batch-name").textContent = `${project ? project.name + " · " : ""}謄本匯入批次 #${jobId}`;
  document.getElementById("batch-sub").textContent = `建立於 ${fmtDateTime(currentOcrBatch.job.created_at)}`;
  renderBatchStatusBadge();
  renderBatchPipeline();

  activeBatchTab = "overview";
  document.querySelectorAll("#view-ocr-batch .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.batchTab === activeBatchTab);
    btn.onclick = () => {
      activeBatchTab = btn.dataset.batchTab;
      document.querySelectorAll("#view-ocr-batch .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderBatchTab();
    };
  });
  renderBatchTab();
}

function renderBatchStatusBadge() {
  const { status } = currentOcrBatch.job;
  const cls = status === "completed" ? "status-active" : status === "failed" ? "status-suspended" : "status-closed";
  document.getElementById("batch-status-badge").innerHTML =
    `<span class="status-badge ${cls}">${OCR_JOB_STATUS_LABEL[status] || status}</span>`;
}

function renderBatchPipeline() {
  const { job, extracted_data, land_records, building_records, documents } = currentOcrBatch;
  const hasExtraction = !!extracted_data;
  const hasLinkedRecords = land_records.length > 0 || building_records.length > 0;
  const steps = [
    {
      label: "上傳原始謄本",
      sub: `${documents.length} 個檔案/頁面`,
      state: documents.length ? "done" : "active",
    },
    {
      label: "OCR 辨識",
      sub: job.status === "failed" ? job.error_message || "辨識失敗" : hasExtraction ? "已完成擷取" : "辨識中",
      state: job.status === "failed" ? "failed" : hasExtraction ? "done" : "active",
    },
    {
      label: "地號 / 建號抽取",
      sub: hasExtraction
        ? `候選 ${(extracted_data.land_parcels || []).length} 筆地號、${(extracted_data.buildings || []).length} 筆建號`
        : "尚未擷取",
      state: hasExtraction ? "done" : job.status === "failed" ? "failed" : "",
    },
    {
      label: "人工核對",
      sub: hasLinkedRecords ? "已核對並建立資料" : hasExtraction ? "待逐筆核對(於匯入精靈中勾選「已核對」)" : "尚未開始",
      state: hasLinkedRecords ? "done" : hasExtraction ? "active" : "",
    },
    {
      label: "建立地號 ↔ 建號關聯",
      sub: hasLinkedRecords
        ? `已建立 ${land_records.length} 筆地號、${building_records.length} 筆建號`
        : "完成核對後自動寫入資料庫",
      state: hasLinkedRecords ? "done" : "",
    },
  ];
  document.getElementById("batch-pipeline").innerHTML = steps
    .map((s, i) => {
      const icon = s.state === "done" ? "✓" : s.state === "failed" ? "✕" : i + 1;
      return `
        <div class="batch-step ${s.state}">
          <div class="dot">${icon}</div>
          <div>
            <div class="batch-step-label">${escapeHtml(s.label)}</div>
            <div class="batch-step-sub">${escapeHtml(s.sub)}</div>
          </div>
        </div>`;
    })
    .join("");
}

function renderBatchTab() {
  const el = document.getElementById("batch-tab-content");
  if (!el) return;
  const renderers = {
    overview: renderBatchOverviewTab,
    parcels: renderBatchParcelsTab,
    buildings: renderBatchBuildingsTab,
    ocrai: renderBatchOcrAiTab,
    documents: renderBatchDocumentsTab,
    timeline: renderBatchTimelineTab,
  };
  el.innerHTML = (renderers[activeBatchTab] || renderBatchOverviewTab)();
  el.querySelectorAll("[data-batch-doc-index]").forEach((row) => {
    row.addEventListener("click", () => {
      const doc = currentOcrBatch.documents[Number(row.dataset.batchDocIndex)];
      downloadDocument(doc.document.id, doc.document.file_name);
    });
  });
}

function renderBatchOverviewTab() {
  const { job, documents, extracted_data, land_records, building_records } = currentOcrBatch;
  return `
    <div class="card">
      <div class="batch-kv"><label>批次編號</label><span>#${job.id}</span></div>
      <div class="batch-kv"><label>狀態</label><span>${OCR_JOB_STATUS_LABEL[job.status] || job.status}</span></div>
      <div class="batch-kv"><label>來源檔案數</label><span>${documents.length}</span></div>
      <div class="batch-kv"><label>地號候選</label><span>${(extracted_data?.land_parcels || []).length} 筆(已建立 ${land_records.length} 筆)</span></div>
      <div class="batch-kv"><label>建號候選</label><span>${(extracted_data?.buildings || []).length} 筆(已建立 ${building_records.length} 筆)</span></div>
      <div class="batch-kv"><label>建立時間</label><span>${fmtDateTime(job.created_at)}</span></div>
      <div class="batch-kv"><label>開始時間</label><span>${job.started_at ? fmtDateTime(job.started_at) : "-"}</span></div>
      <div class="batch-kv"><label>完成時間</label><span>${job.completed_at ? fmtDateTime(job.completed_at) : "-"}</span></div>
      ${job.error_message ? `<div class="batch-kv"><label>訊息</label><span style="color:var(--danger)">${escapeHtml(job.error_message)}</span></div>` : ""}
    </div>`;
}

function renderBatchParcelsTab() {
  const { land_records } = currentOcrBatch;
  if (!land_records.length) return `<div class="empty-state">這個批次還沒有已建立的地號資料</div>`;
  return `
    <div class="table-wrap"><table><thead><tr>
      <th>地號</th><th>地段/小段</th><th>面積(㎡)</th><th>持分</th><th>持分面積(㎡)</th>
    </tr></thead><tbody>
      ${land_records
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.parcel_number)}</td>
          <td>${escapeHtml([r.township, r.section, r.subsection].filter(Boolean).join(""))}</td>
          <td>${r.total_area_sqm}</td>
          <td>${r.ownership_numerator}/${r.ownership_denominator}</td>
          <td>${r.owned_area_sqm ?? "-"}</td>
        </tr>`
      )
      .join("")}
    </tbody></table></div>`;
}

function renderBatchBuildingsTab() {
  const { building_records } = currentOcrBatch;
  if (!building_records.length) return `<div class="empty-state">這個批次還沒有已建立的建號資料</div>`;
  return `
    <div class="table-wrap"><table><thead><tr>
      <th>建號</th><th>門牌</th><th>層次</th><th>總面積(㎡)</th><th>持分</th>
    </tr></thead><tbody>
      ${building_records
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.building_number) || "-"}</td>
          <td>${escapeHtml(r.address) || "-"}</td>
          <td>${escapeHtml(r.floor) || "-"}</td>
          <td>${r.total_area_sqm}</td>
          <td>${r.ownership_numerator}/${r.ownership_denominator}</td>
        </tr>`
      )
      .join("")}
    </tbody></table></div>`;
}

function renderBatchOcrAiTab() {
  const { extracted_data } = currentOcrBatch;
  if (!extracted_data) return `<div class="empty-state">尚無 OCR 擷取結果</div>`;
  return `
    <div class="helper-text" style="margin-bottom:10px">以下為這次 OCR 擷取的原始結果(送出匯入精靈前的候選資料,非最終已建立的資料)</div>
    <pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;overflow-x:auto;font-size:12px;line-height:1.6">${escapeHtml(JSON.stringify(extracted_data, null, 2))}</pre>`;
}

function renderBatchDocumentsTab() {
  const { documents } = currentOcrBatch;
  if (!documents.length) return `<div class="empty-state">這個批次沒有來源檔案</div>`;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      ${documents
      .map(
        (jd, i) => `
        <div class="record-row" data-batch-doc-index="${i}" style="padding:8px;text-align:center;cursor:pointer">
          ${(jd.document.mime_type || "").startsWith("image/")
            ? `<div style="height:110px;overflow:hidden;border-radius:4px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surface-2)">
                  <span style="font-size:24px">📄</span>
                </div>`
            : `<div style="height:110px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);border-radius:4px;border:1px solid var(--border)"><span style="font-size:24px">📄</span></div>`
          }
          <div class="helper-text" style="margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(jd.document.file_name)}">${escapeHtml(jd.document.file_name)}</div>
        </div>`
      )
      .join("")}
    </div>`;
}

function renderBatchTimelineTab() {
  const { job, documents } = currentOcrBatch;
  const events = [];
  if (job.created_at) events.push({ at: job.created_at, text: `建立匯入批次,含 ${documents.length} 個來源檔案` });
  if (job.started_at) events.push({ at: job.started_at, text: "開始 OCR 辨識" });
  if (job.completed_at) {
    events.push({
      at: job.completed_at,
      text: job.status === "failed" ? `辨識失敗:${job.error_message || ""}` : "OCR 辨識完成",
    });
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!events.length) return `<div class="empty-state">尚無紀錄</div>`;
  return `
    <div class="card">
      ${events
      .map(
        (e) => `
        <div class="batch-kv"><label>${fmtDateTime(e.at)}</label><span>${escapeHtml(e.text)}</span></div>`
      )
      .join("")}
    </div>`;
}

function initOcrWizard() {
  const backBtn = document.getElementById("back-to-project-from-batch");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (state.currentProjectId) openProject(state.currentProjectId);
      else goToDashboard();
    });
  }
}
