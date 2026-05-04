global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = value; },
  removeItem(key) { delete this.store[key]; }
};

const DEFAULT_STAFF_DEPARTMENTS = ['PT', '간호'];
const STAFF_DEPARTMENT_STORAGE_KEY = 'staff-schedule-departments';

const DEPARTMENT_ALIASES = { pt: 'PT', physical: 'PT', 물리치료: 'PT', 간호: '간호', 충격파: '충격파', shock: '충격파', sw: '충격파' };

function normalizeDepartmentName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return DEPARTMENT_ALIASES[raw.toLowerCase()] || DEPARTMENT_ALIASES[raw] || raw;
}

function normalizeStaffDepartmentList(value) {
  const list = Array.isArray(value) ? value : DEFAULT_STAFF_DEPARTMENTS;
  const seen = new Set();
  return list
    .map((item) => normalizeDepartmentName(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function readStoredStaffDepartments() {
  if (typeof localStorage === 'undefined') return DEFAULT_STAFF_DEPARTMENTS;
  try {
    const parsed = JSON.parse(localStorage.getItem(STAFF_DEPARTMENT_STORAGE_KEY) || 'null');
    const normalized = normalizeStaffDepartmentList(parsed);
    return normalized.length > 0 ? normalized : DEFAULT_STAFF_DEPARTMENTS;
  } catch {
    return DEFAULT_STAFF_DEPARTMENTS;
  }
}

function saveStoredStaffDepartments(departments) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    STAFF_DEPARTMENT_STORAGE_KEY,
    JSON.stringify(normalizeStaffDepartmentList(departments))
  );
}

// simulate NoticeBoard adding '원무과'
const prev = readStoredStaffDepartments();
const next = [...prev, '원무과'];
saveStoredStaffDepartments(next);

console.log("LocalStorage after save:", localStorage.getItem(STAFF_DEPARTMENT_STORAGE_KEY));
console.log("Read after save:", readStoredStaffDepartments());
