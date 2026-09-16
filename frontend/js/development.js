"use strict";

// 同意度100%通過、案件結案後的都更後續開發流程(事業計畫核定/權利變換/拆除/開工/
// 交屋這類)- 跟 SOP 是分開的兩件事,預設帶入固定的 6 關(見後端
// DEFAULT_DEVELOPMENT_STAGES),不提供關卡結構編輯(名稱/順序跟 SOP 頁的「自訂關卡
// 流程」是重複功能,拿掉了)。獨立分頁,排在「人員」右邊
// (見 index.html 的 tab-btn-development)。

const DEV_STAGE_ICONS = ["📋", "📜", "🏗", "📝", "🏢", "🏠"];

async function renderDevelopmentTab(container) {
  const pid = state.currentProjectId;
  let dev, project, sop, allDocs, landowners;
  try {
    [dev, project, sop, allDocs, landowners] = await Promise.all([
      api(`/projects/${pid}/development`, { silent: true }),
      api(`/projects/${pid}`, { silent: true }),
      api(`/projects/${pid}/sop`, { silent: true }),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/landowners`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  const stageKeys = Object.keys(dev.stages).sort((a, b) => Number(a) - Number(b));
  const hasStages = stageKeys.length > 0;
  const canAct = isEditor();
  const sopDone = sop.final && sop.final.status !== "pending";

  // 更新章別:從土地登記的地段/小段推回來,不另外存一份(同一案件通常同一個地段)。
  const sections = [...new Set(
    landowners.flatMap((o) => (o.land_records || []).map((lr) => [lr.section, lr.subsection].filter(Boolean).join("")))
      .filter(Boolean)
  )];
  const renewalSection = sections.slice(0, 2).join("、") || "-";

  // ---- 頂部案件資訊卡 ----
  const headerHtml = `
    <div class="card dev-header-card">
      <div class="dev-header-top">
        <div>
          <h2 class="dev-header-title">${escapeHtml(project.name)}</h2>
          ${sopDone ? `<span class="status-badge status-active">✅ 案件同意度100%通過</span>` : `<span class="status-badge status-closed">SOP 進行中</span>`}
        </div>
        ${sopDone
          ? `<div class="dev-achievement">
              <span class="dev-achievement-icon">🏆</span>
              <div>
                <div class="dev-achievement-title">同意度達成 100%</div>
                <div class="helper-text">已完成住戶同意程序,進入後續開發階段</div>
              </div>
            </div>`
          : ""
        }
      </div>
      <div class="dev-header-info">
        <div><span class="helper-text">案件編號</span><div>${escapeHtml(project.project_code)}</div></div>
        <div><span class="helper-text">行政區</span><div>${escapeHtml(project.city) || ""}${escapeHtml(project.district) || "-"}</div></div>
        <div><span class="helper-text">更新章別</span><div>${escapeHtml(renewalSection)}</div></div>
        <div><span class="helper-text">案件類型</span><div>${escapeHtml(project.case_type) || "-"}</div></div>
      </div>
    </div>`;

  // ---- 橫向關卡步驟條(前面加一顆「案件同意度通過」裝飾節點,來自 SOP 結案狀態) ----
  const stepperNodes = [
    { icon: "✅", title: "案件同意度通過", status: sopDone ? "done" : "pending", dateText: sopDone && sop.final.closed_at ? fmtDate(sop.final.closed_at) : "待完成", isReal: false, key: null },
    ...stageKeys.map((k, i) => {
      const s = dev.stages[k];
      const isDone = s.status === "completed";
      const isCurrent = Number(k) === dev.current_stage && !isDone;
      return {
        icon: DEV_STAGE_ICONS[i % DEV_STAGE_ICONS.length],
        title: s.name,
        status: isDone ? "done" : isCurrent ? "current" : "pending",
        dateText: isDone
          ? (s.completed_at ? fmtDate(s.completed_at) : "已完成")
          : s.due_date
            ? `預計 ${fmtDate(s.due_date)}`
            : "待開始",
        isReal: true,
        key: k,
      };
    }),
  ];
  const stepperHtml = `
    <div class="card sop-subcard">
      <div class="sop-subcard-header"><h4>都更後續開發流程(SOP)</h4></div>
      ${hasStages
        ? `<div class="dev-stepper">
            ${stepperNodes
              .map(
                (n, i) => `
              <div class="dev-stepper-node ${n.status} ${n.isReal && n.key === String(dev.current_stage) ? "selected" : ""}" ${n.isReal ? `data-dev-stepper-select="${n.key}"` : ""}>
                <div class="dev-stepper-circle">${n.status === "done" ? "✓" : n.icon}</div>
                <div class="dev-stepper-num">${i}</div>
                <div class="dev-stepper-title">${escapeHtml(n.title)}</div>
                <div class="dev-stepper-status-badge">${n.status === "done" ? "已完成" : n.status === "current" ? "進行中" : "待開始"}</div>
                <div class="helper-text">${escapeHtml(n.dateText)}</div>
              </div>`
              )
              .join("")}
          </div>`
        : `<div class="empty-state">尚未建立流程,請洽案件負責人(L2以上)</div>`
      }
    </div>`;

  // ---- 目前階段資訊 ----
  const selectedKey = state.devSelectedStage != null && stageKeys.includes(String(state.devSelectedStage))
    ? String(state.devSelectedStage)
    : String(dev.current_stage);
  const selectedStage = dev.stages[selectedKey];
  let currentInfoHtml = "";
  if (hasStages && selectedStage) {
    const isDone = selectedStage.status === "completed";
    const isCurrent = Number(selectedKey) === dev.current_stage && !isDone;
    const canReopen = isDone && Number(selectedKey) === dev.current_stage - 1;
    const progressPct = selectedStage.progress_pct ?? (isDone ? 100 : 0);
    currentInfoHtml = `
      <div class="card sop-subcard">
        <div class="sop-subcard-header">
          <h4>${isDone ? "✓" : isCurrent ? "▶" : "🔒"} ${escapeHtml(selectedStage.name)}</h4>
          <span class="status-badge ${isDone || isCurrent ? "status-active" : "status-closed"}">${isDone ? "已完成" : isCurrent ? "進行中" : "待開始"}</span>
        </div>
        <div class="dev-info-grid">
          <div class="field"><label>預計完成日</label>${canAct
            ? `<input type="date" id="dev-meta-due-date" value="${escapeHtml(selectedStage.due_date) || ""}">`
            : `<div class="sop-meta-value">${selectedStage.due_date ? fmtDate(selectedStage.due_date) : "未設定"}</div>`
          }</div>
          <div class="field"><label>負責單位</label>${canAct
            ? `<input type="text" id="dev-meta-department" value="${escapeHtml(selectedStage.department) || ""}" placeholder="例:都市發展局">`
            : `<div class="sop-meta-value">${escapeHtml(selectedStage.department) || "未設定"}</div>`
          }</div>
        </div>
        <div class="field"><label>辦理內容</label>${canAct
          ? `<textarea id="dev-meta-description" rows="2" placeholder="這一關要做什麼...">${escapeHtml(selectedStage.description) || ""}</textarea>`
          : `<div class="sop-meta-value">${escapeHtml(selectedStage.description) || "未設定"}</div>`
        }</div>
        <div class="field"><label>所需文件</label>${canAct
          ? `<input type="text" id="dev-meta-required-docs" value="${escapeHtml(selectedStage.required_docs) || ""}" placeholder="例:事業計畫書、圖說、相關同意書、委任書等">`
          : `<div class="sop-meta-value">${escapeHtml(selectedStage.required_docs) || "未設定"}</div>`
        }</div>
        <div class="field">
          <label>本階段進度${canAct ? "" : `:${progressPct}%`}</label>
          ${canAct ? `<input type="range" id="dev-meta-progress" min="0" max="100" value="${progressPct}">` : ""}
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${progressPct}%"></div></div>
          ${canAct ? `<div class="helper-text" style="text-align:right"><span id="dev-meta-progress-text">${progressPct}</span>%</div>` : ""}
        </div>
        ${canAct ? `<div style="text-align:right"><button type="button" class="btn-secondary btn-sm" id="dev-save-meta-btn">儲存階段資訊</button></div>` : ""}
        <div class="sop-action-bar">
          ${isCurrent && canAct ? `<button type="button" class="btn-primary btn-sm" data-dev-complete="${selectedKey}">完成本階段</button>` : ""}
          ${canReopen && canAct ? `<button type="button" class="btn-secondary btn-sm" data-dev-reopen="${selectedKey}">取消完成</button>` : ""}
        </div>
      </div>`;
  }

  // ---- 相關文件(掛在目前選取的關卡上) ----
  const stageDocs = hasStages
    ? allDocs.filter((d) => d.dev_stage === Number(selectedKey)).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
    : [];
  const fileRowHtml = (d) => `
    <div class="sop-file-row" data-doc-id="${d.id}">
      <span class="sop-file-icon">📄</span>
      <div class="sop-file-main">
        <div class="sop-file-name">${escapeHtml(d.file_name)}</div>
        <div class="helper-text">${fmtDateTime(d.uploaded_at)}</div>
      </div>
      <button type="button" class="btn-secondary btn-sm" data-dev-file-download="${d.id}" data-dev-file-name="${escapeHtml(d.file_name)}" title="下載">⬇</button>
      ${canAct ? `<button type="button" class="btn-danger btn-sm" data-dev-file-delete="${d.id}" title="刪除">✕</button>` : ""}
    </div>`;
  const relatedFilesHtml = hasStages
    ? `<div class="card sop-subcard">
        <div class="sop-subcard-header"><h4>📎 相關文件</h4></div>
        ${canAct
          ? `<label class="sop-file-dropzone" id="dev-file-dropzone">
              <input type="file" id="dev-file-input" style="display:none">
              <div>⬆ 點擊上傳檔案或拖曳檔案到此處</div>
            </label>`
          : ""
        }
        <div class="sop-file-list">${stageDocs.length ? stageDocs.map(fileRowHtml).join("") : `<div class="empty-state">尚無相關文件</div>`}</div>
      </div>`
    : "";

  // ---- 各階段重點文件清單 ----
  const docTableHtml = hasStages
    ? `<div class="card sop-subcard">
        <h4>各階段重點文件清單</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>階段</th><th>主要文件</th><th>備註</th></tr></thead>
            <tbody>
              ${stageKeys
                .map((k) => `<tr><td>${escapeHtml(dev.stages[k].name)}</td><td>${escapeHtml(dev.stages[k].required_docs) || "-"}</td><td>${escapeHtml(dev.stages[k].description) || "-"}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`
    : "";

  // ---- 階段歷程 ----
  const history = dev.history || [];
  const historyHtml = `
    <div class="card sop-subcard">
      <div class="sop-subcard-header"><h4>🕒 階段歷程</h4></div>
      ${canAct
        ? `<div class="dev-history-add">
            <input type="date" id="dev-history-date" value="${new Date().toISOString().slice(0, 10)}">
            <input type="text" id="dev-history-title" placeholder="事件標題(如:提送事業計畫書)">
            <button type="button" class="btn-secondary btn-sm" id="dev-history-add-btn">+ 新增</button>
          </div>`
        : ""
      }
      <div class="dev-history-list">
        ${history.length
          ? history
              .map(
                (h) => `
            <div class="dev-history-item">
              <div class="dev-history-dot"></div>
              <div class="dev-history-body">
                <div class="dev-history-date">${fmtDate(h.event_date)}</div>
                <div class="dev-history-title">${escapeHtml(h.title)}${h.note ? ` - ${escapeHtml(h.note)}` : ""}</div>
              </div>
              ${canAct ? `<button type="button" class="btn-link btn-sm" data-dev-history-delete="${h.id}">刪除</button>` : ""}
            </div>`
              )
              .join("")
          : `<div class="empty-state">尚無歷程紀錄</div>`
        }
      </div>
    </div>`;

  container.innerHTML = `
    ${headerHtml}
    ${stepperHtml}
    <div class="dev-two-col">
      <div class="dev-two-col-main">${currentInfoHtml}${docTableHtml}</div>
      <div class="dev-two-col-side">${relatedFilesHtml}${historyHtml}</div>
    </div>`;

  // ---- 事件綁定 ----
  container.querySelectorAll("[data-dev-stepper-select]").forEach((node) => {
    node.addEventListener("click", () => {
      state.devSelectedStage = Number(node.dataset.devStepperSelect);
      renderDevelopmentTab(container);
    });
  });

  container.querySelectorAll("[data-dev-complete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/${btn.dataset.devComplete}/complete`, { method: "POST", body: {} });
        toast("已完成", "success");
        state.devSelectedStage = null;
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });
  container.querySelectorAll("[data-dev-reopen]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/${btn.dataset.devReopen}/reopen`, { method: "POST" });
        toast("已取消完成", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });

  const progressInput = document.getElementById("dev-meta-progress");
  const progressText = document.getElementById("dev-meta-progress-text");
  if (progressInput && progressText) {
    progressInput.addEventListener("input", () => {
      progressText.textContent = progressInput.value;
      progressInput.parentElement.querySelector(".progress-bar-fill").style.width = `${progressInput.value}%`;
    });
  }
  const saveMetaBtn = document.getElementById("dev-save-meta-btn");
  if (saveMetaBtn) {
    saveMetaBtn.addEventListener("click", async () => {
      const payload = {
        due_date: document.getElementById("dev-meta-due-date").value || null,
        department: document.getElementById("dev-meta-department").value || null,
        description: document.getElementById("dev-meta-description").value || null,
        required_docs: document.getElementById("dev-meta-required-docs").value || null,
        progress_pct: progressInput ? Number(progressInput.value) : undefined,
      };
      try {
        await api(`/projects/${pid}/development/${selectedKey}/meta`, { method: "PATCH", body: payload });
        toast("已儲存", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  }

  // ---- 相關文件上傳/下載/刪除 ----
  const uploadDevFile = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", "other");
    fd.append("dev_stage", selectedKey);
    try {
      await api(`/projects/${pid}/documents`, { method: "POST", body: fd, isForm: true });
      toast("已上傳", "success");
      renderDevelopmentTab(container);
    } catch (err) { }
  };
  const dropzone = document.getElementById("dev-file-dropzone");
  const fileInput = document.getElementById("dev-file-input");
  if (dropzone && fileInput) {
    fileInput.addEventListener("change", () => uploadDevFile(fileInput.files[0]));
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      uploadDevFile(e.dataTransfer.files[0]);
    });
  }
  container.querySelectorAll("[data-dev-file-download]").forEach((btn) => {
    btn.addEventListener("click", () => downloadDocument(Number(btn.dataset.devFileDownload), btn.dataset.devFileName));
  });
  container.querySelectorAll("[data-dev-file-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這個檔案嗎?")) return;
      try {
        await api(`/projects/${pid}/documents/${btn.dataset.devFileDelete}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });

  // ---- 階段歷程新增/刪除 ----
  const historyAddBtn = document.getElementById("dev-history-add-btn");
  if (historyAddBtn) {
    historyAddBtn.addEventListener("click", async () => {
      const dateInput = document.getElementById("dev-history-date");
      const titleInput = document.getElementById("dev-history-title");
      if (!titleInput.value.trim()) {
        toast("請輸入事件標題", "error");
        return;
      }
      try {
        await api(`/projects/${pid}/development/history`, {
          method: "POST",
          body: { event_date: dateInput.value, title: titleInput.value.trim() },
        });
        toast("已新增", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  }
  container.querySelectorAll("[data-dev-history-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/history/${btn.dataset.devHistoryDelete}`, { method: "DELETE" });
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });
}
