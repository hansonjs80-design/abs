import { Activity, Calendar, ClipboardList, Hand, Settings, Waves, Zap } from 'lucide-react';

export const ADMIN_USERNAME = 'admin';

export const APP_TABS = [
  { key: 'staff_schedule', path: '/', icon: Calendar, label: '직원 근무표', shortLabel: '근무표', monthLabel: '직원 근무표', tabClass: 'top-tab--calendar' },
  { key: 'shockwave', path: '/shockwave', icon: ClipboardList, label: '충격파/도수 스케줄', shortLabel: '스케줄', monthLabel: '충격파/도수 스케줄', tabClass: 'top-tab--shockwave' },
  { key: 'shockwave_stats', path: '/shockwave-stats', icon: Zap, label: '충격파 통계', shortLabel: '충격파', monthLabel: '충격파 통계', tabClass: 'top-tab--stats-sw' },
  { key: 'shinjang_spray_stats', path: '/shinjang-spray-stats', icon: Waves, label: '신장분사 통계', shortLabel: '신장분사', monthLabel: '신장분사 통계', tabClass: 'top-tab--stats-shinjang' },
  { key: 'manual_therapy_stats', path: '/manual-therapy-stats', icon: Hand, label: '도수치료 통계', shortLabel: '도수', monthLabel: '도수치료 통계', tabClass: 'top-tab--stats-mt' },
  { key: 'pt_stats', path: '/pt-stats', icon: Activity, label: '물리치료 통계', shortLabel: '물리', monthLabel: '물리치료 통계', tabClass: 'top-tab--stats-pt' },
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
  return user?.isAdmin === true ||
    user?.app_role === 'admin' ||
    user?.app_metadata?.role === 'admin';
}

export function normalizePermissions(permissions, user) {
  if (isAdminUser(user)) return { ...DEFAULT_USER_PERMISSIONS };
  const effectivePermissions = permissions && typeof permissions === 'object'
    ? permissions
    : user?.app_metadata?.permissions;
  if (!effectivePermissions || typeof effectivePermissions !== 'object') {
    return { ...DEFAULT_USER_PERMISSIONS };
  }
  return APP_TABS.reduce((acc, tab) => {
    acc[tab.key] = effectivePermissions[tab.key] !== false;
    return acc;
  }, {});
}

export function getAllowedTabs(user) {
  const permissions = normalizePermissions(user?.app_permissions, user);
  const isAdmin = isAdminUser(user);
  return APP_TABS.filter((tab) => {
    if (tab.key === 'settings') return isAdmin;
    return permissions[tab.key];
  });
}

export function canAccessTab(user, tabKey) {
  if (isAdminUser(user)) return true;
  if (tabKey === 'settings') return false;
  const permissions = normalizePermissions(user?.app_permissions, user);
  return permissions[tabKey] !== false;
}

export function canAccessPath(user, path) {
  const tab = APP_TABS.find((item) => item.path === path);
  if (!tab) return true;
  return canAccessTab(user, tab.key);
}

export function getFirstAllowedPath(user) {
  return getAllowedTabs(user)[0]?.path || '/';
}

export function createDefaultPermissions() {
  return { ...DEFAULT_USER_PERMISSIONS };
}
