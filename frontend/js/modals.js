"use strict";

function openModal(title, bodyHtml, { width = "480px" } = {}) {
  const root = document.getElementById("modal-root");
  // 背景頁面開著捲軸時,固定定位的遮罩仍是以「含捲軸」的整個視窗寬度去置中,左右
  // 會因為捲軸佔掉的那幾px 而不對稱(視覺上像整組往左偏)。開 modal 時鎖住背景捲動,
  // 捲軸消失,遮罩才能真正以整個視窗寬度水平置中。
  document.body.style.overflow = "hidden";
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-dialog" style="max-width:${width}">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="modal-close-btn" type="button">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  root.querySelector("#modal-close-btn").onclick = async () => {
    // 謄本匯入精靈只剩右上角 × 可以離開:只要已經選了檔案、正在辨識,或已辨識出資料還沒建立,
    // 關閉前一律先警示,避免誤按就把這次匯入丟掉。
    if (title === "掃描謄本匯入" && typeof titleDeedWizard !== "undefined" && titleDeedWizard) {
      const hasData = !!titleDeedWizard.data;
      const hasFiles = Array.isArray(titleDeedWizard.files) && titleDeedWizard.files.length > 0;
      if (hasData || hasFiles) {
        const ok = await confirmDialog(
          hasData
            ? "已辨識與編輯的內容還沒建立,關閉後就會遺失。"
            : "已選擇的謄本檔案還沒完成匯入,關閉後會取消這次匯入(辨識進行中也會中止)。",
          { title: "確定要關閉匯入精靈?", confirmText: "關閉並取消匯入", danger: true }
        );
        if (!ok) return;
      }
    }
    if (title === "掃描謄本匯入" && typeof wizardDiscardPendingJobs === "function") wizardDiscardPendingJobs();
    closeModal();
  };
  return root;
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
  document.body.style.overflow = "";
}

// 掛在既有 modal 旁邊的次要面板(例如「編輯地主」視窗點「+建立一筆拜訪資料」彈出的
// 快速建立表單)- 附加在同一個 .modal-overlay 底下當手足元素,overlay 本身是
// display:flex,兩個 .modal-dialog 自然並排、整體置中,不用另外算座標。要關掉主視窗
// (closeModal)時 #modal-root 整包清空,這個面板也會一起消失,不用另外處理。
function openSidePanel(title, bodyHtml, { width = "380px" } = {}) {
  const overlay = document.getElementById("modal-overlay");
  if (!overlay) return openModal(title, bodyHtml, { width });
  document.getElementById("modal-side-panel")?.remove();
  const panel = document.createElement("div");
  panel.className = "modal-dialog modal-side-panel";
  panel.id = "modal-side-panel";
  panel.style.maxWidth = width;
  panel.innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" id="modal-side-close-btn" type="button">&times;</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>`;
  overlay.appendChild(panel);
  panel.querySelector("#modal-side-close-btn").onclick = () => panel.remove();
  return panel;
}

function closeSidePanel() {
  document.getElementById("modal-side-panel")?.remove();
}

// 疊在現有 modal 之上的頁面內確認框;不動 #modal-root,底下的精靈不會被蓋掉。
function confirmDialog(message, { title = "確認", confirmText = "確定", cancelText = "取消", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "150";
    overlay.innerHTML = `
      <div class="modal-dialog" style="max-width:460px" role="alertdialog" aria-modal="true">
        <div class="modal-header"><h3>${escapeHtml(title)}</h3></div>
        <div class="modal-body">
          <div style="line-height:1.75;white-space:pre-line">${escapeHtml(message)}</div>
          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>`;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(false);
    };
    const done = (result) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) return done(false);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) done(act === "ok");
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="ok"]').focus();
  });
}
