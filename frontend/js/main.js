"use strict";

function bootstrapApp() {
  initAuth();
  initDashboard();
  initMyWork();
  initOcrWizard();
  initMembers();
  initResources();
  initInventory();

  // 手機版側欄抽屜 (☰) - 桌機沒有 #sb-toggle 就不動作
  const sb = document.querySelector(".sb");
  const sbToggle = document.getElementById("sb-toggle");
  const sbBackdrop = document.getElementById("sb-backdrop");
  const setSidebar = (open) => {
    sb?.classList.toggle("sb-open", open);
    sbBackdrop?.classList.toggle("show", open);
    sbToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  };
  sbToggle?.addEventListener("click", () => setSidebar(!sb.classList.contains("sb-open")));
  sbBackdrop?.addEventListener("click", () => setSidebar(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sb?.classList.contains("sb-open")) setSidebar(false);
  });
  // 點側欄任何項目後自動收起抽屜
  sb?.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link, .sb-case-item, .avatar-dropdown-item")) setSidebar(false);
  });

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAvatarDropdown();
      const target = btn.dataset.nav;
      if (target === "mywork") goToMyWork();
      if (target === "dashboard") goToDashboard();
      if (target === "tools") goToTools();
      if (target === "users") goToUsers();
      if (target === "loginlogs") goToLoginLogs();
      if (target === "companydocs") goToCompanyDocs();
      if (target === "regulations") goToRegulations();
      if (target === "websites") goToWebsites();
      if (target === "faq") goToFaq();
      if (target === "inventory") goToInventory();
    });
  });

  const ocrBtn = document.getElementById("btn-run-ocr");
  if (ocrBtn) {
    ocrBtn.addEventListener("click", () => {
      openModal(
        "OCR 謄本辨識 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#e0f2fe;border:1px solid #bae6fd;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#0369a1;line-height:1.5">
              <strong>本系統整合 OCR 謄本自動辨識功能！</strong>
            </div>
          </div>
          
          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至<strong>「登記資料」</strong>頁籤,再選<strong>土地登記</strong>或<strong>建物登記</strong>。</li>
            <li>點擊上方 <strong>「自動掃描謄本 (OCR)」</strong> 按鈕,上傳謄本 PDF 檔。</li>
            <li>電子謄本<strong>直接抽取文字</strong>;掃描件或抽取不到的空缺欄位,系統會自動<strong>用 OCR 補掃</strong>,再<strong>用 AI 校正比對</strong>還原正確地址與欄位。</li>
            <li>自動辨識地號、建號、所有權人、持分、面積、他項權利與戶籍地址,一鍵匯入產出初版登記清冊。</li>
          </ol>
          
          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
  }

  const taxBtn = document.getElementById("btn-run-tax");
  if (taxBtn) {
    taxBtn.addEventListener("click", () => {
      openModal(
        "計算土地增值稅 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#fef9c3;border:1px solid #fef08a;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#854d0e;line-height:1.5">
              <strong>本系統整合土地增值稅自動試算與計算器功能！</strong>
            </div>
          </div>
          
          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至<strong>「土增稅」</strong>頁籤。</li>
            <li>系統將自動帶入該案件下所有地主與地號數據。</li>
            <li>可輸入前次移轉現值、公告土地現值、台灣物價指數與持有年數，即時自動試算一般稅率與自用住宅優惠稅率應納稅額！</li>
          </ol>
          
          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
  }

  const rosterBtn = document.getElementById("btn-run-roster");
  if (rosterBtn) {
    rosterBtn.addEventListener("click", () => {
      openModal(
        "清冊製作 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#fef9c3;border:1px solid #fef08a;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#854d0e;line-height:1.5">
              <strong>依 OCR 匯入的謄本資料，一鍵匯出土地／建物登記清冊 Excel！</strong>
            </div>
          </div>

          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至 <strong>「SOP 進度」</strong> 頁籤，展開 <strong>「第1關 · 籌備階段」</strong>。</li>
            <li>先完成上傳地籍圖、土地謄本 PDF、建物謄本 PDF（可用 OCR 謄本辨識匯入，再於土地/建物登記逐筆校正）。</li>
            <li>在 SOP 第一關的 <strong>「確認地主清冊正確」</strong> 這一步點擊 <strong>「📊 產生地主清冊 Excel」</strong> 按鈕，即產出符合範本格式的 Excel 清冊，可再手動修正後使用。</li>
          </ol>

          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
  }

  const invoiceBtn = document.getElementById("btn-run-invoice");
  if (invoiceBtn) {
    invoiceBtn.addEventListener("click", () => {
      openModal(
        "發票掃描 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#ffedd5;border:1px solid #fed7aa;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#9a3412;line-height:1.5">
              <strong>拍照或上傳電子發票證明聯，自動辨識金額、日期、統編並回填費用表單！</strong>
            </div>
          </div>

          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至 <strong>「費用」</strong> 頁籤，點擊<strong>「新增費用」</strong>。</li>
            <li>在表單中按 <strong>「📷 掃描發票(拍照辨識)」</strong>,對準發票下方的 QR code 拍照,或直接上傳照片 / PDF。</li>
            <li>系統會優先讀 QR code(最準確),讀不到才改用 OCR 掃描文字並自動互算未稅金額 / 營業稅 / 總計,辨識結果自動回填發票號碼、日期、金額欄位,可再手動修正。</li>
          </ol>

          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
  }

  (async function init() {
    if (state.token) {
      try {
        await loadCurrentUser();
        return;
      } catch (e) {
        /* fall through to login */
      }
    }
    const loginView = document.getElementById("view-login");
    if (loginView) loginView.classList.remove("hidden");
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapApp);
} else {
  bootstrapApp();
}
