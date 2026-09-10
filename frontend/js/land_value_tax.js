"use strict";

// 土地增值稅一般稅率試算(土地稅法第 33 條)。輸入的「原規定地價/前次移轉現值」與「本次申報移轉現值」
// 都是「總額」(不是每平方公尺單價)- 地政士/地價稅通知書上列的通常就是總額,這樣使用者不用自己拿去乘面積。
// 這是概算工具,不是正式稅額 - 實際申報應以地方稅捐稽徵機關核算為準,已在頁面上標註(未套用持有年限
// 減徵、自用住宅優惠稅率、物價指數調整、土地改良費用等)。
function calculateLandValueIncrementTax({ originalValue, currentValue, cpiIndex }) {
  // 依土地稅法:漲價總數額 = 申報現值 − 原規定地價(或前次移轉現值) × 台灣地區消費者物價總指數 ÷ 100。
  // 分級級距也以「按物價指數調整後的原地價」為基準。未填指數時視為 100(不調整)。
  const idx = cpiIndex && cpiIndex > 0 ? cpiIndex : 100;
  const adjustedOriginal = originalValue * (idx / 100);
  const gain = Math.max(0, currentValue - adjustedOriginal);
  if (originalValue <= 0 || gain <= 0) {
    return { gain: 0, brackets: [], totalTax: 0, adjustedOriginal, cpiIndex: idx };
  }

  const tier1Base = Math.min(gain, adjustedOriginal * 1);
  const tier2Base = Math.max(0, Math.min(gain, adjustedOriginal * 2) - adjustedOriginal * 1);
  const tier3Base = Math.max(0, gain - adjustedOriginal * 2);

  const tier1Tax = tier1Base * 0.2;
  const tier2Tax = tier2Base * 0.3;
  const tier3Tax = tier3Base * 0.4;

  return {
    gain,
    adjustedOriginal,
    cpiIndex: idx,
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
  });
}

async function renderLandValueTaxTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = landowners;

  // 編號與排序都跟「土地登記清冊」對齊:同一份 landowners 順序,編號 = 該地主在清冊裡的序位
  // (有土地登記的地主),同一地主的多筆土地登記共用同一個編號。
  const landOwners = landowners.filter((o) => (o.land_records || []).length > 0);
  const seqByOwnerId = new Map(landOwners.map((o, i) => [o.id, i + 1]));

  const rows = [];
  landOwners.forEach((o) => {
    (o.land_records || []).forEach((lr) => rows.push({ owner: o, record: lr, seq: seqByOwnerId.get(o.id) }));
  });

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">尚無土地登記資料,請先於「土地登記」頁籤匯入資料</div>`;
    return;
  }

  const canEditLtt = isEditor() || isLandowner();
  const editorCols = canEditLtt ? 3 : 2; // 原規定地價 + 本次申報 (+ 儲存)
  const bodyHtml = landOwners
    .map((o) => {
      const seq = String(seqByOwnerId.get(o.id)).padStart(3, "0");
      const recs = o.land_records || [];
      const parcels = [...new Set(recs.map((lr) => lr.parcel_number).filter(Boolean))].join("、");
      const parent = `
        <tr class="ltt-parent" data-owner-parent="${o.id}">
          <td style="white-space:nowrap"><button type="button" class="ltt-toggle" data-owner-toggle="${o.id}" style="border:none;background:none;cursor:pointer;font-size:13px;margin-right:4px;color:var(--text-muted)">▸</button>${seq}</td>
          <td>${escapeHtml(o.name)}</td>
          <td colspan="${editorCols}" class="helper-text">${recs.length} 筆土地登記${parcels ? ` · 地號 ${escapeHtml(parcels)}` : ""}</td>
          <td class="ltt-result-cell" data-owner-total="${o.id}">${lttOwnerTotalHtml(o)}</td>
        </tr>`;
      const children = recs.map((lr) => lttChildRowHtml(o, lr)).join("");
      return parent + children;
    })
    .join("");

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>土地增值稅試算(一般稅率,共 ${landOwners.length} 位地主 / ${rows.length} 筆土地登記)</h3>
    </div>
    <div class="helper-text" style="margin-bottom:12px">「原規定地價/前次移轉現值」在「土地登記」頁編輯,本頁唯讀;只有「本次申報移轉現值」可在本頁填,填一次即儲存。點編號左邊的箭頭展開該地主的每一筆土地登記。⚠ 僅供概算參考,未套用持有年限減徵、自用住宅優惠稅率、物價指數調整、土地改良費用等,正式稅額請以地方稅捐稽徵機關核算為準。</div>
    <div class="table-wrap">
      <table class="ltt-table">
        <thead><tr>
          <th>編號</th><th>地主</th><th>原規定地價/前次移轉現值(元)</th><th>本次申報移轉現值(元)</th>
          ${canEditLtt ? "<th></th>" : ""}
          <th>應納稅額試算</th>
        </tr></thead>
        <tbody id="ltt-tbody">${bodyHtml}</tbody>
      </table>
    </div>`;

  wireYearMonthPickers(el);
  wireLandValueTaxRows(el, rows);
  wireLandValueTaxToggles(el);
}

function lttOwnerTotal(owner) {
  return (owner.land_records || []).reduce((s, lr) => {
    const r = landValueTaxRowResult(lr);
    return s + (r ? r.totalTax : 0);
  }, 0);
}

function lttOwnerTotalHtml(owner) {
  const anyFilled = (owner.land_records || []).some((lr) => lr.ltt_original_value);
  if (!anyFilled) return `<span class="helper-text">尚未輸入</span>`;
  return `<strong>約 ${Math.round(lttOwnerTotal(owner)).toLocaleString()} 元</strong>`;
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

function lttChildRowHtml(owner, record) {
  const result = landValueTaxRowResult(record);
  const editable = isEditor() || isLandowner();
  return `
    <tr class="ltt-child ltt-child-of-${owner.id} hidden" data-ltt-row="${record.id}">
      <td colspan="2" class="ltt-child-parcel">${escapeHtml(record.parcel_number) || "-"}${record.registration_order ? `<span>次序 ${escapeHtml(record.registration_order)}</span>` : ""}</td>
      <td>${record.ltt_original_value_period ? `<div class="helper-text" style="margin-bottom:2px">${escapeHtml(record.ltt_original_value_period)}</div>` : ""}${record.ltt_original_value ? Number(record.ltt_original_value).toLocaleString() : "-"}${editable ? `<div class="helper-text" style="margin-top:2px;opacity:.7">於「土地登記」頁修改</div>` : ""}</td>
      <td>${editable
      ? `<input type="number" min="0" step="1" class="ltt-input-current" value="${record.ltt_current_value ?? ""}" style="width:150px">`
      : (record.ltt_current_value ? Number(record.ltt_current_value).toLocaleString() : "-")
    }</td>
      ${editable ? `<td><button type="button" class="btn-secondary btn-sm" data-ltt-save="${record.id}" data-owner="${owner.id}">儲存</button></td>` : ""}
      <td class="ltt-result-cell">${lttResultCellHtml(result)}</td>
    </tr>`;
}

function lttResultCellHtml(result) {
  if (!result) return `<span class="helper-text">尚未輸入</span>`;
  const fmt = (n) => Math.round(n).toLocaleString();
  const notes = [];
  if (result.cpiIndex && result.cpiIndex !== 100) notes.push(`物價指數 ${result.cpiIndex}`);
  return `<strong>約 ${fmt(result.totalTax)} 元</strong>` + (notes.length ? ` <span class="helper-text">(已套用 ${notes.join("、")})</span>` : "");
}

function wireLandValueTaxRows(el, rows) {
  el.querySelectorAll("[data-ltt-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const recordId = Number(btn.dataset.lttSave);
      const ownerId = Number(btn.dataset.owner);
      const row = el.querySelector(`[data-ltt-row="${recordId}"]`);
      // 「原規定地價/前次移轉現值」只在「土地登記」頁改,這頁唯讀,不送這兩個欄位。
      const currentValue = row.querySelector(".ltt-input-current").value;

      try {
        const updated = await api(`/projects/${state.currentProjectId}/landowners/${ownerId}/land-records/${recordId}`, {
          method: "PATCH",
          body: {
            ltt_current_value: currentValue === "" ? null : Number(currentValue),
          },
        });
        toast("已儲存", "success");
        row.querySelector(".ltt-result-cell").innerHTML = lttResultCellHtml(landValueTaxRowResult(updated));
        const found = rows.find((r) => r.record.id === recordId);
        if (found) {
          Object.assign(found.record, updated);
          const totalCell = el.querySelector(`[data-owner-total="${found.owner.id}"]`);
          if (totalCell) totalCell.innerHTML = lttOwnerTotalHtml(found.owner);
        }
      } catch (err) { }
    });
  });
}
