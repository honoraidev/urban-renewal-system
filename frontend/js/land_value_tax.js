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
  const currentValue = live ? live.current_value : Number(lr.ltt_current_value) || 0;
  const currentPeriod = live ? live.period_label : lr.ltt_current_value_period;
  const holdingYears = lr.ltt_holding_years ?? calcHoldingYears(lr.ltt_original_value_period, currentPeriod);
  const params = {
    originalValue: Number(lr.ltt_original_value) || 0,
    currentValue,
    cpiIndex: Number(lr.ltt_cpi_index) || null,
    deductibleCost: Number(lr.ltt_deductible_cost) || 0,
  };
  return {
    general: calculateLandValueIncrementTax({ ...params, holdingYears }),
    selfUse: calculateLandValueIncrementTaxSelfUse(params),
    currentValue,
    currentPeriod,
    holdingYears,
  };
}

async function renderLandValueTaxTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = landowners;

  // 編號與排序都跟「土地登記清冊」對齊:同一份 landowners 順序,編號 = 該地主在清冊裡的序位
  // (有土地登記的地主),同一地主的多筆土地登記共用同一個編號。
  const landOwners = landowners.filter((o) => (o.land_records || []).length > 0);

  const rows = [];
  landOwners.forEach((o) => {
    (o.land_records || []).forEach((lr) => rows.push({ owner: o, record: lr }));
  });

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">尚無土地登記資料,請先於「土地登記」頁籤匯入資料</div>`;
    return;
  }

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>土地增值稅試算(自用／一般稅率同時試算,共 ${landOwners.length} 位地主 / ${rows.length} 筆土地登記)</h3>
    </div>
    <div class="helper-text" style="margin-bottom:12px" id="ltt-tab-note">⚠ 僅供參考,實際應納土地增值稅仍以主管稽徵機關核定金額為準。本月申報移轉現值查詢中…</div>
    <div class="table-wrap">
      <table class="ltt-table">
        <thead><tr>
          <th>編號</th><th>地主</th><th>計算明細</th><th>本次申報移轉現值(元)</th>
          <th>稅額試算(自用／一般／節省)</th>
        </tr></thead>
        <tbody id="ltt-tbody"></tbody>
      </table>
    </div>`;

  renderLttTbody(el, landOwners, {});
  wireLandValueTaxToggles(el);

  let liveValues = {};
  let note = "本月申報移轉現值請至「土地登記」頁的「當期公告土地現值」填寫。";
  try {
    const lookup = await api(`/projects/${pid}/landowners/ltt-current-value-lookup-all`, { silent: true });
    if (lookup.supported && !lookup.error) {
      liveValues = lookup.records || {};
      note = lookup.period_label
        ? `本月申報移轉現值已自動帶入臺北市政府開放資料 ${escapeHtml(lookup.period_label)} 公告土地現值(即時查詢,僅供試算參考);查無資料的地號請至「土地登記」頁手動輸入。`
        : "查無符合的公告土地現值資料,請至「土地登記」頁手動輸入本月申報移轉現值。";
    } else if (lookup.supported && lookup.error) {
      note = "自動查詢公告土地現值失敗,暫時沿用「土地登記」頁已存的本月申報移轉現值。";
    } else {
      note = "目前僅臺北市案件支援自動查詢公告土地現值,其他縣市請至「土地登記」頁手動輸入本月申報移轉現值。";
    }
  } catch (err) {
    note = "自動查詢公告土地現值失敗,暫時沿用「土地登記」頁已存的本月申報移轉現值。";
  }

  const noteEl = document.getElementById("ltt-tab-note");
  if (noteEl) noteEl.textContent = `⚠ 僅供參考,實際應納土地增值稅仍以主管稽徵機關核定金額為準。${note}`;
  renderLttTbody(el, landOwners, liveValues);
  wireLandValueTaxToggles(el);
}

function renderLttTbody(el, landOwners, liveValues) {
  const tbody = el.querySelector("#ltt-tbody");
  if (!tbody) return;
  tbody.innerHTML = landOwners
    .map((o, i) => {
      const seq = String(i + 1).padStart(3, "0");
      const recs = o.land_records || [];
      const parcels = [...new Set(recs.map((lr) => lr.parcel_number).filter(Boolean))].join("、");
      const parent = `
        <tr class="ltt-parent" data-owner-parent="${o.id}">
          <td style="white-space:nowrap"><button type="button" class="ltt-toggle" data-owner-toggle="${o.id}" style="border:none;background:none;cursor:pointer;font-size:13px;margin-right:4px;color:var(--text-muted)">▸</button>${seq}</td>
          <td>${escapeHtml(o.name)}</td>
          <td colspan="2" class="helper-text">${recs.length} 筆土地登記${parcels ? ` · 地號 ${escapeHtml(parcels)}` : ""}</td>
          <td class="ltt-result-cell" data-owner-total="${o.id}">${lttOwnerTotalHtml(o, liveValues)}</td>
        </tr>`;
      const children = recs.map((lr) => lttChildRowHtml(o, lr, liveValues)).join("");
      return parent + children;
    })
    .join("");
}

function lttOwnerTotal(owner, liveValues) {
  return (owner.land_records || []).reduce(
    (s, lr) => {
      const r = landValueTaxRowResult(lr, liveValues);
      return {
        general: s.general + (r ? r.general.totalTax : 0),
        selfUse: s.selfUse + (r ? r.selfUse.totalTax : 0),
      };
    },
    { general: 0, selfUse: 0 }
  );
}

function lttGeneralSplitHtml(generalTax) {
  if (!generalTax) return "";
  const ownerShare = generalTax * LTT_GENERAL_SPLIT.owner;
  const developerShare = generalTax * LTT_GENERAL_SPLIT.developer;
  return `<div class="helper-text">(協議合建4/6分攤:地主 ${Math.round(ownerShare).toLocaleString()} 元、建商 ${Math.round(developerShare).toLocaleString()} 元)</div>`;
}

function lttOwnerTotalHtml(owner, liveValues) {
  const anyFilled = (owner.land_records || []).some((lr) => lr.ltt_original_value);
  if (!anyFilled) return `<span class="helper-text">尚未輸入</span>`;
  const t = lttOwnerTotal(owner, liveValues);
  const savings = Math.max(0, t.general - t.selfUse);
  return (
    `<div>自用 <strong>約 ${Math.round(t.selfUse).toLocaleString()} 元</strong></div>` +
    `<div>一般 <strong>約 ${Math.round(t.general).toLocaleString()} 元</strong></div>` +
    `<div class="helper-text">自用比一般省 約 ${Math.round(savings).toLocaleString()} 元</div>` +
    lttGeneralSplitHtml(t.general)
  );
}

function wireLandValueTaxToggles(el) {
  el.querySelectorAll("[data-owner-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.ownerToggle;
      const opening = btn.textContent.trim() === "▸";
      btn.textContent = opening ? "▾" : "▸";
      el.querySelectorAll(`.ltt-child-of-${id}`).forEach((tr) => tr.classList.toggle("hidden", !opening));
    });
  });
}

function lttChildRowHtml(owner, record, liveValues) {
  const result = landValueTaxRowResult(record, liveValues);
  const live = liveValues && liveValues[record.id];
  const currentValueCell = live
    ? `<div class="helper-text" style="margin-bottom:2px">${escapeHtml(live.period_label)}(即時查詢)</div>${Number(live.current_value).toLocaleString()}`
    : `${record.ltt_current_value_period ? `<div class="helper-text" style="margin-bottom:2px">${escapeHtml(record.ltt_current_value_period)}</div>` : ""}${record.ltt_current_value ? Number(record.ltt_current_value).toLocaleString() : "-"}`;
  return `
    <tr class="ltt-child ltt-child-of-${owner.id} hidden" data-ltt-row="${record.id}">
      <td colspan="2" class="ltt-child-parcel">${escapeHtml(record.parcel_number) || "-"}${record.registration_order ? `<span>次序 ${escapeHtml(record.registration_order)}</span>` : ""}</td>
      <td>${lttDetailCellHtml(record, result)}</td>
      <td>${currentValueCell}</td>
      <td class="ltt-result-cell">${lttResultCellHtml(result)}</td>
    </tr>`;
}

// 計算明細欄:把「前次移轉現值 → 物價指數調整 → 調整後前次移轉現值 → 漲價總數額 → 漲價倍數
// → 持有年限」每一步都列出來,使用者可以核對系統是怎麼算出稅額的,不是黑盒子。
function lttDetailCellHtml(record, result) {
  if (!result) return `<span class="helper-text">尚未輸入前次移轉現值</span>`;
  const fmt = (n) => Math.round(n).toLocaleString();
  const g = result.general;
  const lines = [];
  lines.push(
    `${record.ltt_original_value_period ? `${escapeHtml(record.ltt_original_value_period)}` : "前次移轉現值"} <strong>${fmt(record.ltt_original_value)} 元</strong>`
  );
  if (g.cpiIndex !== 100) {
    lines.push(`物價指數調整 ${g.cpiIndex}%`);
    lines.push(`調整後前次移轉現值 <strong>${fmt(g.adjustedOriginal)} 元</strong>`);
  }
  if (record.ltt_deductible_cost) {
    lines.push(`可扣除金額(改良費用等) ${fmt(record.ltt_deductible_cost)} 元`);
  }
  lines.push(`土地漲價總數額 <strong>${fmt(g.gain)} 元</strong>`);
  if (g.gain > 0) {
    lines.push(`土地漲價倍數 ${g.ratio.toFixed(2)} 倍(第${g.bracket}級)`);
  }
  lines.push(`持有期間 ${result.holdingYears != null ? `${result.holdingYears} 年` : "未知"}`);
  return lines.map((l) => `<div class="helper-text" style="margin-bottom:2px">${l}</div>`).join("");
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
    `<div>自用 <strong>約 ${fmt(result.selfUse.totalTax)} 元</strong></div>` +
    `<div>一般 <strong>約 ${fmt(g.totalTax)} 元</strong></div>` +
    (rateNote ? `<div class="helper-text">${rateNote}</div>` : "") +
    `<div class="helper-text">自用比一般省 約 ${fmt(savings)} 元</div>` +
    lttGeneralSplitHtml(g.totalTax)
  );
}
