"use strict";

const PING_PER_SQM = 0.3025;
let titleDeedWizard = null;

// 上一輪 wizard 開的原始檔案預覽用的 blob URL,開新一輪之前先釋放,不然每次重開
// 精靈都累積一批物件網址,瀏覽器分頁開久了會慢慢吃記憶體。
function revokeWizardFileUrls() {
  if (titleDeedWizard && titleDeedWizard.fileUrls) {
    titleDeedWizard.fileUrls.forEach((u) => {
      try { URL.revokeObjectURL(u); } catch (e) { }
    });
  }
}

function openTitleDeedWizard() {
  revokeWizardFileUrls();
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "land", lockRecordType: true, viewerActiveIndex: 0 };
  renderWizardStep0();
}

function openBuildingTitleDeedWizard() {
  revokeWizardFileUrls();
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "building", lockRecordType: true, viewerActiveIndex: 0 };
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
      // 謄本上這個欄位常有好幾筆歷史記錄(每次移轉都會多一筆);上面兩個欄位只放
      // 系統挑出的最新一筆(供土增稅估算用),這裡把全部原始記錄留著給審核畫面顯示。
      transfer_history: Array.isArray(o.transfer_history) ? o.transfer_history : [],
      // 「相關他項權利登記次序」- kept as a comma string; drives whether the roster
      // export fills this owner's 土地他項權利部 columns (empty => leave blank).
      related_encumbrance_orders: Array.isArray(o.related_encumbrance_orders)
        ? o.related_encumbrance_orders.join(", ")
        : (o.related_encumbrance_orders || ""),
      _pooled: !!(o.is_pooled || o._pooled),
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
      related_encumbrance_orders: Array.isArray(o.related_encumbrance_orders)
        ? o.related_encumbrance_orders.join(", ")
        : (o.related_encumbrance_orders || ""),
      _pooled: !!(o.is_pooled || o._pooled),
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
      secured_amount: parseSecuredAmount(e.secured_amount),
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
    source_page: p.source_page || null,
  }));

  const buildings = (raw.buildings || []).map((b) => ({
    building_number: b.building_number || "",
    building_address: b.building_address || "",
    parcel_number: b.parcel_number || "",
    total_floors: b.total_floors || "",
    floor: b.floor || "",
    total_area_sqm: b.total_area_sqm ?? "",
    floor_area_sqm: b.floor_area_sqm ?? "",
    floors: (b.floors && b.floors.length
      ? b.floors
      : (b.floor || (b.floor_area_sqm ?? "") !== "" ? [{ floor: b.floor, area_sqm: b.floor_area_sqm }] : [])
    ).map((f) => ({ floor: (f && f.floor) || "", area_sqm: f && f.area_sqm != null ? f.area_sqm : "" })),
    accessory_use: b.accessory_use || "",
    accessory_area_sqm: b.accessory_area_sqm ?? "",
    accessories: (b.accessories && b.accessories.length
      ? b.accessories
      : (b.accessory_use || (b.accessory_area_sqm ?? "") !== "" ? [{ use: b.accessory_use, area_sqm: b.accessory_area_sqm }] : [])
    ).map((a) => ({ use: (a && a.use) || "", area_sqm: a && a.area_sqm != null ? a.area_sqm : "" })),
    owners: (b.owners || []).map(toBuildingOwnerRow),
    encumbrances: (b.encumbrances || []).map(toEncumbranceRow),
    main_use: b.main_use || "",
    common_part_of: (b.common_part_of || [])
      .filter((c) => c && c.main_building_number)
      .map((c) => ({
        main_building_number: c.main_building_number || "",
        numerator: Number(c.numerator) || 0,
        denominator: Number(c.denominator) || 0,
      })),
    source_page: b.source_page || null,
  }));

  const encumbrances = (raw.encumbrances || []).map(toEncumbranceRow);
  return {
    deed_category: deedCategory,
    parcels,
    buildings,
    encumbrances,
    // 每份上傳檔案展開後各佔幾頁,跟 titleDeedWizard.files 同順序 - 換算 source_page
    // (整批攤平後的全域頁碼)回「第幾份檔案第幾頁」用,見 wizardResolveSourcePage。
    file_page_counts: Array.isArray(raw.file_page_counts) ? raw.file_page_counts : null,
  };
}

/* ================= 左側原始謄本預覽(審核步驟用,見 wizardSplitBodyHtml) =================
   顯示原始檔案供手動切換/捲動對照,審核每一筆地號/建號時還會依後端記錄的 source_page
   自動跳到/切到該筆對應的檔案與頁碼(wizardResolveSourcePage) - 純電子謄本規則解析、
   AI辨識兩條後端路徑都會回傳 source_page,對每份上傳檔案都適用。 */
function wizardFileUrls() {
  const files = titleDeedWizard.files || [];
  if (!titleDeedWizard.fileUrls || titleDeedWizard.fileUrls.length !== files.length) {
    revokeWizardFileUrls();
    titleDeedWizard.fileUrls = files.map((f) => URL.createObjectURL(f));
  }
  return titleDeedWizard.fileUrls;
}

// 把「整批攤平後的全域頁碼」(後端 source_page,見 utils/ocr.py 的 _backfill_source_pages)
// 換算成「第幾份上傳檔案的第幾頁」- 靠 file_page_counts(每份檔案展開後佔幾頁,跟
// titleDeedWizard.files 同一個順序)逐份累加找出落在哪一份檔案裡。
function wizardResolveSourcePage(globalPage) {
  const counts = (titleDeedWizard.data && titleDeedWizard.data.file_page_counts) || null;
  if (!globalPage || !counts || !counts.length) return null;
  let remaining = globalPage;
  for (let i = 0; i < counts.length; i++) {
    if (remaining <= counts[i]) return { fileIndex: i, localPage: remaining };
    remaining -= counts[i];
  }
  return null; // 頁碼超出檔案總頁數範圍,理論上不會發生,防呆用
}

// 瀏覽器內建 PDF 外掛(單純 <iframe src="blob:...">)在不同瀏覽器/版本下常常只顯示
// 第一頁、內建的縮放按鈕也不一定有反應 - 改用 pdf.js 自己畫。目前這份檔案的所有頁面
// 直向堆疊畫成一串 canvas,放進可捲動的容器裡,捲軸就能看到完整內容;頁碼輸入框/
// 上一頁/下一頁/搜尋都是「捲動到那一頁」,縮放則是整批用新的解析度重畫。

function wizardTotalPages() {
  const counts = (titleDeedWizard.data && titleDeedWizard.data.file_page_counts) || null;
  if (counts && counts.length) return counts.reduce((s, n) => s + n, 0) || 1;
  return (titleDeedWizard.files || []).length || 1;
}

// file_page_counts 缺失時(理論上不會,防呆)退回「就是第1份檔案第N頁」。
function wizardGlobalToFileLocalSafe(globalPage) {
  return wizardResolveSourcePage(globalPage) || { fileIndex: 0, localPage: globalPage || 1 };
}

function wizardLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function wizardGetPdfDoc(fileIndex) {
  titleDeedWizard._pdfDocCache = titleDeedWizard._pdfDocCache || {};
  if (titleDeedWizard._pdfDocCache[fileIndex]) return titleDeedWizard._pdfDocCache[fileIndex];
  const file = titleDeedWizard.files[fileIndex];
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  titleDeedWizard._pdfDocCache[fileIndex] = doc;
  return doc;
}

function wizardViewerToolbarHtml() {
  const zoomPct = Math.round((titleDeedWizard.viewerZoom || 1) * 100);
  const totalPages = wizardTotalPages();
  const page = titleDeedWizard.viewerGlobalPage || 1;
  return `
    <div class="wizard-viewer-toolbar">
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-search-btn" title="在這份檔案內搜尋文字">🔍</button>
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-prev-page" title="上一頁" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span class="wizard-viewer-page-input-wrap">
        <input type="number" id="wizard-viewer-page-input" value="${page}" min="1" max="${totalPages}">
        / ${totalPages}
      </span>
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-next-page" title="下一頁" ${page >= totalPages ? "disabled" : ""}>›</button>
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-zoom-out" title="縮小">－</button>
      <span class="helper-text" style="min-width:38px;text-align:center">${zoomPct}%</span>
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-zoom-in" title="放大">＋</button>
      <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-rotate" title="旋轉">⟳</button>
    </div>`;
}

function wizardViewerPaneHtml() {
  const files = titleDeedWizard.files || [];
  if (!files.length) {
    return `<div class="wizard-viewer-pane"><div class="wizard-viewer-body"><span class="helper-text">沒有原始檔案可預覽</span></div></div>`;
  }
  if (titleDeedWizard.viewerTargetPage) titleDeedWizard.viewerGlobalPage = titleDeedWizard.viewerTargetPage;
  titleDeedWizard.viewerGlobalPage = Math.min(Math.max(1, titleDeedWizard.viewerGlobalPage || 1), wizardTotalPages());
  const widthPct = titleDeedWizard.viewerPaneWidthPct || 52;
  return `
    <div class="wizard-viewer-pane" style="flex:0 0 ${widthPct}%">
      <div class="wizard-window-titlebar">📄 謄本預覽</div>
      ${wizardViewerToolbarHtml()}
      <div class="wizard-viewer-canvas-wrap" id="wizard-viewer-canvas-wrap">
        <div class="wizard-viewer-pages" id="wizard-viewer-pages"><span class="helper-text">載入中…</span></div>
      </div>
    </div>`;
}

// 使用者用滑鼠捲軸自己捲到哪一頁,titleDeedWizard.viewerGlobalPage 不會跟著更新(那個
// 欄位只有靠頁碼輸入框/上一頁/下一頁/搜尋等「主動跳頁」動作才會變)。縮放/旋轉只是要
// 重畫,不是要跳頁,所以要先問「使用者現在实际看著第幾頁」,重畫完再捲回同一頁,
// 不然點縮放畫面會跳回上次「主動跳頁」跳到的那一頁,而不是目前正在看的頁。
function wizardCurrentVisiblePage() {
  const wrap = document.getElementById("wizard-viewer-canvas-wrap");
  if (!wrap) return titleDeedWizard.viewerGlobalPage || 1;
  const canvases = [...wrap.querySelectorAll(".wizard-viewer-page-canvas")];
  if (!canvases.length) return titleDeedWizard.viewerGlobalPage || 1;
  const wrapTop = wrap.getBoundingClientRect().top;
  for (const c of canvases) {
    if (c.getBoundingClientRect().bottom > wrapTop + 4) return Number(c.dataset.globalPage);
  }
  return Number(canvases[canvases.length - 1].dataset.globalPage);
}

// 目前這份檔案(依全域頁碼換算出來的 fileIndex)所有頁面都畫出來、直向堆疊,不是只
// 畫使用者目前那一頁 - 這樣捲軸才捲得到完整內容,不用靠翻頁按鈕一頁一頁點。scrollTo
// 沒給的話,重畫完會捲回原本正在看的那一頁(縮放/旋轉這種「重畫但不是要跳頁」的情境);
// 有給的話才是真的要跳到指定頁(頁碼輸入框/上一頁/下一頁/搜尋)。
async function wizardRenderCurrentPage(scrollTo) {
  const container = document.getElementById("wizard-viewer-pages");
  if (!container) return;
  const targetPage = scrollTo || wizardCurrentVisiblePage();
  const resolved = wizardGlobalToFileLocalSafe(titleDeedWizard.viewerGlobalPage || 1);
  const fileIndex = resolved.fileIndex;
  const file = (titleDeedWizard.files || [])[fileIndex];
  if (!file) return;
  const zoom = titleDeedWizard.viewerZoom || 1;
  const rotation = titleDeedWizard.viewerRotation || 0;
  const counts = (titleDeedWizard.data && titleDeedWizard.data.file_page_counts) || [];
  const before = counts.slice(0, fileIndex).reduce((s, c) => s + c, 0);

  try {
    container.innerHTML = "";
    if ((file.type || "").includes("pdf") && window.pdfjsLib) {
      const doc = await wizardGetPdfDoc(fileIndex);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: zoom * 1.4, rotation });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "wizard-viewer-page-canvas";
        canvas.dataset.globalPage = before + n;
        container.appendChild(canvas);
        const pageCtx = canvas.getContext("2d");
        await page.render({ canvasContext: pageCtx, viewport }).promise;
        wizardDrawSearchHighlights(pageCtx, viewport, before + n);
      }
    } else {
      const img = await wizardLoadImage(wizardFileUrls()[fileIndex]);
      const swapped = rotation % 180 !== 0;
      const w = img.width * zoom;
      const h = img.height * zoom;
      const canvas = document.createElement("canvas");
      canvas.width = swapped ? h : w;
      canvas.height = swapped ? w : h;
      canvas.className = "wizard-viewer-page-canvas";
      canvas.dataset.globalPage = before + 1;
      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      container.appendChild(canvas);
    }
    const target = container.querySelector(`canvas[data-global-page="${targetPage}"]`);
    if (target) target.scrollIntoView({ block: "start" });
  } catch (err) {
    container.innerHTML = `<span class="helper-text">PDF 預覽載入失敗</span>`;
  }
}

// 🔍 只在「目前這份檔案」內找,行為比照瀏覽器/PDF閱讀器內建的 Ctrl+F:輸入文字後每一
// 頁符合的文字都直接畫黃色網底標出來(不是只跳到第一個命中頁),上一個/下一個在命中的
// 頁面之間切換,Enter 找下一個、Shift+Enter 找上一個。
function wizardDrawSearchHighlights(ctx, viewport, globalPageNum) {
  const rects = (titleDeedWizard._searchMatchesByPage || {})[globalPageNum];
  if (!rects || !rects.length) return;
  ctx.save();
  // multiply 混合模式 = 真正的螢光筆效果(疊上去底下文字還看得見、顏色比單純半透明
  // 疊色更飽和鮮豔),不是灰灰的一層半透明黃。
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#ffee00";
  for (const rect of rects) {
    const vp = viewport.convertToViewportRectangle(rect);
    const x = Math.min(vp[0], vp[2]);
    const y = Math.min(vp[1], vp[3]);
    const w = Math.abs(vp[2] - vp[0]);
    const h = Math.abs(vp[3] - vp[1]);
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function wizardToggleSearchBar() {
  if (document.getElementById("wizard-viewer-search-bar")) {
    wizardCloseSearchBar();
    return;
  }
  const toolbar = document.querySelector(".wizard-viewer-toolbar");
  if (!toolbar) return;
  const bar = document.createElement("div");
  bar.className = "wizard-viewer-search-bar";
  bar.id = "wizard-viewer-search-bar";
  bar.innerHTML = `
    <input type="text" id="wizard-viewer-search-input" placeholder="搜尋這份檔案的文字…" autocomplete="off">
    <span class="helper-text" id="wizard-viewer-search-count"></span>
    <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-search-prev" title="上一個(Shift+Enter)">‹</button>
    <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-search-next" title="下一個(Enter)">›</button>
    <button type="button" class="btn-sm btn-secondary" id="wizard-viewer-search-close" title="關閉">✕</button>`;
  toolbar.insertAdjacentElement("afterend", bar);

  const input = bar.querySelector("#wizard-viewer-search-input");
  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const term = input.value.trim();
      if (term && term === titleDeedWizard._searchTerm) wizardSearchStep(e.shiftKey ? -1 : 1);
      else wizardRunSearch(term);
    } else if (e.key === "Escape") {
      wizardCloseSearchBar();
    }
  });
  document.getElementById("wizard-viewer-search-prev").addEventListener("click", () => wizardSearchStep(-1));
  document.getElementById("wizard-viewer-search-next").addEventListener("click", () => wizardSearchStep(1));
  document.getElementById("wizard-viewer-search-close").addEventListener("click", wizardCloseSearchBar);
}

function wizardCloseSearchBar() {
  document.getElementById("wizard-viewer-search-bar")?.remove();
  const hadHighlights = !!titleDeedWizard._searchTerm;
  titleDeedWizard._searchTerm = "";
  titleDeedWizard._searchMatchesByPage = {};
  titleDeedWizard._searchMatchPages = [];
  titleDeedWizard._searchIndex = -1;
  if (hadHighlights) wizardRenderCurrentPage();
}

async function wizardRunSearch(term) {
  term = (term || "").trim();
  const countEl = document.getElementById("wizard-viewer-search-count");
  if (!term) return;
  const resolved = wizardGlobalToFileLocalSafe(titleDeedWizard.viewerGlobalPage);
  const file = (titleDeedWizard.files || [])[resolved.fileIndex];
  if (!file || !(file.type || "").includes("pdf") || !window.pdfjsLib) {
    toast("目前這份檔案不支援文字搜尋", "error");
    return;
  }
  if (countEl) countEl.textContent = "搜尋中…";
  try {
    const doc = await wizardGetPdfDoc(resolved.fileIndex);
    const counts = (titleDeedWizard.data && titleDeedWizard.data.file_page_counts) || [];
    const before = counts.slice(0, resolved.fileIndex).reduce((s, c) => s + c, 0);
    const byPage = {};
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const textContent = await page.getTextContent();
      const rects = [];
      for (const item of textContent.items) {
        if (item.str && item.str.includes(term)) {
          const [, , , d, e, f] = item.transform;
          rects.push([e, f, e + item.width, f + (item.height || Math.abs(d) || 10)]);
        }
      }
      if (rects.length) byPage[before + n] = rects;
    }
    titleDeedWizard._searchTerm = term;
    titleDeedWizard._searchMatchesByPage = byPage;
    titleDeedWizard._searchMatchPages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
    titleDeedWizard._searchIndex = 0;
    if (!titleDeedWizard._searchMatchPages.length) {
      if (countEl) countEl.textContent = "0 頁";
      toast(`這份檔案裡找不到「${term}」`, "error");
      wizardRenderCurrentPage();
      return;
    }
    if (countEl) countEl.textContent = `第 1 / ${titleDeedWizard._searchMatchPages.length} 頁`;
    wizardGoToPage(titleDeedWizard._searchMatchPages[0]);
  } catch (err) {
    toast("搜尋失敗", "error");
  }
}

function wizardSearchStep(delta) {
  const pages = titleDeedWizard._searchMatchPages || [];
  if (!pages.length) return;
  titleDeedWizard._searchIndex = (titleDeedWizard._searchIndex + delta + pages.length) % pages.length;
  const countEl = document.getElementById("wizard-viewer-search-count");
  if (countEl) countEl.textContent = `第 ${titleDeedWizard._searchIndex + 1} / ${pages.length} 頁`;
  wizardGoToPage(pages[titleDeedWizard._searchIndex]);
}

// 換頁後頁碼輸入框、上一頁/下一頁按鈕的 disabled 狀態都要跟著更新,乾脆整個工具列
// 重繪比較不容易漏掉哪個地方沒同步。目標頁還在同一份檔案裡的話,所有頁面本來就已經
// 畫在畫面上了,直接捲過去就好,不用整批重畫;換到不同檔案才需要重新渲染。
function wizardGoToPage(n) {
  const newPage = Math.min(Math.max(1, n), wizardTotalPages());
  const prevResolved = wizardGlobalToFileLocalSafe(titleDeedWizard.viewerGlobalPage || 1);
  const newResolved = wizardGlobalToFileLocalSafe(newPage);
  titleDeedWizard.viewerGlobalPage = newPage;
  const toolbar = document.querySelector(".wizard-viewer-toolbar");
  if (toolbar) {
    toolbar.outerHTML = wizardViewerToolbarHtml();
    wireWizardViewerToolbar();
  }
  if (newResolved.fileIndex !== prevResolved.fileIndex) {
    wizardRenderCurrentPage(newPage);
  } else {
    const target = document.querySelector(`.wizard-viewer-page-canvas[data-global-page="${newPage}"]`);
    if (target) target.scrollIntoView({ block: "start" });
  }
}

function wireWizardViewerToolbar() {
  document.getElementById("wizard-viewer-zoom-in")?.addEventListener("click", () => {
    titleDeedWizard.viewerZoom = Math.min(3, (titleDeedWizard.viewerZoom || 1) + 0.2);
    wizardRenderCurrentPage();
    const label = document.querySelector(".wizard-viewer-toolbar .helper-text");
    if (label) label.textContent = `${Math.round(titleDeedWizard.viewerZoom * 100)}%`;
  });
  document.getElementById("wizard-viewer-zoom-out")?.addEventListener("click", () => {
    titleDeedWizard.viewerZoom = Math.max(0.4, (titleDeedWizard.viewerZoom || 1) - 0.2);
    wizardRenderCurrentPage();
    const label = document.querySelector(".wizard-viewer-toolbar .helper-text");
    if (label) label.textContent = `${Math.round(titleDeedWizard.viewerZoom * 100)}%`;
  });
  document.getElementById("wizard-viewer-rotate")?.addEventListener("click", () => {
    titleDeedWizard.viewerRotation = ((titleDeedWizard.viewerRotation || 0) + 90) % 360;
    wizardRenderCurrentPage();
  });
  document.getElementById("wizard-viewer-prev-page")?.addEventListener("click", () => {
    wizardGoToPage((titleDeedWizard.viewerGlobalPage || 1) - 1);
  });
  document.getElementById("wizard-viewer-next-page")?.addEventListener("click", () => {
    wizardGoToPage((titleDeedWizard.viewerGlobalPage || 1) + 1);
  });
  document.getElementById("wizard-viewer-search-btn")?.addEventListener("click", wizardToggleSearchBar);
  const pageInput = document.getElementById("wizard-viewer-page-input");
  if (pageInput) {
    pageInput.addEventListener("change", () => wizardGoToPage(Math.round(Number(pageInput.value)) || 1));
  }
}

function wireWizardViewerPane() {
  const root = document.getElementById("modal-root");
  if (!root) return;
  wireWizardViewerToolbar();
  wireWizardSplitResize();
  wizardRenderCurrentPage();
}

// 把審核步驟原本的內容(表單+按鈕)包成右欄,左欄固定放原始檔案預覽 - 審核跟看原圖
// 可以同時進行,不用切來切去。呼叫端要記得在 openModal(...) 之後接著呼叫
// wireWizardViewerPane(),不然切換原始檔案的按鈕不會有作用。
function wizardSplitBodyHtml(rightHtml) {
  return `<div class="wizard-split" id="wizard-split">${wizardViewerPaneHtml()}<div class="wizard-split-handle" id="wizard-split-handle" title="拖曳調整左右寬度"></div><div class="wizard-form-pane-card"><div class="wizard-window-titlebar">📝 資料編輯</div><div class="wizard-form-pane">${rightHtml}</div></div></div>`;
}

// 審核精靈每一步(6個 render*SubStep)都呼叫這支取代直接呼叫 openModal - 同一筆地號/
// 建號的 3 個子步驟(標示部/所有權部/他項權利部)目標頁碼是同一個,以前每次「下一步」
// 都整個 modal 重建,連原圖那欄的 iframe 也跟著砍掉重載,畫面上看起來像「每次都重新
// 跳頁一次」,而且失去使用者原本手動捲動/縮放的位置。現在只有目標頁碼真的變了(換到
// 下一筆地號/建號)才重建原圖欄,同一筆的子步驟之間只換右邊表單,原圖完全不動。
// 每筆地號/建號的核心欄位跟每位所有權人姓名/戶籍地址做「有沒有填」檢查,供頂部「辨識
// 結果/未辨識項目」分頁計數跟未辨識清單用。統一編號故意不檢查 - 二類謄本本來就遮罩成
// 「A123*****6」,不是缺資料。
function wizardGroupList() {
  const d = titleDeedWizard.data || {};
  const groups = [];
  (d.parcels || []).forEach((p, i) => groups.push({ type: "parcel", index: i, record: p }));
  (d.buildings || []).forEach((b, i) => groups.push({ type: "building", index: i, record: b }));
  return groups;
}

function wizardComputeFieldChecks() {
  const items = [];
  const push = (ok, label, groupType, groupIndex) => items.push({ ok: !!ok, label, groupType, groupIndex });
  wizardGroupList().forEach((g) => {
    if (g.type === "parcel") {
      const p = g.record;
      const tag = p.parcel_number || `第${g.index + 1}筆`;
      push(!!p.township, `地號${tag}・鄉鎮市區`, "parcel", g.index);
      push(!!p.section, `地號${tag}・地段`, "parcel", g.index);
      push(!!p.parcel_number, `地號${tag}・地號`, "parcel", g.index);
      push(Number(p.area_sqm) > 0, `地號${tag}・土地面積`, "parcel", g.index);
      (p.owners || []).forEach((o, oi) => {
        push(!!o.owner_name, `地號${tag}・所有權人#${oi + 1}姓名`, "parcel", g.index);
        push(!!o.address, `地號${tag}・所有權人#${oi + 1}戶籍地址`, "parcel", g.index);
      });
    } else {
      const b = g.record;
      const tag = b.building_number || `第${g.index + 1}筆`;
      push(!!b.building_number, `建號${tag}・建號`, "building", g.index);
      push(!!b.building_address, `建號${tag}・建物門牌`, "building", g.index);
      const totalArea = (Number(b.total_area_sqm) || 0) + (b.accessories || []).reduce((s, a) => s + (Number(a.area_sqm) || 0), 0);
      push(totalArea > 0 || Number(b.floor_area_sqm) > 0, `建號${tag}・建物總面積`, "building", g.index);
      (b.owners || []).forEach((o, oi) => {
        push(!!o.owner_name, `建號${tag}・所有權人#${oi + 1}姓名`, "building", g.index);
        push(!!o.address, `建號${tag}・所有權人#${oi + 1}戶籍地址`, "building", g.index);
      });
    }
  });
  return items;
}

function wizardIssuesTabHtml() {
  const issues = wizardComputeFieldChecks().filter((x) => !x.ok);
  if (!issues.length) return `<div class="empty-state">沒有偵測到明顯的空白欄位 🎉</div>`;
  return `<div class="wizard-ov-issue-list">${issues
    .map(
      (it) =>
        `<button type="button" class="wizard-ov-issue-item" data-jump-group-type="${it.groupType}" data-jump-group-index="${it.groupIndex}">
          <span class="wizard-ov-issue-icon">⚠</span> ${escapeHtml(it.label)}
        </button>`
    )
    .join("")}</div>`;
}

function wizardSettingsTabHtml() {
  const d = titleDeedWizard.data || {};
  return `
    <div class="field"><label>謄本類別</label><div class="helper-text">${escapeHtml(d.deed_category) || "未偵測到"}</div></div>
    <div class="field"><label>本次匯入類型</label><div class="helper-text">${escapeHtml(WIZARD_RECORD_TYPE_LABEL[titleDeedWizard.recordType] || titleDeedWizard.recordType)}</div></div>
    <div class="field"><label>上傳檔案(共 ${(titleDeedWizard.files || []).length} 份,${wizardTotalPages()} 頁)</label>
      <div class="helper-text">${(titleDeedWizard.files || []).map((f) => escapeHtml(f.name)).join("、") || "-"}</div>
    </div>`;
}

function wizardStepTabWrapperHtml(resultsHtml) {
  const tab = titleDeedWizard.stepTab || "results";
  const checks = wizardComputeFieldChecks();
  const okCount = checks.filter((x) => x.ok).length;
  const issueCount = checks.length - okCount;
  const content = tab === "issues" ? wizardIssuesTabHtml() : tab === "settings" ? wizardSettingsTabHtml() : resultsHtml;
  return `
    <div class="wizard-step-tabs">
      <button type="button" class="wizard-step-tab-btn ${tab === "results" ? "active" : ""}" data-step-tab="results">辨識結果 <span class="wizard-ov-tab-count">${okCount}</span></button>
      <button type="button" class="wizard-step-tab-btn ${tab === "issues" ? "active" : ""}" data-step-tab="issues">未辨識項目 <span class="wizard-ov-tab-count warn">${issueCount}</span></button>
      <button type="button" class="wizard-step-tab-btn ${tab === "settings" ? "active" : ""}" data-step-tab="settings">匯入設定</button>
    </div>
    <div id="wizard-step-tab-content">${content}</div>`;
}

function wireWizardStepTabs() {
  document.querySelectorAll(".wizard-step-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.stepTab;
      if (tab === "results") {
        // 回到辨識結果=重新呼叫目前這一步的 render 函式,乾淨地重建欄位跟事件綁定
        // (跟切換上一步/下一步是同一條路徑,目標頁碼沒變不會重載原圖)。
        titleDeedWizard.stepTab = "results";
        if (titleDeedWizard._rerenderCurrentSubstep) titleDeedWizard._rerenderCurrentSubstep();
        return;
      }
      titleDeedWizard.stepTab = tab;
      const content = document.getElementById("wizard-step-tab-content");
      if (content) content.innerHTML = tab === "issues" ? wizardIssuesTabHtml() : wizardSettingsTabHtml();
      document.querySelectorAll(".wizard-step-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.stepTab === tab));
      if (tab === "issues") wireWizardStepIssueItems();
    });
  });
}

function wireWizardStepIssueItems() {
  document.querySelectorAll(".wizard-ov-issue-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.jumpGroupType;
      const index = Number(btn.dataset.jumpGroupIndex);
      titleDeedWizard.stepTab = "results";
      if (type === "parcel") {
        titleDeedWizard.activeType = "parcel";
        titleDeedWizard.activeIndex = index;
        titleDeedWizard.parcelSubStep = 0;
        titleDeedWizard.step = 2;
      } else {
        titleDeedWizard.activeType = "building";
        titleDeedWizard.activeIndex = index;
        titleDeedWizard.buildingSubStep = 0;
        titleDeedWizard.step = 3;
      }
      renderWizardStep();
    });
  });
}

function renderWizardSplitStep(rightHtml, sourcePage) {
  // 每次進到一個子步驟(不管是「下一步/上一步」導覽,還是從「未辨識項目」點過來)都
  // 先重置回辨識結果分頁 - 不然使用者上一步還停在「未辨識項目」,換了地號/建號之後
  // 畫面卻還顯示舊的分頁內容,對不上目前在編輯哪一筆。
  titleDeedWizard.stepTab = "results";
  const targetPage = sourcePage || null;
  const fileCount = (titleDeedWizard.files || []).length;
  const root = document.getElementById("modal-root");
  const existingSplit = root && root.querySelector("#wizard-split");
  const wrappedHtml = wizardStepTabWrapperHtml(rightHtml);

  if (existingSplit) {
    // 精靈的 modal 已經開著了 - 只換右邊表單內容,不要重叫 openModal 整個重建
    // .modal-dialog(那樣會重跑一次淡入動畫,換一筆地號/建號就變成像整頁跳轉一樣)。
    const formPane = existingSplit.querySelector(".wizard-form-pane");
    if (formPane) formPane.innerHTML = wrappedHtml;
    wireWizardStepTabs();
    const pageChanged =
      titleDeedWizard._lastViewerTargetPage !== targetPage || titleDeedWizard._lastViewerFileCount !== fileCount;
    if (pageChanged && targetPage) {
      wizardGoToPage(targetPage);
    }
    titleDeedWizard.viewerTargetPage = targetPage;
    titleDeedWizard._lastViewerTargetPage = targetPage;
    titleDeedWizard._lastViewerFileCount = fileCount;
    return;
  }

  titleDeedWizard.viewerTargetPage = targetPage;
  openModal("掃描謄本匯入", wizardSplitBodyHtml(wrappedHtml), { width: "min(1680px, 98vw)" });
  wireWizardViewerPane();
  wireWizardStepTabs();
  titleDeedWizard._lastViewerTargetPage = targetPage;
  titleDeedWizard._lastViewerFileCount = fileCount;
}

// 左右兩欄的寬度比例可以拖曳調整(原本固定44/56,原圖那欄常常太窄看不清楚)。比例存在
// titleDeedWizard 上,同一次匯入流程切換步驟/re-render 都會記住使用者調過的寬度。
function wireWizardSplitResize() {
  const root = document.getElementById("modal-root");
  const handle = root && root.querySelector("#wizard-split-handle");
  const splitEl = root && root.querySelector("#wizard-split");
  if (!handle || !splitEl) return;
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const onMove = (ev) => {
      const rect = splitEl.getBoundingClientRect();
      let pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.min(70, Math.max(28, pct));
      titleDeedWizard.viewerPaneWidthPct = pct;
      const pane = splitEl.querySelector(".wizard-viewer-pane");
      if (pane) pane.style.flex = `0 0 ${pct}%`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function renderWizardStep() {
  const steps = {
    2: renderWizardStepParcelEditor,
    3: renderWizardStepBuildingEditor,
  };
  if (steps[titleDeedWizard.step]) {
    steps[titleDeedWizard.step]();
  }
}

function startWizardReview() {
  const d = titleDeedWizard.data;
  titleDeedWizard.parcelSubStep = 0;
  titleDeedWizard.buildingSubStep = 0;
  if (d.parcels.length) {
    titleDeedWizard.activeType = "parcel";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 2;
  } else if (d.buildings.length) {
    titleDeedWizard.activeType = "building";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 3;
  } else {
    toast("本次掃描未擷取到有效的土地地號或建物建號資料,請確認檔案類別與影像品質後重新上傳", "error");
    renderWizardStep0();
    return;
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
        <option value="第一類謄本">第一類謄本</option>
        <option value="第二類謄本">第二類謄本</option>
        <option value="第三類謄本">第三類謄本</option>
      </select>
      <div class="helper-text">請選擇這批謄本的類別,辨識即以此為準</div>
    </div>
    <div class="helper-text">若有多張照片或多檔案,請用 ▲▼ 調整順序,順序需與謄本頁面順序需一致</div>
    <div id="wizard-ocr-progress-wrap" style="display:none;margin-top:14px">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-ocr-progress-fill" style="width:0%"></div></div>
      <div class="helper-text" id="wizard-ocr-progress-label" style="margin-top:4px;text-align:center"></div>
    </div>
    <div class="modal-footer">
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
    // No "auto-detect" option any more - a concrete category must always be chosen.
    if (!titleDeedWizard.manualDeedCategory) titleDeedWizard.manualDeedCategory = "第二類謄本";
    deedCatStep0.value = titleDeedWizard.manualDeedCategory;
    titleDeedWizard.manualDeedCategory = deedCatStep0.value;
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
        <span class="wizard-file-name" data-file-idx="${i}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text" title="點兩下或按 ✏️ 重新命名">${i + 1}. ${escapeHtml(f.name)}</span>
        <button type="button" class="btn-secondary btn-sm" data-rename-file="${i}" title="重新命名">✏️</button>
        <button type="button" class="btn-secondary btn-sm" data-move-up="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="btn-secondary btn-sm" data-move-down="${i}" ${i === titleDeedWizard.files.length - 1 ? "disabled" : ""
        }>▼</button>
        <button type="button" class="btn-danger btn-sm" data-remove-file="${i}">移除</button>
      </div>`
    )
    .join("");

  // 檔名直接在畫面上變成輸入框改,不跳瀏覽器原生的 prompt() 對話框。
  const startInlineRename = (i) => {
    const span = wrap.querySelector(`.wizard-file-name[data-file-idx="${i}"]`);
    if (!span) return;
    const oldFile = titleDeedWizard.files[i];
    const dotIdx = oldFile.name.lastIndexOf(".");
    const ext = dotIdx > -1 ? oldFile.name.slice(dotIdx) : "";
    const baseName = dotIdx > -1 ? oldFile.name.slice(0, dotIdx) : oldFile.name;
    span.outerHTML = `
      <span style="flex:1;min-width:0;display:flex;align-items:center;gap:4px">
        <input type="text" class="wizard-file-rename-input" data-file-idx="${i}" value="${escapeHtml(baseName)}"
          style="flex:1;min-width:0;padding:3px 6px;font-size:13px">
        <span class="helper-text" style="white-space:nowrap">${escapeHtml(ext)}</span>
      </span>`;
    const input = wrap.querySelector(`.wizard-file-rename-input[data-file-idx="${i}"]`);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const newBase = input.value.trim();
      if (newBase) {
        const newName = `${newBase}${ext}`;
        const renamed = new File([oldFile], newName, { type: oldFile.type, lastModified: oldFile.lastModified });
        if (oldFile.sourceDocumentId) renamed.sourceDocumentId = oldFile.sourceDocumentId;
        titleDeedWizard.files[i] = renamed;
      } else {
        toast("檔名不能空白", "error");
      }
      renderWizardFileList();
    };
    const cancel = () => {
      if (done) return;
      done = true;
      renderWizardFileList();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
  };

  wrap.querySelectorAll("[data-rename-file]").forEach((btn) => {
    btn.addEventListener("click", () => startInlineRename(Number(btn.dataset.renameFile)));
  });
  wrap.querySelectorAll(".wizard-file-name").forEach((span) => {
    span.addEventListener("dblclick", () => startInlineRename(Number(span.dataset.fileIdx)));
  });
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

function startFakeProgress(wrapId, fillId, labelId, tauSeconds = 45, labelPrefix = "偵測中") {
  const wrap = document.getElementById(wrapId);
  const fill = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  if (!wrap || !fill || !label) return { finish() { }, stop() { } };

  const startedAt = Date.now();
  wrap.style.display = "";
  const phaseFor = (pct) => {
    if (pct < 12) return "正在上傳檔案並轉換頁面影像";
    if (pct < 40) return "正在逐頁辨識文字 (OCR)";
    if (pct < 68) return "正在解析地主、統編、地號、持分等欄位";
    if (pct < 85) return "正在比對電子謄本規則並校正欄位";
    return "正在彙整辨識結果";
  };
  const timer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const pct = 92 * (1 - Math.exp(-elapsed / tauSeconds));
    fill.style.width = `${pct}%`;
    label.textContent = `${phaseFor(pct)}…`;
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
    // 交給輪詢自己驅動進度條 / 文字(避免假進度跑完後看起來像卡住)。把 startedAt
    // 一起交出去,輪詢那邊才能接著同一條時間軸算百分比,不會一接手就從某個固定
    // 底線(例如 92%)重新起跳,造成畫面上「一下子跳到後面」的錯覺。
    takeOver() {
      clearInterval(timer);
      return { fill, label, startedAt };
    },
  };
}

// 謄本辨識改為背景工作:POST 回 job(status=processing),這裡輪詢 GET ocr-jobs/{id}
// 直到 completed / failed。回傳跟舊同步版一樣的 { job, data } 形狀。
async function pollTitleDeedJob(pid, jobId, { intervalMs = 3000, maxMs = 45 * 60 * 1000, progress = null } = {}) {
  const ui = progress && progress.takeOver ? progress.takeOver() : null;
  // 時間軸接著假進度條那邊算,不要重新歸零 —— 不然一接手就會從某個固定底線(例如
  // 92%)重新起跳,畫面上看起來像「一下子跳到後面」。沒有假進度條可接(例如沒傳
  // progress)才退回現在起算。
  const started = (ui && ui.startedAt) || Date.now();
  // 後端目前只回 processing/completed/failed,沒有細分階段;依經過時間輪播「現在大概在做什麼」
  // (不顯示秒數)。大份謄本各階段耗時很長,門檻抓寬一點。
  const PHASES = [
    [0, "正在轉換 PDF 頁面影像"],
    [25, "正在逐頁辨識文字 (OCR)"],
    [90, "正在解析地號、所有權人、持分等欄位"],
    [150, "正在還原被遮罩的戶籍地址"],
    [260, "正在用 AI 校正地址與欄位"],
    [340, "正在彙整辨識結果"],
  ];
  const paint = () => {
    if (!ui) return;
    const sec = (Date.now() - started) / 1000;
    let phase = PHASES[0][1];
    for (const [t, txt] of PHASES) if (sec >= t) phase = txt;
    // 單一條連續曲線,從 0 一路爬到接近 100%,不再跟假進度條那段分開算、接手時銜
    // 接不上。tau 拉到 200 秒,大份謄本常常要跑好幾分鐘,爬升速度才不會看起來突兀。
    if (ui.fill) ui.fill.style.width = `${97 * (1 - Math.exp(-sec / 200))}%`;
    if (ui.label) ui.label.textContent = `${phase}…`;
  };
  paint();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    paint();
    let detail = null;
    try {
      detail = await api(`/projects/${pid}/ocr-jobs/${jobId}`, { silent: true });
    } catch (e) {
      continue; // 短暫網路/連線問題,繼續輪詢
    }
    if (!detail || !detail.job) continue;
    if (detail.job.status === "completed" || detail.job.status === "failed") {
      return { job: detail.job, data: detail.extracted_data || null };
    }
  }
  return {
    job: { id: jobId, status: "failed", error_message: "辨識逾時(超過 45 分鐘),請改用較少頁數分批匯入" },
    data: null,
  };
}

async function runTitleDeedOcr() {
  if (!titleDeedWizard.files.length) {
    toast("請先選擇至少一個檔案", "error");
    return;
  }
  const btn = document.getElementById("wizard-start-ocr-btn");
  btn.disabled = true;
  btn.textContent = "辨識中...";
  const progress = startFakeProgress(
    "wizard-ocr-progress-wrap",
    "wizard-ocr-progress-fill",
    "wizard-ocr-progress-label",
    // 實際辨識常常要 2~10 分鐘,tau 太小(舊值 20 秒起跳)前 20 秒就衝到快 60%,
    // 看起來像「一下子跳很快」跟實際進度對不上 —— 拉長到 60 秒起跳,爬升明顯放緩。
    Math.max(60, titleDeedWizard.files.length * 8)
  );
  try {
    const fd = new FormData();
    titleDeedWizard.files.forEach((f) => {
      fd.append("files", f);
      fd.append("source_document_ids", f.sourceDocumentId ? String(f.sourceDocumentId) : "");
    });
    fd.append("record_type", titleDeedWizard.recordType);
    let result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });
    if (result && result.job && result.job.status === "processing") {
      result = await pollTitleDeedJob(state.currentProjectId, result.job.id, { progress });
    }

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
      if (/失敗|不完整/.test(result.job.error_message)) toast(result.job.error_message, "error");
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

const ACCESSORY_USE_OPTIONS = ["平台", "陽臺", "防空避難室"];

function accessoryUseOptionsHtml(current) {
  // OpenCC in the backend post-process turns 「平台」 into 「平臺」; fold it back so it
  // matches the standard option instead of being kept as a stray extra choice.
  const cur = (current || "").trim().replace(/平臺/g, "平台");
  const opts = ACCESSORY_USE_OPTIONS.slice();
  // Keep an OCR-read value that isn't one of the three standard options rather than
  // silently dropping it.
  if (cur && !opts.includes(cur)) opts.push(cur);
  return (
    `<option value=""${cur ? "" : " selected"}>（無）</option>` +
    opts.map((o) => `<option value="${escapeHtml(o)}"${o === cur ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")
  );
}

const READONLY_BOX_STYLE =
  "padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600";

function accessoryRowHtml(a) {
  a = a || {};
  const use = (a.use || "").trim();
  // 用途「（無）」時面積視為 0。
  const area = use ? (a.area_sqm != null ? a.area_sqm : "") : (a.area_sqm != null && a.area_sqm !== "" ? a.area_sqm : 0);
  return `<div class="field-row accessory-row" style="align-items:flex-end;margin-bottom:8px">
    <div class="field" style="flex:1 1 150px;margin-bottom:0"><label>用途</label>
      <select class="acc-use">${accessoryUseOptionsHtml(use)}</select></div>
    <div class="field" style="flex:0 0 130px;margin-bottom:0"><label>面積(㎡)</label>
      <input class="acc-area area-live" type="number" step="0.01" value="${escapeHtml(area)}" autocomplete="off"></div>
    <button type="button" class="btn-link btn-sm acc-del" style="color:var(--danger);flex:0 0 auto;padding-bottom:9px">刪除</button>
  </div>`;
}

const FLOOR_NAME_OPTIONS = [
  "地下三層", "地下二層", "地下一層",
  "一層", "二層", "三層", "四層", "五層", "六層", "七層",
];

function floorNameOptionsHtml(current) {
  const cur = (current || "").trim();
  const opts = FLOOR_NAME_OPTIONS.slice();
  if (cur && !opts.includes(cur)) opts.push(cur); // keep an OCR value outside the list
  return (
    `<option value=""${cur ? "" : " selected"}>（未選）</option>` +
    opts.map((o) => `<option value="${escapeHtml(o)}"${o === cur ? " selected" : ""}>${escapeHtml(o)}</option>`).join("") +
    `<option value="__custom__">＋ 自訂層次…</option>`
  );
}

function floorRowHtml(f) {
  f = f || {};
  return `<div class="field-row floor-row" style="align-items:flex-end;margin-bottom:8px">
    <div class="field" style="flex:1 1 150px;margin-bottom:0"><label>樓層</label>
      <select class="flr-name">${floorNameOptionsHtml(f.floor || "")}</select></div>
    <div class="field" style="flex:0 0 130px;margin-bottom:0"><label>面積(㎡)</label>
      <input class="flr-area area-live" type="number" step="0.01" value="${escapeHtml(f.area_sqm != null ? f.area_sqm : "")}" autocomplete="off"></div>
    <button type="button" class="btn-link btn-sm flr-del" style="color:var(--danger);flex:0 0 auto;padding-bottom:9px">刪除</button>
  </div>`;
}

// 謄本原始的「前次移轉現值或原規定地價」下拉選單被選到某一筆時,把那一筆的年月/金額
// 套進上面正式的(會送出存檔的)年月選擇器跟金額欄位 - 下拉選單本身只是參考清單,
// 不是另一個資料來源,選了以後兩邊要同步。
function applyDeclaredValueHistoryOption(selectEl) {
  const opt = selectEl.selectedOptions[0];
  if (!opt) return;
  const field = selectEl.closest("[data-declared-value-field]");
  if (!field) return;
  const valueEl = field.querySelector(".lo-declared-value");
  if (valueEl) valueEl.value = opt.dataset.value || "";
  const wrap = field.querySelector(".ymp");
  if (wrap && opt.dataset.year && opt.dataset.month) {
    wrap.dataset.ympYear = opt.dataset.year;
    wrap.dataset.ympMonth = opt.dataset.month;
    wrap.querySelector('input[name$="_year"]').value = opt.dataset.year;
    wrap.querySelector('input[name$="_month"]').value = opt.dataset.month;
    wrap.querySelector(".ymp-trigger-label").textContent = `${opt.dataset.year}年${String(opt.dataset.month).padStart(2, "0")}月`;
  }
}

function buildingSummaryHtml(b) {
  const catSelector = deedCategorySelectorHtml("wizard-building-owners", "bo");
  return `${catSelector}<span>建號 ${escapeHtml(b.building_number || "-")} · ${escapeHtml(b.building_address || "(未填寫門牌)")} · ${b.owners.length} 位所有權人</span>`;
}

function ownerRowHtml(prefix, o, areaSqm) {
  const numerator = o.ownership_numerator || 1;
  const denominator = o.ownership_denominator || 1;
  let areaFieldsHtml = "";
  if (areaSqm) {
    // For buildings, `areaSqm` is 權狀面積 (建物總面積 + 附屬建物面積). 持份權狀面積 =
    // 權狀面積 × 權利範圍分子 / 分母; 坪 = ㎡ × 0.3025.
    const isBldg = prefix === "bo";
    const sqmLabel = isBldg ? "持份權狀面積(㎡)" : "持分面積(m²)";
    const pingLabel = isBldg ? "持份權狀面積(坪)" : "持分面積(坪)";
    const ownedSqm = (areaSqm * numerator) / denominator;
    const ownedPing = ownedSqm * PING_PER_SQM;
    areaFieldsHtml = `
      <div class="field" style="flex:0 0 130px">
        <label>${sqmLabel}</label>
        <div class="${prefix}-area-sqm" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedSqm.toFixed(2)}</div>
      </div>
      <div class="field" style="flex:0 0 130px">
        <label>${pingLabel}</label>
        <div class="${prefix}-area-ping" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedPing.toFixed(3)}</div>
      </div>`;
  }
  const declaredValueHistoryHtml =
    Array.isArray(o.transfer_history) && o.transfer_history.length > 1
      ? `<div style="margin-top:4px">
          <select class="lo-declared-history-select" style="width:100%" onchange="applyDeclaredValueHistoryOption(this)">
            ${o.transfer_history
              .map((h) => {
                const m = /(\d{2,3})\s*年\s*(\d{1,2})\s*月/.exec(h.period || "");
                const year = m ? m[1] : "";
                const month = m ? m[2] : "";
                const selected = (h.period || "") === (o.declared_value_period || "") ? " selected" : "";
                return `<option value="" data-year="${escapeHtml(year)}" data-month="${escapeHtml(month)}" data-value="${escapeHtml(h.value ?? "")}"${selected}>謄本原始記錄:${escapeHtml(h.period || "")} ${escapeHtml(h.value != null ? h.value : "")}元/m²</option>`;
              })
              .join("")}
          </select>
        </div>`
      : "";
  const declaredValueFieldHtml =
    prefix === "lo"
      ? `<div class="field" data-declared-value-field style="flex:1 1 220px;min-width:220px">
          <label>前次移轉現值或原規定地價(元/m²)</label>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="flex:0 0 100px">${minguoYearMonthPickerHtml(`${prefix}-declared-period`, o.declared_value_period)}</span>
            <input class="${prefix}-declared-value" type="number" step="1" value="${escapeHtml(o.declared_value_per_sqm)}" autocomplete="off" style="flex:1;min-width:0">
          </div>
          ${declaredValueHistoryHtml}
        </div>`
      : "";

  const isThird = isThirdCategoryDeed();

  return `
    <div class="field-row">
      <div class="field" style="flex:0 0 72px"><label>登記次序</label><input class="${prefix}-order" value="${escapeHtml(o.registration_order)}" autocomplete="off"></div>
      <div class="field" style="flex:1.3 1 118px"><label>所有權人姓名</label><input class="${prefix}-name" value="${escapeHtml(o.owner_name)}" autocomplete="off"></div>
      <div class="field ${prefix}-idnum-wrap" style="flex:1.6 1 160px;display:${isThird ? "none" : "block"}">
        <label>統一編號</label>
        <input class="${prefix}-idnum" value="${escapeHtml(o.id_number)}" placeholder="例如 A123456789" autocomplete="off">
      </div>
      <div class="field" style="flex:0 0 auto">
        <label>權利範圍</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="${prefix}-num" type="number" value="${numerator}" placeholder="分子" style="width:78px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input class="${prefix}-den" type="number" value="${denominator}" placeholder="分母" style="width:104px" autocomplete="off">
        </div>
      </div>
    </div>
    <div class="field"><label>戶籍地址</label><input class="${prefix}-address" value="${escapeHtml(o.address)}" autocomplete="off"></div>
    <div class="field-row">
      ${areaFieldsHtml}
      ${declaredValueFieldHtml}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:8px;border-top:1px dashed var(--border-light, #e2e8f0)">
      <button type="button" class="btn-link btn-sm remove-wizard-row-btn" style="color:var(--danger)">刪除此筆</button>
      <button type="button" class="btn-secondary btn-sm insert-wizard-row-btn">+ 新增所有權人</button>
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

  if (!owners.length) {
    wrap.innerHTML = `<button type="button" class="btn-secondary btn-sm owner-add-first-btn">+ 新增所有權人</button>`;
    wrap.querySelector(".owner-add-first-btn").addEventListener("click", () => {
      owners.push({
        registration_order: "", owner_name: "", id_number: "",
        ownership_numerator: 1, ownership_denominator: 1,
        address: "", declared_value_per_sqm: "", declared_value_period: "",
      });
      renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
      document.querySelector(`#${containerId} .wizard-row .${prefix}-name`)?.focus();
    });
    return;
  }

  wrap.innerHTML = `
    <div class="pooled-ownership-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span class="helper-text" style="margin:0">🔗 系統會根據謄本自動勾選「公同」;可自行勾選或取消。</span>
    </div>
    ${owners
      .map(
        (o, i) =>
          `<div class="record-row wizard-row" data-index="${i}"><div class="wizard-row-index" style="display:flex;align-items:center;gap:8px">所有權人 #${i + 1}${o._pooled ? ` <span style="font-size:0.75rem;padding:1px 6px;border-radius:8px;background:#faf5ff;color:#6b21a8;border:1px solid #e9d5ff;font-weight:700">公同共有</span>` : ""}<label style="margin-left:auto;font-weight:400;font-size:0.8rem;display:inline-flex;align-items:center;gap:3px"><input type="checkbox" class="${prefix}-pooled-check" ${o._pooled ? "checked" : ""} style="width:auto">公同</label></div>${ownerRowHtml(prefix, o, areaSqm)}</div>`
      )
      .join("")}`;
  wireYearMonthPickers(wrap);
  wireDeedCategorySelector();

  // Live-recompute 持分/持份面積 as the 權利範圍 fraction is edited.
  wrap.querySelectorAll(".wizard-row").forEach((row) => {
    const numI = row.querySelector(`.${prefix}-num`);
    const denI = row.querySelector(`.${prefix}-den`);
    const sqmEl = row.querySelector(`.${prefix}-area-sqm`);
    if (!numI || !denI || !sqmEl) return;
    const pingEl = row.querySelector(`.${prefix}-area-ping`);
    const recalc = () => {
      const n = Number(numI.value) || 0;
      const d = Number(denI.value) || 1;
      const owned = areaSqm ? (areaSqm * n) / d : 0;
      sqmEl.textContent = owned.toFixed(2);
      if (pingEl) pingEl.textContent = (owned * PING_PER_SQM).toFixed(3);
    };
    numI.addEventListener("input", recalc);
    denI.addEventListener("input", recalc);
  });

  // 「公同」勾選框現在就是一個單純的旗標:使用者想勾誰就勾誰(單獨一位也留著),
  // 不再自動去動權利範圍。權利範圍一律依謄本自行填。勾選狀態就是 _pooled 的唯一來源,
  // 匯入時 _pooled 的所有權人 notes 會標「公同共有」。
  const recomputePooled = () => {
    const latest = readOwnerRowsContainer(containerId, prefix, owners);
    owners.length = 0;
    owners.push(...latest);

    const checks = [...wrap.querySelectorAll(`.${prefix}-pooled-check`)];
    owners.forEach((o, i) => {
      if (checks[i] && checks[i].checked) o._pooled = true;
      else { delete o._pooled; delete o._pooledOrig; }
    });

    renderOwnerRowsContainer(containerId, owners, prefix, areaSqm);
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
      btn.textContent = "重新辨識中...";
      const wrap = document.createElement("div");
      wrap.id = "wizard-rescan-progress-wrap";
      wrap.style.marginTop = "8px";
      wrap.innerHTML = `
        <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-rescan-progress-fill" style="width:0%"></div></div>
        <div class="helper-text" id="wizard-rescan-progress-label" style="margin-top:4px;text-align:center"></div>`;
      btn.insertAdjacentElement("afterend", wrap);
    }
    var progress = btn
      ? startFakeProgress("wizard-rescan-progress-wrap", "wizard-rescan-progress-fill", "wizard-rescan-progress-label", 40, "重新辨識中")
      : null;
    try {
      const fd = new FormData();
      Array.from(input.files).forEach((f) => fd.append("files", f));
      fd.append("record_type", recordType === "parcel" ? "land" : "building");
      let result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });
      if (result && result.job && result.job.status === "processing") {
        result = await pollTitleDeedJob(state.currentProjectId, result.job.id, { progress });
      }
      if (!result || !result.job || result.job.status !== "completed") {
        toast((result && result.job && result.job.error_message) || "辨識失敗", "error");
        if (progress) progress.stop();
        return;
      }
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
    // 這是最後一筆(沒有建物要接著填),直接跳確認框、確定就送出建立。
    confirmAndSubmitTitleDeedWizard();
  }
}

function renderWizardStepParcelEditor() {
  const substeps = [renderParcelDescriptionSubStep, renderParcelOwnersSubStep, renderParcelEncumbrancesSubStep];
  substeps[titleDeedWizard.parcelSubStep || 0](titleDeedWizard.activeIndex);
}

function renderParcelDescriptionSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  titleDeedWizard._rerenderCurrentSubstep = () => renderParcelDescriptionSubStep(idx);
  renderWizardSplitStep(`
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
      <button type="button" class="btn-primary btn-sm" id="wizard-oneclick-btn" style="margin-right:auto">⚡ 一鍵建立</button>
      <button type="button" class="btn-danger" id="wizard-delete-parcel-btn">刪除此筆</button>
      ${idx > 0 ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地所有權部</button>
    </div>`, p.source_page);

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
  document.getElementById("wizard-oneclick-btn").addEventListener("click", () => {
    saveFields();
    oneClickCreateTitleDeed();
  });
}

function renderParcelOwnersSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  titleDeedWizard._rerenderCurrentSubstep = () => renderParcelOwnersSubStep(idx);
  renderWizardSplitStep(`
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 2/3 土地所有權部`)}
    <div class="helper-text" id="wizard-parcel-summary" style="margin-bottom:10px">${parcelSummaryHtml(p)}</div>
    <div id="wizard-land-owners" style="margin:6px 0"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地他項權利部</button>
    </div>`, p.source_page);

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
  const isLast = idx === parcels.length - 1;
  titleDeedWizard._rerenderCurrentSubstep = () => renderParcelEncumbrancesSubStep(idx);
  renderWizardSplitStep(`
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 3/3 土地他項權利部`)}
    <div class="helper-text" id="wizard-parcel-enc-summary" style="margin-bottom:10px">${parcelSummaryHtml(p, "encumbrances")}</div>
    <div id="wizard-parcel-encumbrances" style="margin:6px 0"></div>
    <div class="helper-text" style="margin-top:6px">若這筆地號沒有他項權利部,可直接略過。跨好幾筆地號的他項權利,留到最後「他項權利部」步驟處理即可</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "確認建立" : "下一筆地號"}</button>
    </div>`, p.source_page);

  renderEncumbranceRows("wizard-parcel-encumbrances", p.encumbrances);

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

function encParcelTokens(value) {
  return String(value || "").split(/[\s,、]+/).filter(Boolean);
}

// 土地他項權利部用「對應地號」;建物他項權利部用「共同擔保建號」。
function encLabels(containerId) {
  const isBldg = String(containerId || "").includes("building");
  return isBldg
    ? { label: "共同擔保建號", add: "＋ 建號", prompt: "輸入建號 (例:01805-000)" }
    : { label: "對應地號", add: "＋ 地號", prompt: "輸入地號 (例:0242-0000)" };
}

function encParcelsChipsInnerHtml(value, labels) {
  const L = labels || encLabels();
  return (
    encParcelTokens(value)
      .map(
        (p) =>
          `<span class="wizard-confirm-chip encumbrance" style="font-size:0.8rem;display:inline-flex;align-items:center;gap:5px">${escapeHtml(p)}<button type="button" class="enc-parcel-del" data-val="${escapeHtml(p)}" title="移除" style="border:none;background:none;color:inherit;cursor:pointer;font-size:1.05rem;line-height:1;padding:0">×</button></span>`
      )
      .join("") +
    `<button type="button" class="btn-secondary btn-sm enc-parcels-add" style="padding:3px 9px">${L.add}</button>`
  );
}

// 命名為 wizard 開頭:encumbrances.js 也有一個同名的 encumbranceRowHtml(enc)(1個參數,
// 渲染「已存檔他項權利部」的唯讀列+編輯/刪除按鈕),兩個檔案都是純 <script> 全域載入、
// 沒有模組隔離,同名 function 後載入的會直接蓋掉先載入的。index.html 裡 encumbrances.js
// 排在 ocr_wizard.js 後面,蓋掉這支的結果就是:精靈審核時他項權利列被換成唯讀樣式,
// 「編輯/刪除」按鈕看起來有,點了卻完全沒反應(那兩個按鈕的事件是綁在 encumbrances.js
// 自己的分頁邏輯上,精靈這裡從來沒呼叫過)。改名徹底避開這個全域命名碰撞。
function wizardEncumbranceRowHtml(e, labels) {
  const L = labels || encLabels();
  const ratio = parseDebtorRatio(e.debtor_info);
  return `
    <div class="field">
      <label>${L.label}</label>
      <input type="hidden" class="enc-parcels" value="${escapeHtml(e.applies_to_parcels)}">
      <div class="enc-parcels-chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:3px">${encParcelsChipsInnerHtml(e.applies_to_parcels, L)}</div>
    </div>
    <div class="field-row">
      <div class="field" style="flex:0 0 110px"><label>登記次序</label><input class="enc-order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
      <div class="field" style="flex:1 1 150px">
        <label>權利種類</label>
        <select class="enc-type" style="width:100%">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field" style="flex:1 1 200px"><label>他項權利人</label><input class="enc-holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
      <div class="field" style="flex:0 0 auto">
        <label>債務額比例</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="enc-debtor-num" type="number" value="${escapeHtml(ratio.numerator)}" placeholder="分子" style="width:70px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input class="enc-debtor-den" type="number" value="${escapeHtml(ratio.denominator)}" placeholder="分母" style="width:70px" autocomplete="off">
        </div>
      </div>
    </div>
    <div class="field-row">
      <div class="field" style="flex:1 1 200px"><label>擔保債權總金額(元)</label><input class="enc-amount" inputmode="numeric" value="${escapeHtml(formatSecuredAmount(e.secured_amount))}" placeholder="例:3,600,000" autocomplete="off"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:8px;border-top:1px dashed var(--border-light, #e2e8f0)">
      <button type="button" class="btn-link btn-sm remove-wizard-row-btn" style="color:var(--danger)">刪除此筆</button>
      <button type="button" class="btn-secondary btn-sm enc-insert-row-btn">+ 新增他項權利</button>
    </div>`;
}

function readEncumbranceRowsRaw(containerId) {
  return [...document.querySelectorAll(`#${containerId} .wizard-row`)].map((row) => {
    const numerator = (row.querySelector(".enc-debtor-num")?.value || "").trim();
    const denominator = (row.querySelector(".enc-debtor-den")?.value || "").trim();
    return {
      registration_order: (row.querySelector(".enc-order")?.value || "").trim(),
      applies_to_parcels: (row.querySelector(".enc-parcels")?.value || "").trim(),
      right_type: (row.querySelector(".enc-type")?.value || "").trim(),
      right_holder: (row.querySelector(".enc-holder")?.value || "").trim(),
      debtor_info: numerator && denominator ? `${denominator}分之${numerator}` : "",
      secured_amount: parseSecuredAmount(row.querySelector(".enc-amount")?.value),
    };
  });
}

function renderEncumbranceRows(containerId, list) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  const summaryEl = document.getElementById("wizard-parcel-enc-summary");
  if (summaryEl && titleDeedWizard && titleDeedWizard.data && titleDeedWizard.data.parcels) {
    const p = titleDeedWizard.data.parcels[titleDeedWizard.activeIndex || 0];
    if (p) summaryEl.innerHTML = parcelSummaryHtml(p, "encumbrances");
  }

  if (!list.length) {
    wrap.innerHTML = `<button type="button" class="btn-secondary btn-sm enc-add-first-btn">+ 新增他項權利</button>`;
    wrap.querySelector(".enc-add-first-btn").addEventListener("click", () => {
      list.push({ registration_order: "", applies_to_parcels: "", right_type: "", right_holder: "", debtor_info: "", secured_amount: null });
      renderEncumbranceRows(containerId, list);
      document.querySelector(`#${containerId} .wizard-row .enc-order`)?.focus();
    });
    return;
  }

  const L = encLabels(containerId);
  wrap.innerHTML = list
    .map((e, i) => `<div class="record-row wizard-row" data-index="${i}">${wizardEncumbranceRowHtml(e, L)}</div>`)
    .join("");

  const rowIndex = (target) => {
    const row = target.closest(".wizard-row");
    return [...wrap.querySelectorAll(".wizard-row")].indexOf(row);
  };

  wrap.querySelectorAll(".enc-parcels-chips").forEach((chips) => {
    const fieldEl = chips.parentElement;
    const hidden = fieldEl.querySelector(".enc-parcels");
    const redraw = () => { chips.innerHTML = encParcelsChipsInnerHtml(hidden.value, L); };
    chips.addEventListener("click", (ev) => {
      const del = ev.target.closest(".enc-parcel-del");
      const add = ev.target.closest(".enc-parcels-add");
      if (del) {
        hidden.value = encParcelTokens(hidden.value).filter((t) => t !== del.dataset.val).join(" ");
        redraw();
      } else if (add) {
        const v = (prompt(L.prompt) || "").trim();
        if (!v) return;
        const toks = encParcelTokens(hidden.value);
        if (!toks.includes(v)) toks.push(v);
        hidden.value = toks.join(" ");
        redraw();
      }
    });
  });

  wrap.querySelectorAll(".remove-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = rowIndex(e.target);
      if (index === -1) return;
      const edited = readEncumbranceRowsRaw(containerId);
      edited.forEach((v, i) => { if (list[i]) list[i] = { ...list[i], ...v }; });
      list.splice(index, 1);
      renderEncumbranceRows(containerId, list);
    });
  });

  wrap.querySelectorAll(".enc-insert-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = rowIndex(e.target);
      if (index === -1) return;
      const edited = readEncumbranceRowsRaw(containerId);
      edited.forEach((v, i) => { if (list[i]) list[i] = { ...list[i], ...v }; });
      list.splice(index + 1, 0, {
        registration_order: "",
        applies_to_parcels: (list[index] && list[index].applies_to_parcels) || "",
        right_type: "",
        right_holder: "",
        debtor_info: "",
        secured_amount: null,
      });
      renderEncumbranceRows(containerId, list);
      const inserted = wrap.querySelector(`.wizard-row[data-index="${index + 1}"]`);
      if (inserted) {
        inserted.scrollIntoView({ behavior: "smooth", block: "center" });
        inserted.querySelector(".enc-order")?.focus();
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
        secured_amount: parseSecuredAmount(row.querySelector(".enc-amount")?.value),
      };
    })
    .filter((e) => e.right_type || e.right_holder);
}

function advanceFromBuilding(idx) {
  const d = titleDeedWizard.data;
  titleDeedWizard.buildingSubStep = 0;
  if (idx < d.buildings.length) {
    titleDeedWizard.activeIndex = idx;
    renderWizardStep();
  } else {
    // 建物一律排在土地後面處理,這是整批的最後一筆,直接跳確認框、確定就送出建立。
    confirmAndSubmitTitleDeedWizard();
  }
}

function renderWizardStepBuildingEditor() {
  const substeps = [renderBuildingDescriptionSubStep, renderBuildingOwnersSubStep, renderBuildingEncumbranceSubStep];
  substeps[titleDeedWizard.buildingSubStep || 0](titleDeedWizard.activeIndex);
}

function renderBuildingDescriptionSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  titleDeedWizard._rerenderCurrentSubstep = () => renderBuildingDescriptionSubStep(idx);
  renderWizardSplitStep(`
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 1/3 建物標示部`)}
    <div style="margin-bottom:10px">
      <button type="button" class="btn-secondary btn-sm" id="wizard-rescan-btn">重新上傳這一筆的建物謄本檔案並辨識</button>
    </div>
    <form id="wizard-step-form" autocomplete="off">
      <div class="field-row">
        <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(b.parcel_number)}" autocomplete="off"></div>
        <div class="field"><label>建號</label><input name="building_number" value="${escapeHtml(b.building_number)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>建號門牌</label><input name="building_address" value="${escapeHtml(b.building_address)}" autocomplete="off"></div>
        <div class="field" style="flex:0 0 110px"><label>層數</label><input name="total_floors" value="${escapeHtml(b.total_floors)}" autocomplete="off"></div>
        <div class="field" style="flex:0 0 150px"><label>建物總面積(㎡)</label><div id="wizard-total-area" style="${READONLY_BOX_STYLE}">0.00</div></div>
      </div>
      <div class="field">
        <label>層次</label>
        <div id="wizard-floor-rows"></div>
        <button type="button" class="btn-secondary btn-sm" id="wizard-flr-add" style="margin-top:2px">＋ 層次</button>
      </div>
      <div class="field">
        <label>附屬建物</label>
        <div id="wizard-accessory-rows"></div>
        <button type="button" class="btn-secondary btn-sm" id="wizard-acc-add" style="margin-top:2px">＋ 附屬建物</button>
      </div>
      <div class="field-row">
        <div class="field"><label>附屬建物總面積(㎡)</label><div id="wizard-acc-total" style="${READONLY_BOX_STYLE}">0.00</div></div>
        <div class="field"><label>權狀面積(㎡)</label><div id="wizard-license-area" style="${READONLY_BOX_STYLE}">0.00</div></div>
      </div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn-primary btn-sm" id="wizard-oneclick-btn" style="margin-right:auto">⚡ 一鍵建立</button>
      <button type="button" class="btn-danger" id="wizard-delete-building-btn">刪除此筆</button>
      ${idx > 0 ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:建物所有權部</button>
    </div>`, b.source_page);

  document.getElementById("wizard-rescan-btn").addEventListener("click", () => {
    openWizardSingleRecordRescan("building", b, () => renderBuildingDescriptionSubStep(idx));
  });

  const form = document.getElementById("wizard-step-form");
  const accWrap = document.getElementById("wizard-accessory-rows");
  const flrWrap = document.getElementById("wizard-floor-rows");

  const domAccessories = () =>
    [...accWrap.querySelectorAll(".accessory-row")].map((r) => ({
      use: (r.querySelector(".acc-use").value || "").trim(),
      area_sqm: r.querySelector(".acc-area").value || "",
    }));
  const domFloors = () =>
    [...flrWrap.querySelectorAll(".floor-row")].map((r) => ({
      floor: (r.querySelector(".flr-name").value || "").trim(),
      area_sqm: r.querySelector(".flr-area").value || "",
    }));

  const sumFloorArea = () =>
    [...flrWrap.querySelectorAll(".flr-area")].reduce((s, i) => s + (Number(i.value) || 0), 0);
  const sumAccessoryArea = () =>
    [...accWrap.querySelectorAll(".acc-area")].reduce((s, i) => s + (Number(i.value) || 0), 0);
  const updateComputed = () => {
    const total = sumFloorArea();
    const accSum = sumAccessoryArea();
    document.getElementById("wizard-total-area").textContent = total.toFixed(2);
    document.getElementById("wizard-acc-total").textContent = accSum.toFixed(2);
    document.getElementById("wizard-license-area").textContent = (total + accSum).toFixed(2);
  };

  const drawAccessories = (list) => {
    accWrap.innerHTML = (list.length ? list : [{}]).map(accessoryRowHtml).join("");
    accWrap.querySelectorAll(".acc-del").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const cur = domAccessories();
        cur.splice(i, 1);
        drawAccessories(cur);
      });
    });
    accWrap.querySelectorAll(".accessory-row").forEach((row) => {
      const useSel = row.querySelector(".acc-use");
      const areaIn = row.querySelector(".acc-area");
      useSel.addEventListener("change", () => {
        if (!useSel.value.trim()) areaIn.value = "0";
        else if (areaIn.value === "0" || areaIn.value === "") areaIn.value = "";
        updateComputed();
      });
    });
    updateComputed();
  };
  const drawFloors = (list) => {
    flrWrap.innerHTML = (list.length ? list : [{}]).map(floorRowHtml).join("");
    flrWrap.querySelectorAll(".flr-del").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const cur = domFloors();
        cur.splice(i, 1);
        drawFloors(cur);
      });
    });
    flrWrap.querySelectorAll(".flr-name").forEach((sel) => {
      sel.addEventListener("change", () => {
        if (sel.value !== "__custom__") return;
        const v = (prompt("輸入層次名稱 (例:八層、地下四層、屋頂突出物)") || "").trim();
        const cur = domFloors();
        const idx = [...flrWrap.querySelectorAll(".flr-name")].indexOf(sel);
        if (cur[idx]) cur[idx].floor = v;
        drawFloors(cur);
      });
    });
    updateComputed();
  };
  drawFloors(b.floors || []);
  drawAccessories(b.accessories || []);
  document.getElementById("wizard-acc-add").addEventListener("click", () => drawAccessories([...domAccessories(), {}]));
  document.getElementById("wizard-flr-add").addEventListener("click", () => drawFloors([...domFloors(), {}]));
  form.addEventListener("input", (e) => {
    if (e.target.classList.contains("area-live") || e.target.name === "total_area_sqm") updateComputed();
  });

  const saveFields = () => {
    const fd = new FormData(form);
    const accs = domAccessories().filter((a) => a.use);
    const flrs = domFloors().filter((f) => f.floor || String(f.area_sqm) !== "");
    Object.assign(b, {
      building_number: (fd.get("building_number") || "").trim(),
      building_address: (fd.get("building_address") || "").trim(),
      parcel_number: (fd.get("parcel_number") || "").trim(),
      total_floors: (fd.get("total_floors") || "").trim(),
      total_area_sqm: flrs.length ? Number(sumFloorArea().toFixed(2)) : "",
      floors: flrs,
      floor: flrs[0] ? flrs[0].floor : "",
      floor_area_sqm: flrs[0] ? flrs[0].area_sqm : "",
      accessories: accs,
      accessory_use: accs[0] ? accs[0].use : "",
      accessory_area_sqm: accs[0] ? accs[0].area_sqm : "",
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
  document.getElementById("wizard-oneclick-btn").addEventListener("click", () => {
    saveFields();
    oneClickCreateTitleDeed();
  });
}

function renderBuildingOwnersSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  titleDeedWizard._rerenderCurrentSubstep = () => renderBuildingOwnersSubStep(idx);
  renderWizardSplitStep(`
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 2/3 建物所有權部`)}
    <div class="helper-text" id="wizard-building-summary" style="margin-bottom:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px">${buildingSummaryHtml(b)}</div>
    <div id="wizard-building-owners" style="margin:6px 0"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:建物他項權利部</button>
    </div>`, b.source_page);
  // 權狀面積 = 建物總面積 + 所有附屬建物面積 (falls back to 層次面積 only when總面積 missing)
  const accArea = (b.accessories || []).reduce((s, a) => s + (Number(a.area_sqm) || 0), 0);
  const deedAreaSqm = (Number(b.total_area_sqm) || 0) + accArea;
  const areaSqm = deedAreaSqm || Number(b.floor_area_sqm) || null;
  renderOwnerRowsContainer("wizard-building-owners", b.owners, "bo", areaSqm);

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo", b.owners);
    titleDeedWizard.buildingSubStep = 0;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo", b.owners);
    titleDeedWizard.buildingSubStep = 2;
    renderWizardStep();
  });
}

function renderBuildingEncumbranceSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  const isLast = idx === buildings.length - 1;
  if (!b.encumbrances) b.encumbrances = [];
  titleDeedWizard._rerenderCurrentSubstep = () => renderBuildingEncumbranceSubStep(idx);
  renderWizardSplitStep(`
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 3/3 建物他項權利部`)}
    <div class="helper-text" id="wizard-building-enc-summary" style="margin-bottom:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px">${buildingSummaryHtml(b)}</div>
    <div id="wizard-building-encumbrances" style="margin:6px 0"></div>
    <div class="helper-text" style="margin-top:6px">若這筆建號沒有他項權利部,可直接略過。</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "確認建立" : "下一筆建號"}</button>
    </div>`, b.source_page);

  renderEncumbranceRows("wizard-building-encumbrances", b.encumbrances);

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    b.encumbrances = readEncumbranceRows("wizard-building-encumbrances");
    titleDeedWizard.buildingSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    b.encumbrances = readEncumbranceRows("wizard-building-encumbrances");
    advanceFromBuilding(idx + 1);
  });
}

// 沒有獨立的「確認建立」頁面了 —— 逐筆核對到最後一筆(或按「⚡ 一鍵建立」跳過核對)
// 時,跳頁面內確認視窗;按確定才真的送出建立,取消就留在原頁面繼續編輯。
async function confirmAndSubmitTitleDeedWizard() {
  const d = titleDeedWizard.data;
  if (!d || (!d.parcels.length && !d.buildings.length)) {
    toast("沒有可建立的資料", "error");
    return;
  }
  const total = d.parcels.length + d.buildings.length;
  const ok = await confirmDialog(
    "系統會自動比對／建立地主，並寫入土地、建物、他項權利資料;同一人出現在多筆地號／建號只會建立一筆地主。\n\n" +
      "請確認方才核對的姓名、地址、面積等 AI 辨識內容無誤 —— 建立後不會再跳出確認畫面。",
    { title: `確定要建立這 ${total} 筆土地／建物資料嗎？`, confirmText: "確定建立" }
  );
  if (ok) submitTitleDeedWizard();
}

// 地址比對用的正規化:只去掉開頭前 8 個字裡的「縣市鎮鄉區」這類行政區劃字,不動後面
// 的路名/巷弄/樓層 —— 專門用來消掉「桃園縣中壢市」vs「桃園市中壢區」這種 2010 年後縣市
// 改制造成的假差異,不是真的地址不同,拿原始字串一字不差比對會誤判成兩個不同人(見
// findOrCreateLandownerByOwner 下面的說明)。
function _normalizeAddrRegionForMatch(addr) {
  const s = (addr || "").trim();
  const head = s.slice(0, 8).replace(/[縣市鎮鄉區]/g, "");
  return head + s.slice(8);
}

async function findOrCreateLandownerByOwner(owner, createdCache, pid = state.currentProjectId) {
  const idKey = (owner.id_number || "").trim();
  const nameKey = owner.owner_name.trim();
  const addrKey = (owner.address || "").trim();
  const addrMatchKey = _normalizeAddrRegionForMatch(addrKey);
  // 統一比對規則:姓名、統一編號(不論是否被二類謄本遮罩成「A220*****1」)、戶籍
  // 地址(正規化後)三者都要一致才視為同一人,不管統編/姓名是不是完整可用 - 不再有
  // 「有完整統編就只比統編」的捷徑。地址比對用正規化後的版本(去掉開頭縣市區劃字),
  // 同一人的土地謄本/建物謄本常常隔了幾年才各自匯入,遇到縣市改制字面就不一樣,原樣
  // 比對會誤判成不同人、各自建一筆地主。
  const cacheKey = `nm:${nameKey}|id:${idKey}|ad:${addrMatchKey}`;
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
  const existing = existingList.find(
    (o) =>
      o.name === nameKey &&
      (o.id_number || "") === idKey &&
      _normalizeAddrRegionForMatch(o.address) === addrMatchKey,
  );

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
        notes: owner._pooled ? "公同共有(謄本掃描匯入)" : null,
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
  if (wizardSubmitInFlight) {
    toast("上一批謄本資料還在建立中,請等它完成再送出", "error");
    return;
  }
  wizardSubmitInFlight = true;
  const warnUnload = (e) => {
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", warnUnload);
  try {
    await submitTitleDeedWizardInner();
  } finally {
    window.removeEventListener("beforeunload", warnUnload);
    wizardSubmitInFlight = false;
  }
}

// 建立謄本資料時畫面底部的浮動進度條:不擋畫面,建立過程中可以繼續操作其他頁面。
function showImportProgressPanel(total) {
  document.getElementById("import-progress-panel")?.remove();
  const panel = document.createElement("div");
  panel.id = "import-progress-panel";
  panel.setAttribute("role", "status");
  panel.style.cssText =
    "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:190;background:var(--surface);" +
    "border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-modal);padding:12px 16px;" +
    "width:340px;max-width:calc(100vw - 40px)";
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700">
      <span class="ipp-label">謄本資料建立中…</span>
      <span class="ipp-count" style="margin-left:auto;font-variant-numeric:tabular-nums">(0/${total})</span>
    </div>
    <div style="margin-top:8px;height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden">
      <div class="ipp-bar" style="height:100%;width:0;background:var(--brand);transition:width .2s"></div>
    </div>
    <div class="ipp-sub" style="margin-top:6px;font-size:12px;color:var(--text-muted)">可以繼續操作其他頁面,完成後會通知你</div>`;
  document.body.appendChild(panel);
  const $ = (sel) => panel.querySelector(sel);
  const paint = (done) => {
    $(".ipp-count").textContent = `(${done}/${total})`;
    $(".ipp-bar").style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
  };
  return {
    update(done, sub) {
      paint(done);
      if (sub) $(".ipp-sub").textContent = sub;
    },
    finish(done, message) {
      paint(done);
      $(".ipp-label").textContent = message;
      $(".ipp-sub").textContent = "";
      setTimeout(() => panel.remove(), 4000);
    },
    fail(done, message) {
      paint(done);
      $(".ipp-label").textContent = "建立中斷";
      $(".ipp-bar").style.background = "var(--danger)";
      $(".ipp-sub").innerHTML = `${escapeHtml(message)} <button type="button" class="btn-link btn-sm" style="padding:0 4px">關閉</button>`;
      $(".ipp-sub button").addEventListener("click", () => panel.remove());
    },
  };
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

  const pid = state.currentProjectId;
  const namedOwners = (owners) => (owners || []).filter((o) => o.owner_name);
  const activeEncs = (list) => (list || []).filter((enc) => enc.right_type || enc.right_holder);
  const isCommonPart = (b) => (b.common_part_of || []).length > 0 || b.main_use === "共有部分";
  const totalUnits =
    d.parcels.reduce((s, p) => s + namedOwners(p.owners).length + activeEncs(p.encumbrances).length, 0) +
    activeEncs(d.encumbrances).length +
    d.buildings.reduce(
      (s, b) => s + namedOwners(b.owners).length + (isCommonPart(b) ? 1 : 0) + activeEncs(b.encumbrances).length,
      0
    );

  // 送出後精靈先關掉,改用畫面底部的浮動進度條顯示 (n/N),不擋住畫面。
  closeModal();
  titleDeedWizard = null;
  const progress = showImportProgressPanel(totalUnits);
  let doneUnits = 0;
  const tick = (sub) => {
    doneUnits++;
    progress.update(doneUnits, sub);
  };
  const postEncumbrances = (list, sub, kind) =>
    Promise.all(
      activeEncs(list).map((enc) =>
        api(`/projects/${pid}/encumbrances`, { method: "POST", body: { ...enc, parcel_kind: kind || null } }).then(() =>
          tick(sub)
        )
      )
    );

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
      const sub = `地號 ${p.parcel_number}`;
      progress.update(doneUnits, sub);
      for (const owner of p.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache, pid);
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
        // 跟 ltt_original_value 用同一個「單價 × 持分面積」公式換算成總額,把謄本原始的
        // 每一筆歷史記錄都留著(不是只留最新一筆),供編輯畫面顯示核對用。
        const lttHistory =
          Array.isArray(owner.transfer_history) && owner.transfer_history.length
            ? owner.transfer_history.map((h) => ({
                period: h.period || null,
                value_per_sqm: h.value != null ? Number(h.value) : null,
                value: h.value != null ? Math.round(Number(h.value) * ownedAreaSqm) : null,
              }))
            : null;
        const created = await api(`/projects/${pid}/landowners/${landownerId}/land-records`, {
          method: "POST",
          body: {
            parcel_number: p.parcel_number,
            township: p.township || null,
            section: p.section || null,
            subsection: p.subsection || null,
            registration_order: owner.registration_order || null,
            related_encumbrance_orders: (owner.related_encumbrance_orders || "").trim() || null,
            total_area_sqm: Number(p.area_sqm) || 0,
            ownership_numerator: numerator,
            ownership_denominator: denominator,
            source_ocr_job_id: p._sourceOcrJobId || null,
            ltt_original_value: declaredValuePerSqm ? Math.round(declaredValuePerSqm * ownedAreaSqm) : null,
            ltt_original_value_period: owner.declared_value_period || null,
            ltt_original_value_history: lttHistory,
          },
        });
        if (p._sourceOcrJobId) sourceOcrJobIds.add(p._sourceOcrJobId);
        landRecordIdByParcelOwner.set(parcelOwnerKey(p.parcel_number, ownerIdentityKey(owner)), created.id);
        tick(sub);
      }
      await postEncumbrances(p.encumbrances, sub, "land");
    }

    await postEncumbrances(d.encumbrances, "他項權利");

    for (const b of d.buildings) {
      const sub = `建號 ${b.building_number}`;
      progress.update(doneUnits, sub);
      // 建物總面積 = 主建物 + 附屬建物(見 landowners.js _compute_building_totals /
      // roster_excel.py 的定義)。b.total_area_sqm 是謄本印的「總面積」欄位,代表主
      // 建物本身的面積(有些舊謄本排版總面積欄位剛好已經含附屬建物,那是那份謄本
      // 格式本身的印法,不是這裡要處理的事)。structure_area_sqm 就填這個值,後端
      // 會自動 +auxiliary_area_sqm 算出建物總面積。
      const floorAreaSqm = Number(b.total_area_sqm) || Number(b.floor_area_sqm) || 0;
      const auxAreaSqm = (b.accessories || []).reduce((s, a) => s + (Number(a.area_sqm) || 0), 0);
      for (const owner of b.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache, pid);
        await api(`/projects/${pid}/landowners/${landownerId}/building-records`, {
          method: "POST",
          body: {
            land_record_id: landRecordIdByParcelOwner.get(parcelOwnerKey(b.parcel_number, ownerIdentityKey(owner))) || null,
            building_number: b.building_number || null,
            parcel_number: b.parcel_number || null,
            address: b.building_address || null,
            floor: b.floor || null,
            total_floors: b.total_floors || null,
            floors_detail: (b.floors || [])
              .filter((f) => f.floor || String(f.area_sqm) !== "")
              .map((f) => ({ floor: f.floor || "", area_sqm: Number(f.area_sqm) || 0 })),
            accessories_detail: (b.accessories || [])
              .filter((a) => a.use || String(a.area_sqm) !== "")
              .map((a) => ({ use: a.use || "", area_sqm: Number(a.area_sqm) || 0 })),
            registration_order: owner.registration_order || null,
            related_encumbrance_orders: (owner.related_encumbrance_orders || "").trim() || null,
            structure_area_sqm: floorAreaSqm,
            auxiliary_area_sqm: auxAreaSqm,
            common_area_sqm: 0,
            ownership_numerator: owner.ownership_numerator || 1,
            ownership_denominator: owner.ownership_denominator || 1,
            source_ocr_job_id: b._sourceOcrJobId || null,
          },
        });
        if (b._sourceOcrJobId) sourceOcrJobIds.add(b._sourceOcrJobId);
        tick(sub);
      }
      // 共有部分建號(公設/樓梯間):沒有所有權人,獨立建一筆 record,持分靠
      // common_part_shares 分給各主建物,地主清冊據此填「共有建號」欄位。
      if (isCommonPart(b)) {
        await api(`/projects/${pid}/building-parts`, {
          method: "POST",
          body: {
            building_number: b.building_number || null,
            parcel_number: b.parcel_number || null,
            address: b.building_address || null,
            total_floors: b.total_floors || null,
            structure_area_sqm: floorAreaSqm,
            auxiliary_area_sqm: auxAreaSqm,
            main_use: b.main_use || "共有部分",
            common_part_shares: (b.common_part_of || []).map((c) => ({
              building_number: c.main_building_number || "",
              numerator: Number(c.numerator) || 0,
              denominator: Number(c.denominator) || 0,
            })),
            source_ocr_job_id: b._sourceOcrJobId || null,
          },
        });
        if (b._sourceOcrJobId) sourceOcrJobIds.add(b._sourceOcrJobId);
        tick(sub);
      }
      await postEncumbrances(b.encumbrances, sub, "building");
    }

    const hadParcels = d.parcels.length > 0;
    progress.finish(doneUnits, "謄本資料建立完成");
    toast("謄本資料已匯入", "success");
    // 建立期間可能已切到別的案件:只有還停在同一案件時才刷新清冊 / 詢問匯入建物。
    if (state.currentProjectId !== pid) return;
    // 匯入後留在原本的分頁(清冊會自動刷新),不再自動跳到 OCR 批次詳情頁。
    // 要看批次可從「文件」分頁的謄本匯入批次進入。
    await renderTab(state.activeTab);
    const modalOpen = !!(document.getElementById("modal-root")?.innerHTML || "").trim();
    if (hadParcels && !modalOpen) offerBuildingImportFollowUp();
  } catch (err) {
    progress.fail(doneUnits, "已建立的資料會保留,請到清冊確認後再補匯入缺的部分");
  }
}

// Skip the per-地號/建號 walkthrough: create every record straight from the current
// (AI-parsed + whatever's been edited so far) data.
function oneClickCreateTitleDeed() {
  // 略過逐筆檢視,直接跳確認對話框(確定就送出建立)。
  confirmAndSubmitTitleDeedWizard();
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
          <td>${fmtArea(r.total_area_sqm)}</td>
          <td>${r.ownership_numerator}/${r.ownership_denominator}</td>
          <td>${fmtArea(r.owned_area_sqm)}</td>
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
          <td>${fmtArea(r.total_area_sqm)}</td>
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
