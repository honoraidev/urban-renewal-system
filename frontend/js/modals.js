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
  root.querySelector("#modal-close-btn").onclick = () => {
    // The 謄本 import wizard has no 取消 button - the × is the only way out - so once
    // OCR has produced data, confirm before discarding the un-created edits.
    if (
      title === "掃描謄本匯入" &&
      typeof titleDeedWizard !== "undefined" &&
      titleDeedWizard &&
      titleDeedWizard.data
    ) {
      if (!confirm("關閉匯入精靈?已辨識與編輯的內容還沒建立,關閉後就會遺失。")) return;
    }
    closeModal();
  };
  return root;
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}
