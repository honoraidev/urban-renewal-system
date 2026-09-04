"use strict";

async function renderDocumentsTab(el) {
  const pid = state.currentProjectId;
  const docs = await api(`/projects/${pid}/documents`);

  const seenKeys = new Set();
  let duplicateCount = 0;
  docs.forEach((d) => {
    const key = `${d.doc_type}::${d.file_name}`;
    if (seenKeys.has(key)) {
      duplicateCount++;
    } else {
      seenKeys.add(key);
    }
  });

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>文件清單 (${docs.length})</h3>
      <div style="display:flex;gap:8px">
        ${duplicateCount > 0 && canOcr()
      ? `<button class="btn-secondary btn-sm" id="cleanup-duplicates-btn" style="color:var(--danger);border-color:rgba(239,68,68,0.3)">🧹 一鍵清理重複檔案 (${duplicateCount})</button>`
      : ""
    }
        <button class="btn-secondary btn-sm" id="view-ocr-batches-btn">謄本匯入批次紀錄</button>
        ${canOcr() ? `<button class="btn-primary btn-sm" id="upload-doc-btn">+ 上傳文件</button>` : ""}
      </div>
    </div>
    ${duplicateCount > 0
      ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning);padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;color:var(--text-secondary)">⚡ 檢測到列表中有 <strong>${duplicateCount} 筆重複上傳的歷史舊檔</strong>，點擊可一鍵自動清理並保留每項文件的最新版本。</span>
            <button class="btn-secondary btn-sm" id="cleanup-duplicates-banner-btn">一鍵清理 (${duplicateCount})</button>
           </div>`
      : ""
    }
    ${docs.length
      ? `<div class="table-wrap">
            <table class="docs-table">
              <thead><tr><th>檔名</th><th>類型</th><th>大小</th><th>上傳時間</th><th>說明</th><th>操作</th></tr></thead>
              <tbody>
                ${docs
        .map(
          (d) => `<tr>
                      <td>${escapeHtml(d.file_name)}</td>
                      <td>${DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</td>
                      <td>${(d.file_size_bytes / 1024).toFixed(1)} KB</td>
                      <td>${fmtDateTime(d.uploaded_at)}</td>
                      <td>${escapeHtml(d.description) || "-"}</td>
                      <td class="actions-cell">
                        <button class="btn-secondary btn-sm" data-download="${d.id}" data-filename="${escapeHtml(d.file_name)}">下載</button>
                        ${canOcr() ? `<button class="btn-danger btn-sm" data-delete-doc="${d.id}">刪除</button>` : ""}
                      </td>
                    </tr>`
        )
        .join("")}
              </tbody>
            </table>
          </div>`
      : `<div class="empty-state">尚無文件</div>`
    }
  `;

  const doCleanup = async () => {
    if (!confirm(`確定要清理此專案中 ${duplicateCount} 筆重複的歷史舊檔嗎？（將會自動保留每項文件的最新版本）`)) return;
    try {
      const res = await api(`/projects/${pid}/documents/cleanup-duplicates`, { method: "POST" });
      toast(`已成功清理 ${res.deleted_count} 筆重複檔案`, "success");
      renderTab("documents");
    } catch (err) { }
  };

  const cleanupBtn = document.getElementById("cleanup-duplicates-btn");
  if (cleanupBtn) cleanupBtn.addEventListener("click", doCleanup);

  const cleanupBannerBtn = document.getElementById("cleanup-duplicates-banner-btn");
  if (cleanupBannerBtn) cleanupBannerBtn.addEventListener("click", doCleanup);

  el.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => downloadDocument(Number(btn.dataset.download), btn.dataset.filename));
  });
  el.querySelectorAll("[data-delete-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此文件嗎?")) return;
      try {
        await api(`/projects/${pid}/documents/${btn.dataset.deleteDoc}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("documents");
      } catch (err) { }
    });
  });
  const uploadBtn = document.getElementById("upload-doc-btn");
  if (uploadBtn) uploadBtn.addEventListener("click", openUploadDocumentModal);
  const viewOcrBatchesBtn = document.getElementById("view-ocr-batches-btn");
  if (viewOcrBatchesBtn) viewOcrBatchesBtn.addEventListener("click", openOcrBatchListModal);
}

async function openOcrBatchListModal() {
  const pid = state.currentProjectId;
  let jobs;
  try {
    jobs = await api(`/projects/${pid}/ocr-jobs`);
  } catch (err) {
    return;
  }
  openModal(
    "謄本匯入批次紀錄",
    jobs.length
      ? jobs
        .map(
          (j) => `
        <div class="record-row" data-open-batch="${j.id}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 12px">
          <div>
            <div style="font-weight:700">批次 #${j.id}</div>
            <div class="helper-text">${fmtDateTime(j.created_at)}</div>
          </div>
          <span class="status-badge ${j.status === "completed" ? "status-active" : j.status === "failed" ? "status-suspended" : "status-closed"}">${OCR_JOB_STATUS_LABEL[j.status] || j.status}</span>
        </div>`
        )
        .join("")
      : `<div class="empty-state">尚無匯入批次紀錄</div>`,
    { width: "480px" }
  );
  document.getElementById("modal-root")
    .querySelectorAll("[data-open-batch]")
    .forEach((row) => {
      row.addEventListener("click", () => {
        closeModal();
        goToOcrBatch(Number(row.dataset.openBatch));
      });
    });
}

async function downloadDocument(docId, fileName) {
  try {
    const res = await api(`/projects/${state.currentProjectId}/documents/${docId}/download`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { }
}

function openUploadDocumentModal() {
  const landowners = state.projectCache[state.currentProjectId]?.landowners || [];
  openModal(
    "上傳文件",
    `
    <form id="upload-form">
      <div class="field-row">
        <div class="field" style="flex:0 0 200px"><label>檔案</label><input type="file" name="file" required></div>
        <div class="field"><label>文件類型</label>
          <select name="doc_type">
            ${Object.entries(DOC_TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">上傳</button>
      </div>
    </form>`
  );
  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.querySelector('input[name="file"]');
    const file = fileInput ? fileInput.files[0] : null;
    const docTypeSelect = form.querySelector('select[name="doc_type"]');
    const docType = docTypeSelect ? docTypeSelect.value : "other";

    if (file) {
      const confirmed = await inspectAndConfirmDocumentUpload(file, docType);
      if (!confirmed) return;
    }

    const fd = new FormData(form);
    if (!fd.get("landowner_id")) fd.delete("landowner_id");
    try {
      await api(`/projects/${state.currentProjectId}/documents`, { method: "POST", body: fd, isForm: true });
      closeModal();
      toast("文件已上傳", "success");
      renderTab("documents");
    } catch (err) { }
  });
}
