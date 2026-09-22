"use strict";

// 土地增值稅試算(土地稅法第 31/33/34 條)。輸入的「原規定地價/前次移轉現值」與「本次申報移轉現值」
// 都是「總額」(不是每平方公尺單價)- 地政士/地價稅通知書上列的通常就是總額,這樣使用者不用自己拿去乘面積。
// 這是概算工具,不是正式稅額 - 實際申報應以地方稅捐稽徵機關核算為準。

// 前次移轉現值的物價指數調整比例(%,以前次現值為基期100換算)沒有自動化資料來源 - 國稅局/
// 地方稅務局的「土地增值稅分算表」才有逐年精確數字,系統不生造假資料,改用 land_records.
// ltt_cpi_index 讓承辦人依單據手動輸入,留空視為100(不調整),維持原本可用的行為。
function _lttGain({ originalValue, currentValue, cpiIndex, deductibleCost }) {
  const idx = cpiIndex && cpiIndex > 0 ? cpiIndex : 100;
  const adjustedOriginal = originalValue * (idx / 100);
  // 漲價總數額 = 申報現值 − 調整後前次移轉現值(或原規定地價)− 改良土地費用等可扣除項目(土地稅法第31條)。
  const gain = Math.max(0, currentValue - adjustedOriginal - (deductibleCost || 0));
  return { idx, adjustedOriginal, gain };
}

// 依「前次移轉」與「本次申報移轉」年月(民國,格式如「95年12月」「115年」)推算持有年數。
// 只給整數年,月份不全時忽略月份精度(先以整年計,和分算表的差距最多1年,屬於本工具已知
// 的簡化範圍;需要精確結果時可在土地登記頁手動填「持有年限」覆寫這裡的自動計算)。
function parseMinguoPeriod(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,3})\s*年(?:\s*(\d{1,2})\s*月)?/);
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : null };
}

function calcHoldingYears(originalPeriod, currentPeriod) {
  const o = parseMinguoPeriod(originalPeriod);
  const c = parseMinguoPeriod(currentPeriod);
  if (!o || !c) return null;
  let years = c.year - o.year;
  if (o.month != null && c.month != null && c.month < o.month) years -= 1;
  return years >= 0 ? years : null;
}

// 土地稅法第33條長期持有減徵:超過20年未逾30年減徵20%,超過30年未逾40年減徵30%,超過40年減徵40%。
// 減徵只作用在「超過第一級最低稅率(20%)」的部分,所以稅率/速算扣除率公式都是
// 20% + (基礎值-20%)×(1-減徵比例)。
function lttHoldingReductionRate(years) {
  if (years == null) return 0;
  if (years >= 40) return 0.4;
  if (years >= 30) return 0.3;
  if (years >= 20) return 0.2;
  return 0;
}

// 一般稅率:依漲價倍數分三級(≤1倍20%、1~2倍30%、逾2倍40%),再套用累進差額扣除及長期持有減徵。
// 稅額 = 漲價總數額 × 稅率 − 調整後前次移轉現值 × 速算扣除率。
function calculateLandValueIncrementTax({ originalValue, currentValue, cpiIndex, deductibleCost, holdingYears }) {
  const { idx, adjustedOriginal, gain } = _lttGain({ originalValue, currentValue, cpiIndex, deductibleCost });
  const base = { adjustedOriginal, cpiIndex: idx, gain, holdingYears };
  if (originalValue <= 0 || gain <= 0) {
    return { ...base, ratio: 0, bracket: 0, baseRate: 0, rate: 0, deductionRate: 0, reductionRate: 0, totalTax: 0 };
  }
  const ratio = adjustedOriginal > 0 ? gain / adjustedOriginal : Infinity;
  let bracket, baseRate, baseDeductionRate;
  if (ratio <= 1) {
    bracket = 1; baseRate = 0.2; baseDeductionRate = 0;
  } else if (ratio <= 2) {
    bracket = 2; baseRate = 0.3; baseDeductionRate = 0.1;
  } else {
    bracket = 3; baseRate = 0.4; baseDeductionRate = 0.3;
  }
  const reductionRate = lttHoldingReductionRate(holdingYears);
  const rate = 0.2 + (baseRate - 0.2) * (1 - reductionRate);
  const deductionRate = baseDeductionRate * (1 - reductionRate);
  const totalTax = Math.max(0, gain * rate - adjustedOriginal * deductionRate);
  return { ...base, ratio, bracket, baseRate, rate, deductionRate, reductionRate, totalTax };
}

// 自用住宅用地優惠稅率(土地稅法第34條):不分級距、不適用長期持有減徵,漲價總數額統一按10%課徵。
function calculateLandValueIncrementTaxSelfUse({ originalValue, currentValue, cpiIndex, deductibleCost }) {
  const { idx, adjustedOriginal, gain } = _lttGain({ originalValue, currentValue, cpiIndex, deductibleCost });
  if (originalValue <= 0 || gain <= 0) {
    return { gain: 0, adjustedOriginal, cpiIndex: idx, rate: 0.1, totalTax: 0 };
  }
  return { gain, adjustedOriginal, cpiIndex: idx, rate: 0.1, totalTax: gain * 0.1 };
}

// 協議合建分屋比例:地主4、建商6 - 一般稅率試算出的稅額暫時先按這個比例分攤
// 顯示地主/建商各自負擔金額(先寫死,之後如果各案比例不同再改成案件設定)。
const LTT_GENERAL_SPLIT = { owner: 0.4, developer: 0.6 };

function landValueTaxRowResult(lr, liveValues) {
  if (!lr.ltt_original_value) return null;
  const live = liveValues && liveValues[lr.id];
  const ownedAreaSqm = Number(lr.owned_area_sqm) || 0;
  // ltt_original_value / ltt_current_value 存的是謄本上的單價(元/㎡),不是總額 - 稅額試算
  // 需要的是這筆持分的總金額,在這裡現算(單價 × owned_area_sqm),不要求存進資料庫的欄位
  // 就已經是總額,避免持分面積事後被改動時,舊的換算結果沒有跟著更新。一律以謄本存的
  // 單價為準,不用臺北市開放資料即時查詢覆蓋 - 即時查詢的年度/資料版本跟謄本記載的
  // 那次可能對不起來,使用者要能穩定核對「這個數字是不是我謄本上看到的那個」。
  const currentValue = (Number(lr.ltt_current_value) || 0) * ownedAreaSqm;
  const currentPeriod = lr.ltt_current_value_period;
  const holdingYears = lr.ltt_holding_years ?? calcHoldingYears(lr.ltt_original_value_period, currentPeriod);
  const cpiAuto = !lr.ltt_cpi_index && !!(live && live.cpi_index);
  const params = {
    originalValue: (Number(lr.ltt_original_value) || 0) * ownedAreaSqm,
    currentValue,
    cpiIndex: Number(lr.ltt_cpi_index) || (live && live.cpi_index) || null,
    deductibleCost: Number(lr.ltt_deductible_cost) || 0,
  };
  return {
    general: calculateLandValueIncrementTax({ ...params, holdingYears }),
    selfUse: calculateLandValueIncrementTaxSelfUse(params),
    currentValue,
    currentPeriod,
    holdingYears,
    cpiAuto,
  };
}

// ================= 頁面(版面比照設計稿:標題+插圖、篩選列、可展開清單、分頁) =================

const LTT_DEFAULT_SPLIT = { owner: 0.4, developer: 0.6 };

// 協議合建分攤比例是每案自己談的,存在瀏覽器(依案件分開記),按「試算設定」可調;沒設過就用預設4/6。
function lttLoadSplitSetting(pid) {
  let owner = LTT_DEFAULT_SPLIT.owner;
  try {
    const v = parseFloat(localStorage.getItem(`ltt_split_owner_${pid}`));
    if (v >= 0 && v <= 1) owner = v;
  } catch (e) {
    // localStorage 不能用就維持預設
  }
  LTT_GENERAL_SPLIT.owner = owner;
  LTT_GENERAL_SPLIT.developer = 1 - owner;
}

function lttSplitLabel() {
  const o = Math.round(LTT_GENERAL_SPLIT.owner * 100);
  return o % 10 === 0 ? `${o / 10}/${10 - o / 10}` : `${o}%/${100 - o}%`;
}

const _lttSvg = (body, size = 18, sw = 1.9) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const LTT_ICON = {
  calc: _lttSvg(`<rect x="5" y="3" width="14" height="18" rx="2.5"/><rect x="8" y="6" width="8" height="3.5" rx=".8"/><path d="M8.5 13.2h.01M12 13.2h.01M15.5 13.2h.01M8.5 16.8h.01M12 16.8h.01M15.5 16.8h.01" stroke-width="2.6"/>`, 26, 1.7),
  gear: _lttSvg(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`, 17, 1.8),
  download: _lttSvg(`<path d="M12 3v12M7 10.5l5 5 5-5M4 20h16"/>`, 17),
  trend: _lttSvg(`<path d="M3 17l5.5-5.5 4 4L21 7"/><path d="M15 7h6v6"/>`, 18, 2.1),
  info: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M12 11v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.4" fill="#fff"/></svg>`,
  search: _lttSvg(`<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`, 22, 2.1),
  list: _lttSvg(`<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="3"/>`, 20, 2),
  grid: _lttSvg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`, 20),
  filter: _lttSvg(`<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>`, 18),
  chevDown: _lttSvg(`<path d="M6 9l6 6 6-6"/>`, 16, 2.2),
  chevUp: _lttSvg(`<path d="M6 15l6-6 6 6"/>`, 16, 2.2),
  chevLeft: _lttSvg(`<path d="M15 6l-6 6 6 6"/>`, 16, 2.2),
  chevRight: _lttSvg(`<path d="M9 6l6 6-6 6"/>`, 16, 2.2),
  doc: _lttSvg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>`, 16, 1.8),
  more: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>`,
};

const lttUiDefaults = () => ({
  q: "", section: "", status: "", view: window.innerWidth < 900 ? "grid" : "list", sort: "seq", onlySaving: false, advOpen: false,
  page: 1, pageSize: 10, expanded: new Set(),
});
let lttUi = lttUiDefaults();
// pid: 換案件才重置篩選/頁碼;token: 讓過期的非同步查詢結果不會蓋掉新的畫面。
let lttCtx = { pid: null, token: 0, el: null, landOwners: [], liveValues: {}, summaries: [] };

const LTT_STATUS_LABEL = { done: "已試算", part: "部分試算", none: "未試算" };
const _lttFmt = (n) => Math.round(n).toLocaleString();

function _lttSectionLabel(lr) {
  return [lr.section, lr.subsection].filter(Boolean).join("") || "(未填地段)";
}

function lttBuildSummaries(landOwners, liveValues) {
  return landOwners.map((o, i) => {
    const parcels = (o.land_records || []).map((lr) => {
      const result = landValueTaxRowResult(lr, liveValues);
      const area = Number(lr.owned_area_sqm) || 0;
      const currentValue = result ? result.currentValue : (Number(lr.ltt_current_value) || 0) * area;
      const unitPrice = Number(lr.ltt_current_value) || null;
      const selfTax = result ? result.selfUse.totalTax : 0;
      const generalTax = result ? result.general.totalTax : 0;
      return { record: lr, result, currentValue, area, unitPrice, selfTax, generalTax, savings: Math.max(0, generalTax - selfTax) };
    });
    const filled = parcels.filter((p) => p.result).length;
    const sum = (k) => parcels.reduce((s, p) => s + p[k], 0);
    return {
      owner: o,
      seq: String(i + 1).padStart(3, "0"),
      parcels,
      status: filled === 0 ? "none" : filled === parcels.length ? "done" : "part",
      area: sum("area"),
      currentValue: sum("currentValue"),
      selfTax: sum("selfTax"),
      generalTax: sum("generalTax"),
      savings: Math.max(0, sum("generalTax") - sum("selfTax")),
    };
  });
}

async function renderLandValueTaxTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = landowners;

  // 編號與排序都跟「土地登記清冊」對齊:同一份 landowners 順序,編號 = 該地主在清冊裡的序位
  // (有土地登記的地主),同一地主的多筆土地登記共用同一個編號。
  const landOwners = landowners.filter((o) => (o.land_records || []).length > 0);
  const parcelCount = landOwners.reduce((n, o) => n + o.land_records.length, 0);

  if (!parcelCount) {
    el.innerHTML = `<div class="empty-state">尚無土地登記資料,請先於「土地登記」頁籤匯入資料</div>`;
    return;
  }

  lttLoadSplitSetting(pid);
  if (lttCtx.pid !== pid) lttUi = lttUiDefaults();
  const token = lttCtx.token + 1;
  // 「重新試算」會重跑整個 render,上一輪查到的即時現值先留著顯示,新的查完再換,畫面不會閃成空白。
  const keepLive = lttCtx.pid === pid ? lttCtx.liveValues : {};
  lttCtx = { pid, token, el, landOwners, liveValues: keepLive, summaries: lttBuildSummaries(landOwners, keepLive) };

  const sections = [...new Set(landOwners.flatMap((o) => o.land_records.map(_lttSectionLabel)))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  if (lttUi.section && !sections.includes(lttUi.section)) lttUi.section = "";

  el.innerHTML = `
    <div class="lv-page">
      <div class="lv-head">
        <div class="lv-title-area">
          <span class="lv-title-icon">${LTT_ICON.calc}</span>
          <div>
            <div class="lv-title-line"><h2 class="lv-title">土地增值稅試算</h2><span class="lv-pill">自用／一般稅率同時試算</span></div>
            <div class="lv-sub-title">共 ${landOwners.length} 位地主 / ${parcelCount} 筆土地登記</div>
          </div>
        </div>
        <div class="lv-head-actions">
          <button type="button" class="lv-hbtn" id="lv-settings-btn">${LTT_ICON.gear}試算設定</button>
          <button type="button" class="lv-hbtn" id="lv-export-btn">${LTT_ICON.download}匯出報表</button>
          <button type="button" class="lv-hbtn lv-hbtn-primary" id="lv-recalc-btn">${LTT_ICON.trend}重新試算</button>
        </div>
        <div class="lv-note"><span class="lv-note-ic">${LTT_ICON.info}</span><span id="ltt-tab-note">僅供參考,實際應納土地增值稅仍以主管稽徵機關核定金額為準。本月申報移轉現值查詢中…</span></div>
        <div class="lv-deco" aria-hidden="true">
          <div class="lv-slogan">透明試算<br>協助都更更順利!<svg viewBox="0 0 220 14" class="lv-slogan-line"><path d="M2 11 C 60 3, 140 3, 218 1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
          <svg class="lv-city" viewBox="0 0 380 210" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="lvBld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0ec"/><stop offset="1" stop-color="#e8f1f6"/></linearGradient>
              <pattern id="lvWin" width="14" height="16" patternUnits="userSpaceOnUse"><rect x="3" y="4" width="8" height="8" rx="1" fill="#ffffff" opacity=".75"/></pattern>
            </defs>
            <rect x="10" y="196" width="360" height="8" rx="4" fill="#dfe8ee"/>
            <rect x="30" y="90" width="70" height="106" fill="url(#lvBld)"/><rect x="30" y="90" width="70" height="106" fill="url(#lvWin)"/>
            <rect x="112" y="40" width="84" height="156" fill="url(#lvBld)"/><rect x="112" y="40" width="84" height="156" fill="url(#lvWin)"/>
            <rect x="208" y="10" width="66" height="186" fill="url(#lvBld)"/><rect x="208" y="10" width="66" height="186" fill="url(#lvWin)"/>
            <rect x="286" y="70" width="70" height="126" fill="url(#lvBld)"/><rect x="286" y="70" width="70" height="126" fill="url(#lvWin)"/>
            <g fill="#7cc7a4"><circle cx="24" cy="170" r="17"/><circle cx="100" cy="172" r="15"/><circle cx="200" cy="176" r="14"/><circle cx="352" cy="168" r="17"/></g>
            <g fill="#4faa86" opacity=".85"><circle cx="30" cy="164" r="11"/><circle cx="106" cy="168" r="10"/><circle cx="346" cy="162" r="11"/></g>
            <g stroke="#a98b6b" stroke-width="3" stroke-linecap="round"><path d="M24 186v10M100 186v10M200 190v6M352 184v12"/></g>
          </svg>
        </div>
      </div>

      <div class="lv-toolbar">
        <div class="lv-search">${LTT_ICON.search}<input type="search" id="lv-q" placeholder="搜尋地主姓名、地號..." autocomplete="off" value="${escapeHtml(lttUi.q)}"></div>
        <select class="lv-select" id="lv-section">
          <option value="">全部地段</option>
          ${sections.map((s) => `<option value="${escapeHtml(s)}"${s === lttUi.section ? " selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <select class="lv-select" id="lv-status">
          <option value="">全部狀態</option>
          ${Object.entries(LTT_STATUS_LABEL).map(([k, v]) => `<option value="${k}"${k === lttUi.status ? " selected" : ""}>${v}</option>`).join("")}
        </select>
        <div class="lv-toolbar-right">
          <div class="lv-viewtoggle" role="group" aria-label="檢視方式">
            <button type="button" data-lv-view="list" title="清單檢視">${LTT_ICON.list}</button>
            <button type="button" data-lv-view="grid" title="卡片檢視">${LTT_ICON.grid}</button>
          </div>
          <button type="button" class="lv-advbtn" id="lv-adv-btn">${LTT_ICON.filter}<span>進階篩選</span><span class="lv-adv-caret">${LTT_ICON.chevDown}</span></button>
        </div>
      </div>

      <div class="lv-adv hidden" id="lv-adv">
        <div class="lv-adv-field"><span>排序</span>
          <select class="lv-select lv-select-sm" id="lv-sort">
            <option value="seq">依編號</option>
            <option value="general">一般稅額 高 → 低</option>
            <option value="savings">節省金額 高 → 低</option>
            <option value="value">申報移轉現值 高 → 低</option>
          </select>
        </div>
        <label class="lv-check"><input type="checkbox" id="lv-only-saving"> 只看自用比一般有節省的</label>
        <button type="button" class="lv-adv-reset" id="lv-adv-reset">清除全部篩選</button>
      </div>

      <div class="lv-list-card"><div id="lv-list"></div></div>
      <div class="lv-foot" id="lv-foot"></div>
    </div>`;

  lttWirePage(el.querySelector(".lv-page"));
  lttSyncControls(el);
  lttRenderList();

  // 本次申報移轉現值一律採用「土地登記」頁存的謄本單價(不再呼叫臺北市開放資料即時
  // 查詢覆蓋)- 即時查詢的年度/資料版本可能跟使用者謄本記載的那次對不上,直接照謄本
  // 存的值算,使用者才能穩定核對「這個數字是不是我謄本上看到的那個」。
  let liveValues = {};
  const note = "本次申報移轉現值採用「土地登記」頁存的謄本單價計算;請確認該欄位已依謄本填妥。";

  let cpiNote = "";
  try {
    const cpiLookup = await api(`/projects/${pid}/landowners/ltt-cpi-index-lookup-all`, { silent: true });
    if (cpiLookup.error) {
      cpiNote = "⚠ 物價指數(主計總處官方換算表)自動查詢失敗,暫以 100% 計算,前次移轉現值未做物價調整,稅額會偏高。";
    } else {
      Object.entries(cpiLookup.records || {}).forEach(([id, v]) => {
        liveValues[id] = { ...(liveValues[id] || {}), cpi_index: v.cpi_index };
      });
      if (cpiLookup.asof_label) {
        cpiNote = `物價指數調整比例已自動依主計總處${escapeHtml(cpiLookup.asof_label)}公告換算表帶入,已手動填過的維持手動值。`;
      }
    }
  } catch (err) {
    // 查不到就維持原本手動輸入的物價指數(或不調整),不影響其他試算結果。
  }

  // 查詢期間使用者已經切走分頁/案件,或又按了一次重新試算,這一輪的結果就作廢。
  if (lttCtx.token !== token || !el.isConnected) return;
  lttCtx.liveValues = liveValues;
  lttCtx.summaries = lttBuildSummaries(landOwners, liveValues);
  const noteEl = el.querySelector("#ltt-tab-note");
  if (noteEl) noteEl.innerHTML = `僅供參考,實際應納土地增值稅仍以主管稽徵機關核定金額為準。${note}${cpiNote}`;
  lttRenderList();
}

// 把目前的篩選狀態同步回控制項(重新渲染整頁時用)。
function lttSyncControls(el) {
  el.querySelectorAll("[data-lv-view]").forEach((b) => b.classList.toggle("active", b.dataset.lvView === lttUi.view));
  el.querySelector("#lv-sort").value = lttUi.sort;
  el.querySelector("#lv-only-saving").checked = lttUi.onlySaving;
  el.querySelector("#lv-adv").classList.toggle("hidden", !lttUi.advOpen);
  el.querySelector("#lv-adv-btn").classList.toggle("open", lttUi.advOpen);
}

function lttWirePage(page) {
  const $ = (sel) => page.querySelector(sel);
  const refresh = () => {
    lttUi.page = 1;
    lttRenderList();
  };
  $("#lv-q").addEventListener("input", (e) => { lttUi.q = e.target.value; refresh(); });
  $("#lv-section").addEventListener("change", (e) => { lttUi.section = e.target.value; refresh(); });
  $("#lv-status").addEventListener("change", (e) => { lttUi.status = e.target.value; refresh(); });
  $("#lv-sort").addEventListener("change", (e) => { lttUi.sort = e.target.value; refresh(); });
  $("#lv-only-saving").addEventListener("change", (e) => { lttUi.onlySaving = e.target.checked; refresh(); });
  $("#lv-adv-btn").addEventListener("click", () => {
    lttUi.advOpen = !lttUi.advOpen;
    lttSyncControls(page);
  });
  $("#lv-adv-reset").addEventListener("click", () => {
    Object.assign(lttUi, { q: "", section: "", status: "", sort: "seq", onlySaving: false, page: 1 });
    $("#lv-q").value = "";
    $("#lv-section").value = "";
    $("#lv-status").value = "";
    lttSyncControls(page);
    lttRenderList();
  });
  $("#lv-settings-btn").addEventListener("click", openLttSettingsModal);
  $("#lv-export-btn").addEventListener("click", () => lttExportCsv(lttFilteredSummaries(), "土地增值稅試算"));
  $("#lv-recalc-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.lastChild.textContent = "試算中…";
    // renderLandValueTaxTab 每次都會重新向政府開放資料/主計總處查一次,舊的即時現值先留著顯示。
    try {
      await renderLandValueTaxTab(lttCtx.el);
      toast("已重新試算", "success");
    } catch (err) {
      btn.disabled = false;
      btn.lastChild.textContent = "重新試算";
    }
  });

  // 清單/卡片內的所有互動都走事件委派,清單重繪不用重新綁。
  const list = $("#lv-list");
  list.addEventListener("click", (e) => {
    const t = e.target;
    const detailBtn = t.closest("[data-lv-detail]");
    if (detailBtn) return openLttDetailModal(Number(detailBtn.dataset.lvDetail), null);
    const parcelBtn = t.closest("[data-lv-parcel]");
    if (parcelBtn) return openLttDetailModal(Number(parcelBtn.dataset.lvOwner), Number(parcelBtn.dataset.lvParcel));
    const moreBtn = t.closest("[data-lv-more]");
    if (moreBtn) return lttOpenMoreMenu(moreBtn, Number(moreBtn.dataset.lvMore));
    const row = t.closest("[data-lv-toggle]");
    if (row) lttToggleRow(row);
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest && e.target.closest("[data-lv-toggle]");
    if (row && e.target === row) {
      e.preventDefault();
      lttToggleRow(row);
    }
  });
  page.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-lv-view]");
    if (viewBtn) {
      lttUi.view = viewBtn.dataset.lvView;
      lttSyncControls(page);
      lttRenderList();
      return;
    }
    const pg = e.target.closest("[data-lv-page]");
    if (pg && !pg.disabled) {
      lttUi.page = Number(pg.dataset.lvPage);
      lttRenderList();
    }
  });
  page.addEventListener("change", (e) => {
    if (e.target.id === "lv-page-size") {
      lttUi.pageSize = Number(e.target.value);
      lttUi.page = 1;
      lttRenderList();
    }
  });
}

function lttToggleRow(row) {
  const wrap = row.closest(".lv-row-wrap");
  const id = Number(wrap.dataset.lvOwner);
  const open = !wrap.classList.contains("open");
  wrap.classList.toggle("open", open);
  row.setAttribute("aria-expanded", String(open));
  if (open) lttUi.expanded.add(id);
  else lttUi.expanded.delete(id);
}

function lttFilteredSummaries() {
  const q = lttUi.q.trim().toLowerCase();
  let rows = lttCtx.summaries.filter((s) => {
    if (lttUi.status && s.status !== lttUi.status) return false;
    if (lttUi.section && !s.parcels.some((p) => _lttSectionLabel(p.record) === lttUi.section)) return false;
    if (lttUi.onlySaving && !(s.savings > 0)) return false;
    if (q) {
      const hay = [s.owner.name, s.seq, ...s.parcels.map((p) => p.record.parcel_number)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sorters = {
    general: (a, b) => b.generalTax - a.generalTax,
    savings: (a, b) => b.savings - a.savings,
    value: (a, b) => b.currentValue - a.currentValue,
  };
  if (sorters[lttUi.sort]) rows = [...rows].sort(sorters[lttUi.sort]);
  return rows;
}

// 頁碼列:永遠有第1/最後一頁,目前頁前後各1頁,離開頭近時顯示前5頁,中間隔太遠用「…」。
function lttPageItems(cur, total) {
  const keep = new Set([1, 2, total, cur - 1, cur, cur + 1]);
  if (cur <= 3) [3, 4, 5].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i > 0) {
      const gap = n - nums[i - 1];
      if (gap === 2) out.push(n - 1);
      else if (gap > 2) out.push("…");
    }
    out.push(n);
  });
  return out;
}

function lttRenderList() {
  const el = lttCtx.el;
  const listEl = el && el.querySelector("#lv-list");
  if (!listEl) return;
  const filtered = lttFilteredSummaries();
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / lttUi.pageSize));
  if (lttUi.page > pages) lttUi.page = pages;
  const start = (lttUi.page - 1) * lttUi.pageSize;
  const slice = filtered.slice(start, start + lttUi.pageSize);

  listEl.className = lttUi.view === "grid" ? "lv-grid" : "lv-scroll";
  listEl.innerHTML = !total
    ? `<div class="empty-state">沒有符合條件的地主</div>`
    : lttUi.view === "grid"
      ? slice.map(lttCardHtml).join("")
      : `<div class="lv-table">
          <div class="lv-cols lv-thead"><div>編號</div><div>地主</div><div>土地筆數</div><div class="lv-right">本次申報移轉現值(元)</div><div>稅額試算 (自用／一般／節省)</div><div class="lv-center">狀態</div><div class="lv-center">操作</div></div>
          ${slice.map(lttRowHtml).join("")}
        </div>`;

  const pageBtn = (label, n, opts = {}) =>
    `<button type="button" class="lv-pg${opts.active ? " active" : ""}${opts.arrow ? " lv-pg-arrow" : ""}" data-lv-page="${n}"${opts.disabled ? " disabled" : ""}${opts.aria ? ` aria-label="${opts.aria}"` : ""}>${label}</button>`;
  const items = lttPageItems(lttUi.page, pages)
    .map((n) => (n === "…" ? `<span class="lv-pg-gap">…</span>` : pageBtn(n, n, { active: n === lttUi.page })))
    .join("");
  el.querySelector("#lv-foot").innerHTML = `
    <div class="lv-foot-info">${total ? `顯示 ${start + 1} - ${start + slice.length} 筆,共 ${total} 筆` : "共 0 筆"}</div>
    <div class="lv-pager">
      ${pageBtn(LTT_ICON.chevLeft, lttUi.page - 1, { arrow: true, disabled: lttUi.page <= 1, aria: "上一頁" })}
      ${items}
      ${pageBtn(LTT_ICON.chevRight, lttUi.page + 1, { arrow: true, disabled: lttUi.page >= pages, aria: "下一頁" })}
    </div>
    <div class="lv-foot-size"><span>每頁顯示</span>
      <select class="lv-select lv-select-sm" id="lv-page-size">${[5, 10, 20, 50].map((n) => `<option value="${n}"${n === lttUi.pageSize ? " selected" : ""}>${n}</option>`).join("")}</select>
    </div>`;
}

function lttStatusChipHtml(status) {
  return `<span class="lv-status lv-status-${status}">${LTT_STATUS_LABEL[status]}</span>`;
}

// 一列的稅額欄:自用(綠)／一般(深)／節省(紅)並排;沒輸入前次移轉現值就顯示提示,不硬塞 0 元。
function lttTaxLineHtml(s) {
  if (s.status === "none") return `<span class="lv-muted">尚未輸入前次移轉現值</span>`;
  return (
    `<span class="lv-tax-item"><em>自用</em><b class="lv-c-self">約 ${_lttFmt(s.selfTax)} 元</b></span>` +
    `<span class="lv-tax-sep"></span>` +
    `<span class="lv-tax-item"><em>一般</em><b>約 ${_lttFmt(s.generalTax)} 元</b></span>` +
    `<span class="lv-tax-sep"></span>` +
    `<span class="lv-tax-item"><em class="lv-c-save">節省</em><b class="lv-c-save">約 ${_lttFmt(s.savings)} 元</b></span>`
  );
}

function lttActionsHtml(s) {
  return `<button type="button" class="lv-btn-detail" data-lv-detail="${s.owner.id}">${LTT_ICON.doc}查看明細</button>
    <button type="button" class="lv-more" data-lv-more="${s.owner.id}" aria-label="更多">${LTT_ICON.more}</button>`;
}

function lttRowHtml(s) {
  const open = lttUi.expanded.has(s.owner.id);
  return `
    <div class="lv-row-wrap${open ? " open" : ""}" data-lv-owner="${s.owner.id}">
      <div class="lv-cols lv-row" data-lv-toggle="1" role="button" tabindex="0" aria-expanded="${open}">
        <div class="lv-c-seq"><span class="lv-chev">${LTT_ICON.chevDown}</span>${s.seq}</div>
        <div class="lv-c-name">${escapeHtml(s.owner.name)}</div>
        <div class="lv-c-count"><span class="lv-count-pill">${s.parcels.length} 筆土地</span><span class="lv-chev-up">${LTT_ICON.chevDown}</span></div>
        <div class="lv-right lv-c-value">${s.currentValue ? _lttFmt(s.currentValue) : `<span class="lv-muted">-</span>`}</div>
        <div class="lv-c-tax">${lttTaxLineHtml(s)}</div>
        <div class="lv-center">${lttStatusChipHtml(s.status)}</div>
        <div class="lv-c-act">${lttActionsHtml(s)}</div>
      </div>
      <div class="lv-sub">${lttSubTableHtml(s)}</div>
    </div>`;
}

function lttSubTableHtml(s) {
  const num = (v, fmt) => (v ? fmt(v) : `<span class="lv-muted">—</span>`);
  const body = s.parcels
    .map((p, i) => {
      const r = p.result;
      return `<tr>
        <td class="lv-center">${i + 1}</td>
        <td class="lv-parcel">${escapeHtml(p.record.parcel_number) || "-"}</td>
        <td class="num">${num(p.area, (v) => v.toFixed(2))}</td>
        <td class="num">${num(p.unitPrice, _lttFmt)}</td>
        <td class="num">${num(p.currentValue, _lttFmt)}</td>
        <td class="num">${r ? _lttFmt(p.selfTax) : `<span class="lv-muted">—</span>`}</td>
        <td class="num">${r ? _lttFmt(p.generalTax) : `<span class="lv-muted">—</span>`}</td>
        <td class="num">${r ? `<span class="lv-c-save">${_lttFmt(p.savings)}</span>` : `<span class="lv-muted">—</span>`}</td>
        <td class="lv-center"><button type="button" class="lv-btn-detail lv-btn-sm" data-lv-parcel="${p.record.id}" data-lv-owner="${s.owner.id}">${LTT_ICON.doc}查看詳情</button></td>
      </tr>`;
    })
    .join("");
  const anyTax = s.status !== "none";
  return `
    <div class="lv-sub-scroll"><table class="lv-sub-table">
      <thead><tr><th class="lv-center">項次</th><th>地號</th><th class="num">持分面積(㎡)</th><th class="num">公告現值(元/㎡)</th><th class="num">本次申報移轉現值(元)</th><th class="num">自用稅額(元)</th><th class="num">一般稅額(元)</th><th class="num">節省稅額(元)</th><th class="lv-center">操作</th></tr></thead>
      <tbody>${body}
        <tr class="lv-subtotal"><td colspan="2" class="lv-center">小計(${escapeHtml(s.owner.name)})</td>
          <td class="num">${s.area ? s.area.toFixed(2) : "—"}</td><td class="num">—</td>
          <td class="num">${s.currentValue ? _lttFmt(s.currentValue) : "—"}</td>
          <td class="num">${anyTax ? _lttFmt(s.selfTax) : "—"}</td>
          <td class="num">${anyTax ? _lttFmt(s.generalTax) : "—"}</td>
          <td class="num"><span class="lv-c-save">${anyTax ? _lttFmt(s.savings) : "—"}</span></td>
          <td class="lv-center">—</td></tr>
      </tbody>
    </table></div>
    ${anyTax && s.generalTax ? lttGeneralSplitHtml(s.generalTax) : ""}`;
}

function lttCardHtml(s) {
  return `
    <div class="lv-card">
      <div class="lv-card-top"><span class="lv-card-seq">${s.seq}</span><span class="lv-card-name">${escapeHtml(s.owner.name)}</span>${lttStatusChipHtml(s.status)}</div>
      <div class="lv-card-meta"><span class="lv-count-pill">${s.parcels.length} 筆土地</span><span>申報移轉現值 <b>${s.currentValue ? _lttFmt(s.currentValue) : "-"}</b> 元</span></div>
      <div class="lv-card-tax">${lttTaxLineHtml(s)}</div>
      <div class="lv-card-act">${lttActionsHtml(s)}</div>
    </div>`;
}

// 「…」選單:貼在按鈕下方的浮動小選單(fixed 定位,不會被清單的橫向捲動容器切掉)。
function lttCloseMoreMenu() {
  const m = document.getElementById("lv-more-menu");
  if (m) {
    m._cleanup && m._cleanup();
    m.remove();
  }
}

function lttOpenMoreMenu(btn, ownerId) {
  lttCloseMoreMenu();
  const s = lttCtx.summaries.find((x) => x.owner.id === ownerId);
  if (!s) return;
  const menu = document.createElement("div");
  menu.className = "lv-menu";
  menu.id = "lv-more-menu";
  menu.innerHTML = `<button type="button" data-act="copy">複製試算摘要</button><button type="button" data-act="csv">匯出此地主 CSV</button>`;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    lttCloseMoreMenu();
    if (act === "csv") return lttExportCsv([s], `土地增值稅試算_${s.owner.name}`);
    try {
      await navigator.clipboard.writeText(lttSummaryText(s));
      toast("已複製試算摘要", "success");
    } catch (err) {
      toast("瀏覽器不允許複製,請改用「查看明細」自行選取", "error");
    }
  });
  const onDown = (ev) => { if (!menu.contains(ev.target)) lttCloseMoreMenu(); };
  const onScroll = () => lttCloseMoreMenu();
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  menu._cleanup = () => {
    document.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  };
}

function lttSummaryText(s) {
  const lines = [`${s.seq} ${s.owner.name}(${s.parcels.length} 筆土地,${LTT_STATUS_LABEL[s.status]})`];
  lines.push(`本次申報移轉現值:${_lttFmt(s.currentValue)} 元`);
  if (s.status !== "none") {
    lines.push(`自用稅額:約 ${_lttFmt(s.selfTax)} 元`, `一般稅額:約 ${_lttFmt(s.generalTax)} 元`, `自用比一般省:約 ${_lttFmt(s.savings)} 元`);
  }
  lines.push("(僅供參考,實際應納稅額以主管稽徵機關核定為準)");
  return lines.join("\n");
}

// 匯出成 CSV(Excel 可直接開,加 BOM 避免中文亂碼),一筆土地登記一列。
function lttExportCsv(summaries, baseName) {
  if (!summaries.length) {
    toast("目前沒有可匯出的資料", "error");
    return;
  }
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["編號", "地主", "地號", "持分面積(㎡)", "公告現值(元/㎡)", "本次申報移轉現值(元)", "自用稅額(元)", "一般稅額(元)", "節省稅額(元)", "狀態"];
  const lines = [head.map(esc).join(",")];
  summaries.forEach((s) =>
    s.parcels.forEach((p) => {
      const has = !!p.result;
      lines.push(
        [
          s.seq, s.owner.name, p.record.parcel_number, p.area ? p.area.toFixed(2) : "", p.unitPrice ? Math.round(p.unitPrice) : "",
          p.currentValue ? Math.round(p.currentValue) : "", has ? Math.round(p.selfTax) : "", has ? Math.round(p.generalTax) : "",
          has ? Math.round(p.savings) : "", has ? "已試算" : "未試算",
        ].map(esc).join(",")
      );
    })
  );
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openLttSettingsModal() {
  const pid = lttCtx.pid;
  const ownerPct = Math.round(LTT_GENERAL_SPLIT.owner * 100);
  openModal(
    "試算設定",
    `<div class="field"><label>協議合建稅額分攤比例 - 地主負擔(%)</label>
       <input type="number" id="lv-split-owner" min="0" max="100" step="1" value="${ownerPct}">
       <div class="helper-text" style="margin-top:6px">建商負擔:<b id="lv-split-dev">${100 - ownerPct}</b>%。只影響展開明細裡「協議合建分攤」那一行顯示的地主/建商金額,不改變稅額本身。</div>
     </div>
     <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
       <button type="button" class="btn-secondary" id="lv-split-reset">恢復預設(4/6)</button>
       <button type="button" class="btn-primary" id="lv-split-save">儲存</button>
     </div>`,
    { width: "440px" }
  );
  const input = document.getElementById("lv-split-owner");
  const devEl = document.getElementById("lv-split-dev");
  const clamp = () => Math.min(100, Math.max(0, Math.round(Number(input.value) || 0)));
  input.addEventListener("input", () => { devEl.textContent = String(100 - clamp()); });
  const apply = (owner) => {
    try {
      localStorage.setItem(`ltt_split_owner_${pid}`, String(owner));
    } catch (e) {
      // 存不了就只在這次瀏覽有效
    }
    LTT_GENERAL_SPLIT.owner = owner;
    LTT_GENERAL_SPLIT.developer = 1 - owner;
    closeModal();
    lttRenderList();
    toast("已更新分攤比例", "success");
  };
  document.getElementById("lv-split-save").addEventListener("click", () => apply(clamp() / 100));
  document.getElementById("lv-split-reset").addEventListener("click", () => apply(LTT_DEFAULT_SPLIT.owner));
}

// 「查看明細/查看詳情」:每筆土地登記的完整算法(前次移轉現值 → 物價指數 → 漲價總數額 → 倍數/持有年限 → 稅額)。
function openLttDetailModal(ownerId, recordId) {
  const s = lttCtx.summaries.find((x) => x.owner.id === ownerId);
  if (!s) return;
  const parcels = recordId ? s.parcels.filter((p) => p.record.id === recordId) : s.parcels;
  const doorMap = new Map();
  (s.owner.building_records || []).forEach((r) => {
    const label = _shortDoorAddr(r.address);
    if (label && !doorMap.has(label)) doorMap.set(label, /房屋地下/.test(r.address || ""));
  });
  const doorHtml = doorMap.size
    ? [...doorMap.entries()]
        .map(([a, shared]) =>
          shared
            ? `<span class="mini-badge mini-badge-shared-door" title="依持分比例登記的地下室/車位建號,非專屬住家門牌">${escapeHtml(a)}(地下持分)</span>`
            : `<span class="mini-badge">${escapeHtml(a)}</span>`
        )
        .join("")
    : "";
  const parcelHtml = parcels
    .map((p) => {
      const lr = p.record;
      // 一律照謄本存的單價換算(不再用臺北市開放資料即時查詢覆蓋),跟 landValueTaxRowResult
      // 算稅額用的是同一份數字,這裡看到的總額才會跟稅額試算的依據對得起來。
      const currentCell = `${lr.ltt_current_value_period ? `<div class="ltt-current-period">${escapeHtml(lr.ltt_current_value_period)}</div>` : ""}<div class="ltt-current-amount">${lr.ltt_current_value ? `${Math.round(Number(lr.ltt_current_value) * p.area).toLocaleString()} 元<span>單價 ${Number(lr.ltt_current_value).toLocaleString()} 元/m²</span>` : "-"}</div>`;
      return `
        <div class="lv-dt-parcel">
          <div class="lv-dt-parcel-title">地號 ${escapeHtml(lr.parcel_number) || "-"}${lr.registration_order ? `<span>次序 ${escapeHtml(lr.registration_order)}</span>` : ""}</div>
          <div class="lv-dt-grid">
            <div><div class="lv-dt-cap">計算明細</div>${lttDetailCellHtml(lr, p.result)}</div>
            <div class="ltt-current-cell"><div class="lv-dt-cap">本次申報移轉現值</div>${currentCell}</div>
            <div class="ltt-result-cell"><div class="lv-dt-cap">稅額試算</div>${lttResultCellHtml(p.result)}</div>
          </div>
        </div>`;
    })
    .join("");
  openModal(
    `${escapeHtml(s.owner.name)} · 土增稅試算明細`,
    `${doorHtml ? `<div class="lv-dt-doors">${doorHtml}${_floorsCellHtml(s.owner.building_records)}</div>` : ""}${parcelHtml}
     <div class="helper-text" style="margin-top:12px">僅供參考,實際應納土地增值稅仍以主管稽徵機關核定金額為準。</div>`,
    { width: "820px" }
  );
}

function lttDetailRow(label, value, opts = {}) {
  return `<div class="ltt-detail-row${opts.muted ? " is-muted" : ""}${opts.strong ? " is-strong" : ""}"><span class="ltt-detail-label">${label}</span><span class="ltt-detail-value">${value}</span></div>`;
}

function lttGeneralSplitHtml(generalTax) {
  if (!generalTax) return "";
  const ownerShare = generalTax * LTT_GENERAL_SPLIT.owner;
  const developerShare = generalTax * LTT_GENERAL_SPLIT.developer;
  return `<div class="ltt-split-badge">協議合建${lttSplitLabel()}分攤 · 地主 ${Math.round(ownerShare).toLocaleString()} 元 / 建商 ${Math.round(developerShare).toLocaleString()} 元</div>`;
}

// 計算明細欄:把「前次移轉現值 → 物價指數調整 → 調整後前次移轉現值 → 漲價總數額 → 漲價倍數
// → 持有年限」每一步都列出來,使用者可以核對系統是怎麼算出稅額的,不是黑盒子。
function lttDetailCellHtml(record, result) {
  if (!result) return `<span class="helper-text">尚未輸入前次移轉現值</span>`;
  const fmt = (n) => Math.round(n).toLocaleString();
  const g = result.general;
  const rows = [];
  // record.ltt_original_value 是謄本單價(元/㎡),這裡顯示的是這筆持分的總額(單價 × owned_area_sqm),
  // 跟 landValueTaxRowResult 算 g.adjustedOriginal 用的是同一份換算後總額,兩者對得起來。
  const originalTotal = (Number(record.ltt_original_value) || 0) * (Number(record.owned_area_sqm) || 0);
  rows.push(
    lttDetailRow(
      record.ltt_original_value_period ? escapeHtml(record.ltt_original_value_period) : "前次移轉現值",
      `${fmt(originalTotal)} 元<span>單價 ${Number(record.ltt_original_value).toLocaleString()} 元/m²</span>`
    )
  );
  if (g.cpiIndex !== 100) {
    rows.push(lttDetailRow(`物價指數調整${result.cpiAuto ? "(自動查詢)" : ""}`, `${g.cpiIndex}%`, { muted: true }));
    rows.push(lttDetailRow("調整後前次移轉現值", `${fmt(g.adjustedOriginal)} 元`));
  }
  if (record.ltt_deductible_cost) {
    rows.push(lttDetailRow("可扣除金額(改良費用等)", `${fmt(record.ltt_deductible_cost)} 元`, { muted: true }));
  }
  rows.push(lttDetailRow("土地漲價總數額", `${fmt(g.gain)} 元`, { strong: true }));
  if (g.gain > 0) {
    rows.push(lttDetailRow("土地漲價倍數", `${g.ratio.toFixed(2)} 倍(第${g.bracket}級)`, { muted: true }));
  }
  rows.push(lttDetailRow("持有期間", result.holdingYears != null ? `${result.holdingYears} 年` : "未知", { muted: true }));
  return `<div class="ltt-detail-block">${rows.join("")}</div>`;
}

function lttResultCellHtml(result) {
  if (!result) return `<span class="helper-text">尚未輸入</span>`;
  const fmt = (n) => Math.round(n).toLocaleString();
  const g = result.general;
  const savings = Math.max(0, g.totalTax - result.selfUse.totalTax);
  const rateNote =
    g.gain > 0
      ? `稅率 ${(g.rate * 100).toFixed(1)}% − 速算扣除 ${(g.deductionRate * 100).toFixed(1)}%${g.reductionRate ? `(已套用長期持有減徵${(g.reductionRate * 100).toFixed(0)}%)` : ""}`
      : "";
  return (
    `<div class="ltt-tax-block">` +
    `<div class="ltt-tax-row"><span class="ltt-tax-label">自用</span><span class="ltt-tax-amount">約 ${fmt(result.selfUse.totalTax)} 元</span></div>` +
    `<div class="ltt-tax-row"><span class="ltt-tax-label">一般</span><span class="ltt-tax-amount">約 ${fmt(g.totalTax)} 元</span></div>` +
    (rateNote ? `<div class="ltt-tax-note">${rateNote}</div>` : "") +
    `<div class="ltt-tax-note">自用比一般省 約 ${fmt(savings)} 元</div>` +
    `</div>` +
    lttGeneralSplitHtml(g.totalTax)
  );
}
