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
  root.querySelector("#modal-close-btn").onclick = closeModal;
  return root;
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}
