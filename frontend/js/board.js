"use strict";

// 案件公告 / 進度通知 —— 案件標題正下方的常駐卡片。原本合併「系統自動記錄
// (activity_logs)」+「手動補充(project_notes)」兩種紀錄的時間軸,改成只顯示
// 今天、屬於這個案件的行事曆提醒(跟工作看板行事曆同一份 calendar_events 資料,
// 見 /projects/{id}/calendar-today) —— 例如 9/22 行事曆填了「須聯絡林屋主
// 14:00」,今天(9/22)這裡就會顯示「聯絡林屋主 14:00」。新增/編輯/刪除都改到
// 左側「工作看板」的行事曆去做,這張卡不再有自己的「+新增」按鈕。

function boardEnsureStyle() {
  if (document.getElementById("board-style")) return;
  const s = document.createElement("style");
  s.id = "board-style";
  s.textContent = `
    .board-card { background:var(--surface); border:1px solid var(--border,#e5e7eb); border-radius:12px; padding:12px 16px; }
    .board-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:10px; }
    .board-card-head h3 { margin:0; font-size:15px; display:flex; align-items:center; gap:6px; }
    .board-card-head .helper-text { font-size:12px; }
    .board-scroll { max-height:120px; overflow-y:auto; }
    .board-more { margin-top:4px; text-align:center; font-size:12.5px; color:var(--text-muted,#6b7280); min-height:14px;
      white-space:nowrap; letter-spacing:normal; word-spacing:normal; }
    .board-row { display:flex; justify-content:space-between; gap:10px; padding:7px 0;
      border-bottom:1px solid var(--border,#f1f5f9); align-items:flex-start; font-size:13.5px; }
    .board-row:last-child { border-bottom:none; }
    .board-row-main { display:flex; align-items:flex-start; gap:6px; min-width:0; }
    .board-row-time { flex:0 0 auto; font-size:11.5px; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap;
      background:rgba(13,148,136,.12); color:#0d9488; }
    .board-row-text { word-break:break-word; }
    .board-row-meta { flex:0 0 auto; text-align:right; font-size:12.5px; color:var(--text-muted,#6b7280); white-space:nowrap; }
  `;
  document.head.appendChild(s);
}

function _boardRowHtml(item) {
  const timeText = fmtEventTime(item.event_time);
  return `<div class="board-row">
    <div class="board-row-main">
      ${timeText ? `<span class="board-row-time">${timeText}</span>` : ""}
      <span class="board-row-text">${item.is_important ? "⭐ " : ""}${escapeHtml(item.content)}</span>
    </div>
    <div class="board-row-meta">${escapeHtml(item.created_by_name || "—")}</div>
  </div>`;
}

async function renderProjectBoardCard() {
  const mount = document.getElementById("pd-board-card");
  const pid = state.currentProjectId;
  if (!mount || !pid) return;
  boardEnsureStyle();

  let items = [];
  try {
    items = await api(`/projects/${pid}/calendar-today`, { silent: true }).catch(() => []);
  } catch (err) {
    return;
  }
  // 使用者可能已經切到別的案件 - 這個回應已經過期就不畫了。
  if (state.currentProjectId !== pid) return;

  const listHtml = !items.length
    ? `<div class="helper-text">今天沒有排定的提醒 —— 到左側「工作看板」行事曆新增(選這個案件即可共用)</div>`
    : `<div class="board-scroll" id="board-scroll">${items.map(_boardRowHtml).join("")}</div>
       <div class="board-more" id="board-more"></div>`;

  mount.innerHTML = `
    <div class="board-card">
      <div class="board-card-head">
        <h3>🔔 公告 / 進度通知</h3>
        <span class="helper-text">今日提醒${items.length ? `・共 ${items.length} 則` : ""}</span>
      </div>
      ${listHtml}
    </div>
  `;

  const boardScroll = document.getElementById("board-scroll");
  const boardMore = document.getElementById("board-more");
  if (boardScroll && boardMore) {
    const updateMore = () => {
      // 捲到底了就直接算 0 則 —— 逐列用 offsetTop 比對在小數縮放(125%/150% 等瀏覽器
      // 縮放比例)下常常會因為 1px 內的誤差,捲到底了還是把最後一列算成「還沒看到」。
      if (boardScroll.scrollTop + boardScroll.clientHeight >= boardScroll.scrollHeight - 2) {
        boardMore.textContent = "";
        return;
      }
      const bottom = boardScroll.scrollTop + boardScroll.clientHeight;
      const remaining = [...boardScroll.children].filter((row) => row.offsetTop + row.offsetHeight > bottom + 1).length;
      boardMore.textContent = remaining > 0 ? `↓ 以下還有 ${remaining} 則` : "";
    };
    boardScroll.addEventListener("scroll", updateMore);
    updateMore();
  }
}
