"use strict";

/* ================= 公版文件 ================= */

async function goToCompanyDocs() {
  setActiveNav("companydocs");
  showView("view-companydocs");
  const uploadBtn = document.getElementById("upload-companydoc-btn");
  if (uploadBtn) uploadBtn.classList.toggle("hidden", !isManager());
  await loadCompanyDocs();
}

function companyDocIcon(mimeType) {
  if (!mimeType) return "📎";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  return "📎";
}

async function loadCompanyDocs() {
  const wrap = document.getElementById("companydocs-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const docs = await api("/company-documents");

  wrap.innerHTML = docs.length
    ? `<div class="card">
        ${docs
      .map(
        (d) => `
          <div class="doc-row">
            <div class="doc-row-icon">${companyDocIcon(d.mime_type)}</div>
            <div style="flex:1;min-width:0">
              <div class="doc-row-name">${escapeHtml(d.file_name)}</div>
              <div class="helper-text">
                最後更新:${fmtDate(d.uploaded_at)}${d.uploaded_by_name ? ` by ${escapeHtml(d.uploaded_by_name)}` : ""}${d.category ? ` · ${escapeHtml(d.category)}` : ""}${d.description ? ` · ${escapeHtml(d.description)}` : ""}
              </div>
            </div>
            <div class="actions-cell">
              <button class="btn-secondary btn-sm" data-download-companydoc="${d.id}" data-filename="${escapeHtml(d.file_name)}">↓ 下載</button>
              ${isManager() ? `<button class="btn-danger btn-sm" data-delete-companydoc="${d.id}">刪除</button>` : ""}
            </div>
          </div>`
      )
      .join("")}
      </div>`
    : `<div class="empty-state">尚無公版文件</div>`;

  wrap.querySelectorAll("[data-download-companydoc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const res = await api(`/company-documents/${btn.dataset.downloadCompanydoc}/download`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = btn.dataset.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) { }
    });
  });
  wrap.querySelectorAll("[data-delete-companydoc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此文件嗎?")) return;
      try {
        await api(`/company-documents/${btn.dataset.deleteCompanydoc}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadCompanyDocs();
      } catch (err) { }
    });
  });
}

function initCompanyDocs() {
  const btn = document.getElementById("upload-companydoc-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      openModal(
        "上傳公版文件",
        `
        <form id="upload-companydoc-form">
          <div class="field"><label>檔案</label><input type="file" name="file" required></div>
          <div class="field"><label>分類(選填)</label><input name="category" placeholder="例:開發信範本"></div>
          <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
            <button type="submit" class="btn-primary">上傳</button>
          </div>
        </form>`
      );
      document.getElementById("upload-companydoc-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!fd.get("category")) fd.delete("category");
        try {
          await api("/company-documents", { method: "POST", body: fd, isForm: true });
          closeModal();
          toast("文件已上傳", "success");
          loadCompanyDocs();
        } catch (err) { }
      });
    });
  }
}

/* ================= 相關法規 / 相關網站 (共用邏輯) ================= */

const LINK_SECTION_ACCENTS = ["accent-brand", "accent-success", "accent-info", "accent-danger"];

function renderLinkListPage(items, listElId, isManagerView) {
  const el = document.getElementById(listElId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">尚無連結,${isManagerView ? "點右上角新增" : "請洽管理員新增"}</div>`;
    return;
  }
  const byCategory = {};
  items.forEach((item) => {
    const cat = item.category || "未分類";
    (byCategory[cat] = byCategory[cat] || []).push(item);
  });
  el.innerHTML = Object.entries(byCategory)
    .map(
      ([cat, rows], catIdx) => `
      <div class="link-section">
        <div class="link-section-hdr"><span>📄</span>${escapeHtml(cat)}</div>
        ${rows
          .map(
            (r) => `
          <div class="card link-card" data-id="${r.id}">
            <div class="link-card-dot ${LINK_SECTION_ACCENTS[catIdx % LINK_SECTION_ACCENTS.length]}"></div>
            <div style="flex:1;min-width:0">
              <div class="link-card-name">${escapeHtml(r.name)}</div>
              ${r.description ? `<div class="helper-text">${escapeHtml(r.description)}</div>` : ""}
            </div>
            <div class="actions-cell">
              <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="btn-secondary btn-sm">開啟 ↗</a>
              ${isManagerView
                ? `<button class="btn-secondary btn-sm" data-edit-link="${r.id}">編輯</button>
                     <button class="btn-danger btn-sm" data-delete-link="${r.id}">刪除</button>`
                : ""
              }
            </div>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

function openLinkFormModal(title, endpoint, item, onSaved) {
  openModal(
    title,
    `
    <form id="link-form">
      <div class="field"><label>分類(選填)</label><input name="category" value="${item ? escapeHtml(item.category) || "" : ""}"></div>
      <div class="field"><label>名稱</label><input name="name" required value="${item ? escapeHtml(item.name) : ""}"></div>
      <div class="field"><label>網址</label><input name="url" type="url" required value="${item ? escapeHtml(item.url) : ""}"></div>
      <div class="field"><label>說明(選填)</label><textarea name="description" rows="2">${item ? escapeHtml(item.description) || "" : ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!payload.category) delete payload.category;
    if (!payload.description) delete payload.description;
    try {
      if (item) {
        await api(`${endpoint}/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await api(endpoint, { method: "POST", body: payload });
      }
      closeModal();
      toast("已儲存", "success");
      onSaved();
    } catch (err) { }
  });
}

let regulationsEditMode = false;
let websitesEditMode = false;

async function goToRegulations() {
  setActiveNav("regulations");
  showView("view-regulations");
  regulationsEditMode = false;
  document.getElementById("new-regulation-btn")?.classList.toggle("hidden", !isManager());
  document.getElementById("toggle-regulation-edit-btn")?.classList.toggle("hidden", !isManager());
  await loadRegulations();
}

async function loadRegulations() {
  const el = document.getElementById("regulations-list");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/regulations");
  renderLinkListPage(items, "regulations-list", isManager() && regulationsEditMode);
  if (isManager() && regulationsEditMode) {
    el.querySelectorAll("[data-edit-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((r) => r.id === Number(btn.dataset.editLink));
        openLinkFormModal("編輯法規連結", "/regulations", item, loadRegulations);
      });
    });
    el.querySelectorAll("[data-delete-link]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除此連結嗎?")) return;
        try {
          await api(`/regulations/${btn.dataset.deleteLink}`, { method: "DELETE" });
          toast("已刪除", "success");
          loadRegulations();
        } catch (err) { }
      });
    });
  }
}

async function goToWebsites() {
  setActiveNav("websites");
  showView("view-websites");
  websitesEditMode = false;
  document.getElementById("new-website-btn")?.classList.toggle("hidden", !isManager());
  document.getElementById("toggle-website-edit-btn")?.classList.toggle("hidden", !isManager());
  await loadWebsites();
}

async function loadWebsites() {
  const el = document.getElementById("websites-list");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/websites");
  renderLinkListPage(items, "websites-list", isManager() && websitesEditMode);
  if (isManager() && websitesEditMode) {
    el.querySelectorAll("[data-edit-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((r) => r.id === Number(btn.dataset.editLink));
        openLinkFormModal("編輯網站連結", "/websites", item, loadWebsites);
      });
    });
    el.querySelectorAll("[data-delete-link]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除此連結嗎?")) return;
        try {
          await api(`/websites/${btn.dataset.deleteLink}`, { method: "DELETE" });
          toast("已刪除", "success");
          loadWebsites();
        } catch (err) { }
      });
    });
  }
}

/* ================= 知識庫 (FAQ) ================= */

let faqCurCat = "全部";
let faqEditMode = false;
let faqItemsCache = [];
const FAQ_CATEGORY_OPTIONS = ["條件分配", "法律問題", "稅務優惠", "說明會相關", "都更流程"];

async function goToFaq() {
  setActiveNav("faq");
  showView("view-faq");
  faqEditMode = false;
  const toggleBtn = document.getElementById("toggle-faq-edit-btn");
  if (toggleBtn) {
    toggleBtn.classList.toggle("hidden", !isManager());
    toggleBtn.classList.remove("btn-primary");
    toggleBtn.classList.add("btn-secondary");
  }
  document.getElementById("new-faq-btn")?.classList.toggle("hidden", !isManager());
  document.getElementById("manage-faq-cats-btn")?.classList.toggle("hidden", !isManager());
  faqCurCat = "全部";
  await loadFaq();
}

async function loadFaq() {
  const listEl = document.getElementById("faq-list");
  if (!listEl) return;
  listEl.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/faq");
  faqItemsCache = items;

  const usedCats = items.map((i) => i.category || "未分類");
  const cats = ["全部", ...new Set([...usedCats, ...FAQ_CATEGORY_OPTIONS])];
  const catBar = document.getElementById("faq-cat-bar");
  if (catBar) {
    catBar.innerHTML = cats
      .map((c) => `<button class="fb ${faqCurCat === c ? "act" : ""}" data-faq-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join("");
    document.querySelectorAll("[data-faq-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        faqCurCat = btn.dataset.faqCat;
        renderFaqList(items);
      });
    });
  }

  renderFaqList(items);
}

function renderFaqList(items) {
  const listEl = document.getElementById("faq-list");
  if (!listEl) return;
  const filtered = items.filter((i) => faqCurCat === "全部" || (i.category || "未分類") === faqCurCat);

  listEl.innerHTML = filtered.length
    ? filtered
      .map(
        (i) => `
      <div class="faq-item">
        <div class="faq-q" data-faq-toggle="${i.id}">
          <span class="faq-cat-tag">${escapeHtml(i.category) || "未分類"}</span>
          <span style="flex:1">${escapeHtml(i.question)}</span>
          ${isManager() && faqEditMode
            ? `<span class="actions-cell" onclick="event.stopPropagation()">
                  <button class="btn-secondary btn-sm" data-edit-faq="${i.id}">編輯</button>
                  <button class="btn-danger btn-sm" data-delete-faq="${i.id}">刪除</button>
                </span>`
            : ""
          }
          <span class="faq-arr">▶</span>
        </div>
        <div class="faq-a">${escapeHtml(i.answer)}</div>
      </div>`
      )
      .join("")
    : `<div class="empty-state">尚無問答</div>`;

  listEl.querySelectorAll("[data-faq-toggle]").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const item = hdr.closest(".faq-item");
      const wasOpen = item.classList.contains("open");
      listEl.querySelectorAll(".faq-item.open").forEach((x) => x.classList.remove("open"));
      if (!wasOpen) item.classList.add("open");
    });
  });
  listEl.querySelectorAll("[data-edit-faq]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = items.find((i) => i.id === Number(btn.dataset.editFaq));
      openFaqFormModal("編輯問答", item);
    });
  });
  listEl.querySelectorAll("[data-delete-faq]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此問答嗎?")) return;
      try {
        await api(`/faq/${btn.dataset.deleteFaq}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadFaq();
      } catch (err) { }
    });
  });
}

function openFaqFormModal(title, item) {
  const currentCat = item ? item.category || "" : "";
  const isKnownCat = !currentCat || FAQ_CATEGORY_OPTIONS.includes(currentCat);
  openModal(
    title,
    `
    <form id="faq-form">
      <div class="field">
        <label>分類(選填)</label>
        <select id="faq-category-select">
          <option value="" ${!currentCat ? "selected" : ""}>無</option>
          ${FAQ_CATEGORY_OPTIONS.map((c) => `<option value="${escapeHtml(c)}" ${currentCat === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          ${!isKnownCat ? `<option value="${escapeHtml(currentCat)}" selected>${escapeHtml(currentCat)}</option>` : ""}
          <option value="__new__">＋ 新增分類</option>
        </select>
        <input type="hidden" name="category" id="faq-category-value" value="${escapeHtml(currentCat)}">
      </div>
      <div class="field"><label>問題</label><input name="question" required value="${item ? escapeHtml(item.question) : ""}"></div>
      <div class="field"><label>答案</label><textarea name="answer" rows="4" required>${item ? escapeHtml(item.answer) : ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  const catSelect = document.getElementById("faq-category-select");
  const catValue = document.getElementById("faq-category-value");
  catSelect.addEventListener("change", () => {
    if (catSelect.value === "__new__") {
      const name = prompt("輸入新分類名稱:");
      if (name && name.trim()) {
        const opt = document.createElement("option");
        opt.value = name.trim();
        opt.textContent = name.trim();
        catSelect.insertBefore(opt, catSelect.querySelector('option[value="__new__"]'));
        catSelect.value = name.trim();
      } else {
        catSelect.value = catValue.value;
      }
    }
    catValue.value = catSelect.value === "__new__" ? "" : catSelect.value;
  });
  document.getElementById("faq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!payload.category) delete payload.category;
    try {
      if (item) {
        await api(`/faq/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await api("/faq", { method: "POST", body: payload });
      }
      closeModal();
      toast("已儲存", "success");
      loadFaq();
    } catch (err) { }
  });
}

function openManageFaqCatsModal() {
  const realCats = new Set(faqItemsCache.map((i) => i.category).filter(Boolean));
  const allCats = [...new Set([...FAQ_CATEGORY_OPTIONS, ...realCats])];

  openModal(
    "管理分類",
    `
    <div id="faq-cat-manage-list">
      ${allCats.length
      ? allCats
        .map((c) => {
          const count = faqItemsCache.filter((i) => i.category === c).length;
          return `
              <div class="cat-manage-row" data-cat="${escapeHtml(c)}">
                <span class="cat-manage-name">${escapeHtml(c)}${count ? ` (${count} 筆問答使用中)` : ""}</span>
                <button type="button" class="btn-secondary btn-sm" data-rename-cat="${escapeHtml(c)}">編輯</button>
                <button type="button" class="btn-danger btn-sm" data-delete-cat="${escapeHtml(c)}">刪除</button>
              </div>`;
        })
        .join("")
      : `<div class="empty-state">尚無分類</div>`
    }
    </div>
    <div class="field-row" style="margin-top:12px">
      <div class="field" style="margin-bottom:0"><input id="new-faq-cat-name" placeholder="新分類名稱"></div>
      <div class="field" style="flex:0 0 auto;margin-bottom:0">
        <button type="button" class="btn-primary" id="add-faq-cat-btn">新增</button>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">關閉</button>
    </div>`
  );

  document.getElementById("add-faq-cat-btn")?.addEventListener("click", () => {
    const input = document.getElementById("new-faq-cat-name");
    const name = input.value.trim();
    if (!name) return;
    if (FAQ_CATEGORY_OPTIONS.includes(name) || realCats.has(name)) {
      toast("分類已存在", "error");
      return;
    }
    FAQ_CATEGORY_OPTIONS.push(name);
    toast("已新增分類", "success");
    closeModal();
    loadFaq();
  });

  document.querySelectorAll("[data-rename-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const oldName = btn.dataset.renameCat;
      const newName = prompt(`將分類「${oldName}」重新命名為:`, oldName);
      if (!newName || !newName.trim() || newName.trim() === oldName) return;
      const trimmed = newName.trim();
      try {
        const affected = faqItemsCache.filter((i) => i.category === oldName);
        for (const item of affected) {
          await api(`/faq/${item.id}`, { method: "PATCH", body: { category: trimmed } });
        }
        const idx = FAQ_CATEGORY_OPTIONS.indexOf(oldName);
        if (idx >= 0) FAQ_CATEGORY_OPTIONS[idx] = trimmed;
        toast("已更新分類名稱", "success");
        closeModal();
        await loadFaq();
      } catch (err) { }
    });
  });

  document.querySelectorAll("[data-delete-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.deleteCat;
      const affected = faqItemsCache.filter((i) => i.category === name);
      const msg = affected.length
        ? `確定要刪除分類「${name}」嗎?底下 ${affected.length} 筆問答會變成「無分類」。`
        : `確定要刪除分類「${name}」嗎?`;
      if (!confirm(msg)) return;
      try {
        for (const item of affected) {
          await api(`/faq/${item.id}`, { method: "PATCH", body: { category: null } });
        }
        const idx = FAQ_CATEGORY_OPTIONS.indexOf(name);
        if (idx >= 0) FAQ_CATEGORY_OPTIONS.splice(idx, 1);
        toast("已刪除分類", "success");
        closeModal();
        await loadFaq();
      } catch (err) { }
    });
  });
}

function initResources() {
  initCompanyDocs();

  document.getElementById("new-regulation-btn")?.addEventListener("click", () => {
    openLinkFormModal("新增法規連結", "/regulations", null, loadRegulations);
  });
  document.getElementById("toggle-regulation-edit-btn")?.addEventListener("click", (e) => {
    regulationsEditMode = !regulationsEditMode;
    e.currentTarget.classList.toggle("btn-primary", regulationsEditMode);
    e.currentTarget.classList.toggle("btn-secondary", !regulationsEditMode);
    loadRegulations();
  });

  document.getElementById("new-website-btn")?.addEventListener("click", () => {
    openLinkFormModal("新增網站連結", "/websites", null, loadWebsites);
  });
  document.getElementById("toggle-website-edit-btn")?.addEventListener("click", (e) => {
    websitesEditMode = !websitesEditMode;
    e.currentTarget.classList.toggle("btn-primary", websitesEditMode);
    e.currentTarget.classList.toggle("btn-secondary", !websitesEditMode);
    loadWebsites();
  });

  document.getElementById("new-faq-btn")?.addEventListener("click", () => {
    openFaqFormModal("新增問答", null);
  });
  document.getElementById("toggle-faq-edit-btn")?.addEventListener("click", (e) => {
    faqEditMode = !faqEditMode;
    e.currentTarget.classList.toggle("btn-primary", faqEditMode);
    e.currentTarget.classList.toggle("btn-secondary", !faqEditMode);
    renderFaqList(faqItemsCache);
  });
  document.getElementById("manage-faq-cats-btn")?.addEventListener("click", openManageFaqCatsModal);
}
