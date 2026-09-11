"use strict";

function openModal(title, bodyHtml, { width = "480px" } = {}) {
  const root = document.getElementById("modal-root");
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
    // The 謄本 import wizard has no 取消 button - the × is the only way out - so once
    // OCR has produced data, confirm before discarding the un-created edits.
    if (
      title === "掃描謄本匯入" &&
      typeof titleDeedWizard !== "undefined" &&
      titleDeedWizard &&
      titleDeedWizard.data
    ) {
      const ok = await confirmDialog("已辨識與編輯的內容還沒建立,關閉後就會遺失。", {
        title: "關閉匯入精靈?",
        confirmText: "關閉",
        danger: true,
      });
      if (!ok) return;
    }
    closeModal();
  };
  return root;
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
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
