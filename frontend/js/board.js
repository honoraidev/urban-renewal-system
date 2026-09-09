"use strict";

// 案件公告 / 進度通知 —— 案件標題正下方的常駐卡片(跟個人工作看板的「今日操作
// 紀錄」同一種樣式:卷軸下拉看更多,不用「展開全部」按鈕)。合併兩種紀錄:
//   ① 系統自動記錄(activity_logs):地主/屋主資料變更、上傳文件、費用異動等,
//      只要動到這個案件就自動出現,誰改的、什麼時候都有。
//   ② 手動補充(project_notes):自己輸入跟進事項與時間,例如電訪紀錄、進度備註。

function boardEnsureStyle() {
  if (document.getElementById("board-style")) return;
  const s = document.createElement("style");
  s.id = "board-style";
  s.textContent = `
    .board-card { background:var(--bg-card,#fff); border:1px solid var(--border,#e5e7eb); border-radius:14px; padding:16px; }
    .board-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:10px; }
    .board-card-head h3 { margin:0; font-size:15px; display:flex; align-items:center; gap:6px; }
    .board-scroll { max-height:76px; overflow-y:auto; }
    .board-more { margin-top:4px; text-align:center; font-size:11.5px; color:var(--text-muted,#6b7280); min-height:14px; }
    .board-row { display:flex; justify-content:space-between; gap:12px; padding:7px 0;
      border-bottom:1px solid var(--border,#f1f5f9); align-items:flex-start; font-size:13px; }
    .board-row:last-child { border-bottom:none; }
    .board-row-main { display:flex; align-items:flex-start; gap:8px; min-width:0; }
    .board-row-tag { flex:0 0 auto; font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px; white-space:nowrap; }
    .board-row-tag.tag-note { background:rgba(13,148,136,.12); color:#0d9488; }
    .board-row-tag.tag-auto { background:var(--surface-2,#f1f5f9); color:var(--text-muted,#6b7280); }
    .board-row-text { word-break:break-word; }
    .board-row-meta { flex:0 0 auto; text-align:right; font-size:11.5px; color:var(--text-muted,#6b7280); white-space:nowrap; }
    .board-row-meta button { margin-left:6px; }
  `;
  document.head.appendChild(s);
}

function _boardRowHtml(item) {
  const isNote = item.kind === "note";
  return `<div class="board-row">
    <div class="board-row-main">
      <span class="board-row-tag ${isNote ? "tag-note" : "tag-auto"}">${isNote ? "📝" : "🔄"}</span>
      <span class="board-row-text">${escapeHtml(item.text)}</span>
    </div>
    <div class="board-row-meta">
      ${escapeHtml(item.who || "—")} · ${fmtDateTime(item.time)}
      ${isNote && isEditor() ? `<button type="button" class="btn-link btn-sm" data-del-note="${item.id}">刪除</button>` : ""}
    </div>
  </div>`;
}

async function renderProjectBoardCard() {
  const mount = document.getElementById("pd-board-card");
  const pid = state.currentProjectId;
  if (!mount || !pid) return;
  boardEnsureStyle();

  let notes = [];
  let feed = [];
  try {
    [notes, feed] = await Promise.all([
      api(`/projects/${pid}/notes`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    return;
  }
  // 使用者可能已經切到別的案件 - 這個回應已經過期就不畫了。
  if (state.currentProjectId !== pid) return;

  const merged = [
    ...notes.map((n) => ({ kind: "note", id: n.id, time: n.occurred_at, text: n.content, who: n.author_name })),
    ...feed.map((a) => ({ kind: "auto", id: a.id, time: a.created_at, text: a.action, who: a.user_name })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  const listHtml = !merged.length
    ? `<div class="helper-text">尚無公告或異動紀錄</div>`
    : `<div class="board-scroll" id="board-scroll">${merged.map(_boardRowHtml).join("")}</div>
       <div class="board-more" id="board-more"></div>`;

  mount.innerHTML = `
    <div class="board-card">
      <div class="board-card-head">
        <h3>🔔 公告 / 進度通知</h3>
        ${isEditor() ? `<button type="button" class="btn-primary btn-sm" id="board-add-btn" style="background:#0d9488;border-color:#0d9488">＋ 新增</button>` : ""}
      </div>
      ${listHtml}
    </div>
  `;

  const boardScroll = document.getElementById("board-scroll");
  const boardMore = document.getElementById("board-more");
  if (boardScroll && boardMore) {
    const updateMore = () => {
      const bottom = boardScroll.scrollTop + boardScroll.clientHeight;
      const remaining = [...boardScroll.children].filter((row) => row.offsetTop + row.offsetHeight > bottom + 1).length;
      boardMore.textContent = remaining > 0 ? `↓ 以下還有 ${remaining} 則` : "";
    };
    boardScroll.addEventListener("scroll", updateMore);
    updateMore();
  }

  const addBtn = document.getElementById("board-add-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddNoteModal(pid));

  mount.querySelectorAll("[data-del-note]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這筆公告嗎?")) return;
      try {
        await api(`/projects/${pid}/notes/${btn.dataset.delNote}`, { method: "DELETE" });
        renderProjectBoardCard();
      } catch (err) { }
    });
  });
}

function openAddNoteModal(pid) {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(
    "新增公告",
    `
    <form id="board-note-form">
      <div class="field"><label>時間</label><input type="datetime-local" name="occurred_at" value="${nowLocal}" required></div>
      <div class="field"><label>內容</label><textarea name="content" rows="3" placeholder="例:已致電陳先生確認同意書進度" required></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary" style="background:#0d9488;border-color:#0d9488">新增</button>
      </div>
    </form>`,
    { width: "440px" }
  );
  document.getElementById("board-note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const occurred = fd.get("occurred_at");
    try {
      await api(`/projects/${pid}/notes`, {
        method: "POST",
        body: {
          content: fd.get("content"),
          occurred_at: occurred ? new Date(occurred).toISOString() : null,
        },
      });
      closeModal();
      renderProjectBoardCard();
    } catch (err) { }
  });
}
