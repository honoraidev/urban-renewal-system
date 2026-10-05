"use strict";

// 工作看板頂端橫幅:「XXX | 午安」+ 目前天氣(板橋 24°C・短暫陣雨・降雨機率 80%),
// 背景依天氣 / 日夜做動態(陽光、雲飄、下雨、打雷、霧、下雪、星空)。
// 天氣資料由後端 /weather 提供(Open-Meteo,後端快取 15 分鐘)。
const WX_ICON = { clear: "☀️", partly: "🌤️", cloudy: "☁️", fog: "🌫️", rain: "🌧️", thunder: "⛈️", snow: "❄️" };

function _wxDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

let _wxLast = { kind: "clear", isDay: true };
function _applyHeroTheme(kind, isDay) {
  _wxLast = { kind, isDay };
  const hero = document.querySelector("#view-mywork .page-header");
  if (!hero) return;
  hero.classList.add("mw-hero");
  hero.dataset.wx = kind || "clear";
  // 深色模式或夜間都用夜景配色
  hero.dataset.day = isDay && !_wxDark() ? "1" : "0";
  _syncRain(hero, kind);
}

// 雨天:用稀疏、長短不一、速度不同的雨滴(不是整片密集的斜線)
function _syncRain(hero, kind) {
  let box = hero.querySelector(".mw-rain");
  if (kind !== "rain" && kind !== "thunder") {
    if (box) box.remove();
    return;
  }
  if (box) return;
  box = document.createElement("div");
  box.className = "mw-rain";
  box.setAttribute("aria-hidden", "true");
  const n = 26;
  let html = "";
  for (let i = 0; i < n; i++) {
    const left = ((i + Math.random() * 0.8) / n) * 100;
    const len = 10 + Math.random() * 14;
    const dur = 0.9 + Math.random() * 0.9;
    const delay = -Math.random() * 2;
    const op = 0.3 + Math.random() * 0.45;
    html += `<i style="left:${left.toFixed(1)}%;height:${len.toFixed(0)}px;animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;opacity:${op.toFixed(2)}"></i>`;
  }
  box.innerHTML = html;
  hero.appendChild(box);
}

function renderWorkHero() {
  const holder = document.getElementById("mywork-actions");
  if (!holder) return;
  const hr = new Date().getHours();
  const greet = hr < 5 ? "夜深了,注意休息" : hr < 11 ? "早安" : hr < 18 ? "午安" : "晚安";
  const who = (state.user && (state.user.display_name || state.user.username)) || "";
  const dayByClock = hr >= 6 && hr < 18;
  _applyHeroTheme("clear", dayByClock);
  holder.innerHTML = `
    <div class="mw-hero-right">
      <div class="mw-hero-ic" id="mw-hero-ic">${dayByClock ? "☀️" : "🌙"}</div>
      <div class="mw-hero-txt">
        <div class="mw-hero-l1">${who ? `<b>${escapeHtml(who)}</b><i></i>` : ""}<span>${greet}</span></div>
        <div class="mw-hero-l2" id="mw-hero-wx">天氣載入中…</div>
      </div>
      ${isSystemAdmin() ? `<button type="button" class="mw-hero-btn" id="ann-open-btn">📢 發布公告</button>` : ""}
    </div>`;
  loadWorkHeroWeather(dayByClock);
}

async function loadWorkHeroWeather(dayByClock) {
  const line = document.getElementById("mw-hero-wx");
  const icon = document.getElementById("mw-hero-ic");
  if (!line) return;
  let w = null;
  // 依登入裝置位置取天氣:先用上次定位(立即顯示),同時向瀏覽器要最新位置;拒絕 / 不支援就退回預設(板橋)
  const pos = await _wxPosition();
  try {
    w = await api("/weather", { silent: true, params: pos ? { lat: pos.lat, lon: pos.lon } : undefined });
  } catch (e) {}
  if (!w || !w.ok) {
    line.textContent = "";
    return;
  }
  _applyHeroTheme(w.kind, w.is_day);
  if (icon) icon.textContent = w.is_day ? WX_ICON[w.kind] || "☀️" : w.kind === "clear" || w.kind === "partly" ? "🌙" : WX_ICON[w.kind] || "🌙";
  const rain = w.rain_prob != null ? `・降雨機率 ${w.rain_prob}%` : "";
  line.textContent = `${w.city} ${w.temp}°C・${w.label}${rain}`;
}

// 切換深色 / 淺色模式時,橫幅配色跟著換
new MutationObserver(() => _applyHeroTheme(_wxLast.kind, _wxLast.isDay)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// 取得裝置位置:快取 30 分鐘(localStorage),過期才重新問瀏覽器;定位被拒絕/逾時回傳 null。
function _wxPosition() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("wxPos") || "null"); } catch (e) {}
  if (cached && Date.now() - cached.t < 30 * 60 * 1000) return Promise.resolve(cached);
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(cached);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const v = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };
        try { localStorage.setItem("wxPos", JSON.stringify(v)); } catch (e) {}
        resolve(v);
      },
      () => resolve(cached),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30 * 60 * 1000 }
    );
  });
}
