"use strict";

const API_BASE = "/api";

const state = {
  token: sessionStorage.getItem("token") || null,
  user: null,
  currentProjectId: null,
  currentProject: null,
  activeTab: "sop",
  projectCache: {},
  selectedContactLandownerId: null,
  sopSelectedStage: null,
};

const CONTACT_STATUS_LABEL = { not_contacted: "未聯絡", contacted: "已聯絡", declined: "婉拒", agreed: "同意" };
const AGREEMENT_STATUS_LABEL = { not_signed: "未簽約", signed: "已簽約" };
const CONSENT_STATUS_LABEL = { pending: "待確認", agreed: "同意", opposed: "反對" };
const PROJECT_STATUS_LABEL = { active: "進行中", closed: "已結案", suspended: "暫停" };

const TAIWAN_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

const DOC_TYPE_LABEL = {
  property_register: "土地登記謄本", building_register: "建物登記謄本", consent_form: "同意書", briefing_material: "說明會資料",
  contract: "合約", photo: "照片", other: "其他",
  dev_letter_template: "開發信", willingness_form_template: "意願書",
  consent_form_template: "同意書", contract_template: "合約",
  cadastral_map: "地籍圖", consultant_document: "顧問文件",
};

const DOC_TYPE_KEYWORDS = {
  dev_letter_template: ["開發信", "致住戶", "說明信", "開發", "letter", "dev"],
  willingness_form_template: ["意願書", "意願", "參與意願", "意願調查", "willingness", "willing"],
  consent_form_template: ["同意書", "都更同意", "更新同意", "consent"],
  consent_form: ["同意書", "都更同意", "更新同意", "consent"],
  contract_template: ["合約", "契約", "協議書", "合約範本", "contract", "agreement"],
  contract: ["合約", "契約", "協議書", "contract", "agreement"],
  property_register: ["土地登記", "土地謄本", "第一類謄本", "第二類謄本", "第三類謄本", "地號", "land", "deed"],
  building_register: ["建物登記", "建物謄本", "建號謄本", "建號", "building"],
  cadastral_map: ["地籍圖", "地籍", "圖資", "cadastral", "map"],
  consultant_document: ["顧問文件", "顧問", "評估", "報告", "規劃", "建築師", "估價", "consultant", "report"],
  briefing_material: ["說明會", "簡報", "簡報資料", "會議記錄", "briefing", "presentation"],
};

const CONTACT_METHOD_LABEL = { phone: "電話", visit: "訪視", mail: "郵寄", email: "電子郵件", briefing: "說明會", other: "其他" };
const CONTACT_RESULT_LABEL = { no_answer: "未接聽", agreed: "同意", opposed: "反對", undecided: "未決定", callback_needed: "需回電" };

const OCR_JOB_STATUS_LABEL = { pending: "等待中", processing: "辨識中", completed: "已完成", failed: "失敗" };

const ROLE_LABEL = {
  sys_admin: "L1 系統管理員",
  manager: "L2 都更主管",
  case_owner: "L3 案件負責人",
  case_staff: "L4 案件工作人員",
  ocr_staff: "L5 資料/OCR人員",
  viewer: "L6 查詢/檢視人員",
};
