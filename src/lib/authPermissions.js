import { Calendar, ClipboardList, Hand, Settings, Zap, Activity } from 'lucide-react';

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = '1';

export const APP_TABS = [
  { key: 'staff_schedule', path: '/', icon: Calendar, label: '직원 근무표', shortLabel: '근무표', monthLabel: '직원 근무표', tabClass: 'top-tab--calendar' },
  { key: 'shockwave', path: '/shockwave', icon: ClipboardList, label: '충격파/도수 스케줄', shortLabel: '충격파/도수 스케줄', monthLabel: '충격파/도수 스케줄', tabClass: 'top-tab--shockwave' },
  { key: 'shockwave_stats', path: '/shockwave-stats', icon: Zap, label: '충격파 통계', shortLabel: '충격파 통계', monthLabel: '충격파 통계', tabClass: 'top-tab--stats-sw' },
  { key: 'manual_therapy_stats', path: '/manual-therapy-stats', icon: Hand, label: '도수치료 통계', shortLabel: '도수통계', monthLabel: '도수치료 통계', tabClass: 'top-tab--stats-mt' },
  { key: 'pt_stats', path: '/pt-stats', icon: Activity, label: '물리치료 통계', shortLabel: '물리치료 통계', monthLabel: '물리치료 통계', tabClass: 'top-tab--stats-pt' },
  { key: 'settings', path: '/settings', icon: Settings, label: '설정', shortLabel: '설정', tabClass: 'top-tab--settings' },
];

export const DEFAULT_USER_PERMISSIONS = APP_TABS.reduce((acc, tab) => {
  acc[tab.key] = true;
  return acc;
}, {});

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function isAdminUser(user) {
  const username = normalizeUsername(user?.username || user?.email);
  return user?.isAdmin === true || user?.app_role === 'admin' || username === ADMIN_USERNAME;
}

export function normalizePermissions(permissions, user) {
  if (isAdminUser(user)) return { ...DEFAULT_USER_PERMISSIONS };
  if (!permissions || typeof permissions !== 'object') return { ...DEFAULT_USER_PERMISSIONS };
  return APP_TABS.reduce((acc, tab) => {
    acc[tab.key] = permissions[tab.key] !== false;
    return acc;
  }, {});
}

export function getAllowedTabs(user) {
  const permissions = normalizePermissions(user?.app_permissions, user);
  return APP_TABS.filter((tab) => permissions[tab.key]);
}

export function canAccessTab(user, tabKey) {
  if (isAdminUser(user)) return true;
  const permissions = normalizePermissions(user?.app_permissions, user);
  return permissions[tabKey] !== false;
}

export function canAccessPath(user, path) {
  const tab = APP_TABS.find((item) => item.path === path);
  if (!tab) return true;
  return canAccessTab(user, tab.key);
}

export function getFirstAllowedPath(user) {
  return getAllowedTabs(user)[0]?.path || '/settings';
}

export function createDefaultPermissions() {
  return { ...DEFAULT_USER_PERMISSIONS };
}
