"use strict";

async function api(path, { method = "GET", body, isForm = false, params, silent = false } = {}) {
  let url = API_BASE + path;
  if (params) {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (entries.length) url += "?" + new URLSearchParams(entries).toString();
  }
  const headers = {};
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  let fetchBody;
  if (isForm) {
    fetchBody = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: fetchBody });
  } catch (err) {
    toast("無法連線到伺服器", "error");
    throw err;
  }

  if (res.status === 401) {
    if (!silent) toast("登入已逾期,請重新登入", "error");
    doLogout();
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
    } catch (e) { }
    if (!silent) toast(detail, "error");
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function toast(message, type = "info") {
  if (!message || !String(message).trim()) return;
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
