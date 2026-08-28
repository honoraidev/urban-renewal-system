"use strict";

// 土地增值稅一般稅率試算(土地稅法第 33 條)。輸入的「原規定地價/前次移轉現值」與「本次申報移轉現值」
// 都是「總額」(不是每平方公尺單價)- 地政士/地價稅通知書上列的通常就是總額,這樣使用者不用自己拿去乘面積。
// 持有年限減徵只套用在超過原地價 1 倍、2 倍的級距部分,未套用在第一級(這是法條規定的減徵範圍,不是隨便省略)。
// 這是概算工具,不是正式稅額 - 實際申報應以地方稅捐稽徵機關核算為準,已在頁面上標註。
function calculateLandValueIncrementTax({ originalValue, currentValue, holdingYears }) {
  const gain = Math.max(0, currentValue - originalValue);
  if (originalValue <= 0 || gain <= 0) {
    return { gain: 0, brackets: [], totalTax: 0, reliefRate: 0 };
  }
  const reliefRate = holdingYears >= 40 ? 0.4 : holdingYears >= 30 ? 0.3 : holdingYears >= 20 ? 0.2 : 0;

  const tier1Base = Math.min(gain, originalValue * 1);
  const tier2Base = Math.max(0, Math.min(gain, originalValue * 2) - originalValue * 1);
  const tier3Base = Math.max(0, gain - originalValue * 2);

  const tier1Tax = tier1Base * 0.2;
  const tier2Tax = tier2Base * 0.3 * (1 - reliefRate);
  const tier3Tax = tier3Base * 0.4 * (1 - reliefRate);

  return {
    gain,
    reliefRate,
    brackets: [
      { label: "第一級(未達原地價 1 倍)", base: tier1Base, rate: 0.2, tax: tier1Tax },
      { label: "第二級(原地價 1~2 倍部分)", base: tier2Base, rate: 0.3, tax: tier2Tax },
      { label: "第三級(超過原地價 2 倍部分)", base: tier3Base, rate: 0.4, tax: tier3Tax },
    ],
    totalTax: tier1Tax + tier2Tax + tier3Tax,
  };
}

function landValueTaxRowResult(lr) {
  if (!lr.ltt_original_value) return null;
  return calculateLandValueIncrementTax({
    originalValue: Number(lr.ltt_original_value) || 0,
    currentValue: Number(lr.ltt_current_value) || 0,
    holdingYears: Number(lr.ltt_holding_years) || 0,
  });
}

async function renderLandValueTaxTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = landowners;

  const rows = [];
  landowners.forEach((o) => {
    (o.land_records || []).forEach((lr) => rows.push({ owner: o, record: lr }));
  });

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">尚無土地登記資料,請先於「土地登記」頁籤匯入資料</div>`;
    return;
  }

  rows.sort((a, b) => (a.record.parcel_number || "").localeCompare(b.record.parcel_number || ""));

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>土地增值稅試算(一般稅率,共 ${rows.length} 筆)</h3>
    </div>
    <div class="helper-text" style="margin-bottom:12px">原地價/現值填一次後會自動儲存,之後開啟這頁會直接帶入。⚠ 僅供概算參考,未套用自用住宅優惠稅率、物價指數調整等,正式稅額請以地方稅捐稽徵機關核算為準。</div>
    <div class="table-wrap">
      <table class="ltt-table">
        <thead><tr>
          <th>地號</th><th>地主</th><th>原規定地價/前次移轉現值(元)</th><th>本次申報移轉現值(元)</th><th>持有年數</th>
          ${isEditor() ? "<th></th>" : ""}
          <th>應納稅額試算</th>
        </tr></thead>
        <tbody id="ltt-tbody">
          ${rows.map(lttRowHtml).join("")}
        </tbody>
      </table>
    </div>`;

  wireYearMonthPickers(el);
  wireLandValueTaxRows(el, rows);
}

function lttRowHtml({ owner, record }) {
  const result = landValueTaxRowResult(record);
  const editable = isEditor();
  return `
    <tr data-ltt-row="${record.id}">
      <td>${escapeHtml(record.parcel_number)}</td>
      <td>${escapeHtml(owner.name)}</td>
      <td>${editable
      ? `<input type="number" min="0" step="1" class="ltt-input-original" value="${record.ltt_original_value ?? ""}" style="width:140px">
         <div style="margin-top:4px;display:flex;gap:4px;align-items:center;width:140px">${minguoYearMonthPickerHtml("ltt_period", record.ltt_original_value_period)}</div>`
      : `${record.ltt_original_value ? Number(record.ltt_original_value).toLocaleString() : "-"}${record.ltt_original_value_period ? `<div class="helper-text">(${escapeHtml(record.ltt_original_value_period)})</div>` : ""}`
    }</td>
      <td>${editable
      ? `<input type="number" min="0" step="1" class="ltt-input-current" value="${record.ltt_current_value ?? ""}" style="width:140px">`
      : (record.ltt_current_value ? Number(record.ltt_current_value).toLocaleString() : "-")
    }</td>
      <td>${editable
      ? `<input type="number" min="0" step="1" class="ltt-input-years" value="${record.ltt_holding_years ?? ""}" style="width:80px">`
      : (record.ltt_holding_years ?? "-")
    }</td>
      ${editable ? `<td><button type="button" class="btn-secondary btn-sm" data-ltt-save="${record.id}" data-owner="${owner.id}">儲存</button></td>` : ""}
      <td class="ltt-result-cell">${lttResultCellHtml(result)}</td>
    </tr>`;
}

function lttResultCellHtml(result) {
  if (!result) return `<span class="helper-text">尚未輸入</span>`;
  const fmt = (n) => Math.round(n).toLocaleString();
  return `<strong>約 ${fmt(result.totalTax)} 元</strong>` + (result.reliefRate ? ` <span class="helper-text">(已套用持有減徵 ${(result.reliefRate * 100).toFixed(0)}%)</span>` : "");
}

function wireLandValueTaxRows(el, rows) {
  el.querySelectorAll("[data-ltt-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const recordId = Number(btn.dataset.lttSave);
      const ownerId = Number(btn.dataset.owner);
      const row = el.querySelector(`[data-ltt-row="${recordId}"]`);
      const originalValue = row.querySelector(".ltt-input-original").value;
      const periodYear = row.querySelector('[name="ltt_period_year"]').value;
      const periodMonth = row.querySelector('[name="ltt_period_month"]').value;
      const originalValuePeriod = periodYear && periodMonth ? `${periodYear}年${String(periodMonth).padStart(2, "0")}月` : "";
      const currentValue = row.querySelector(".ltt-input-current").value;
      const holdingYears = row.querySelector(".ltt-input-years").value;

      try {
        const updated = await api(`/projects/${state.currentProjectId}/landowners/${ownerId}/land-records/${recordId}`, {
          method: "PATCH",
          body: {
            ltt_original_value: originalValue === "" ? null : Number(originalValue),
            ltt_original_value_period: originalValuePeriod || null,
            ltt_current_value: currentValue === "" ? null : Number(currentValue),
            ltt_holding_years: holdingYears === "" ? null : Number(holdingYears),
          },
        });
        toast("已儲存", "success");
        row.querySelector(".ltt-result-cell").innerHTML = lttResultCellHtml(landValueTaxRowResult(updated));
        const found = rows.find((r) => r.record.id === recordId);
        if (found) Object.assign(found.record, updated);
      } catch (err) { }
    });
  });
}
