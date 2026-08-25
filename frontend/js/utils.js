"use strict";

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const isoWithZone = /[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(isoWithZone);
  if (isNaN(d)) return iso;
  return d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso) {
  if (!iso) return "-";
  return String(iso).slice(0, 10);
}

function fmtPct(ratio) {
  return (ratio * 100).toFixed(1) + "%";
}

function fmtMoney(n) {
  return Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

// L1-L4: general case-data editing (landowners/contacts/expenses/encumbrances/SOP).
function isEditor() {
  return state.user && ["sys_admin", "manager", "case_owner", "case_staff"].includes(state.user.role);
}

// L1/L2: full cross-project management (delete/force actions, expense categories, member assignment).
function isManager() {
  return state.user && ["sys_admin", "manager"].includes(state.user.role);
}

// L1 only: user account management, login logs.
function isSystemAdmin() {
  return state.user && state.user.role === "sys_admin";
}

// L1-L5: OCR/document-upload functionality.
function canOcr() {
  return state.user && ["sys_admin", "manager", "case_owner", "case_staff", "ocr_staff"].includes(state.user.role);
}

// L1-L3: can create a new project.
function canCreateProject() {
  return state.user && ["sys_admin", "manager", "case_owner"].includes(state.user.role);
}
