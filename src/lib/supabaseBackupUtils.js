export const BACKUP_SETTINGS_STORAGE_KEY = 'abs.supabaseBackup.settings.v1';
export const BACKUP_LAST_AUTO_SNAPSHOT_KEY = 'abs.supabaseBackup.lastAutoSnapshotAt.v1';
export const BACKUP_SETTINGS_EVENT = 'abs:supabase-backup-settings-changed';

const BACKUP_DB_NAME = 'clinic-supabase-backups';
const BACKUP_DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const CHANGE_EVENT_STORE = 'change_events';
const DEFAULT_MAX_SNAPSHOTS = 72;
const DEFAULT_MAX_CHANGE_EVENTS = 20000;
const PAGE_SIZE = 1000;

export const BACKUP_TABLES = [
  {
    name: 'staff_schedules',
    label: '직원 근무표',
    order: ['year', 'month', 'day', 'slot_index'],
    conflictColumns: ['year', 'month', 'day', 'slot_index'],
  },
  {
    name: 'shockwave_schedules',
    label: '충격파/도수 스케줄',
    order: ['year', 'month', 'week_index', 'day_index', 'row_index', 'col_index'],
    conflictColumns: ['year', 'month', 'week_index', 'day_index', 'row_index', 'col_index'],
  },
  {
    name: 'shockwave_patient_logs',
    label: '충격파 환자 로그',
    order: ['date', 'therapist_name', 'patient_name'],
    conflictColumns: ['id'],
  },
  {
    name: 'manual_therapy_patient_logs',
    label: '도수치료 환자 로그',
    order: ['date', 'therapist_name', 'patient_name'],
    conflictColumns: ['id'],
  },
  {
    name: 'shockwave_settings',
    label: '충격파 설정',
    order: ['updated_at'],
    conflictColumns: ['id'],
  },
  {
    name: 'shockwave_therapists',
    label: '충격파 치료사',
    order: ['slot_index'],
    conflictColumns: ['id'],
  },
  {
    name: 'manual_therapy_therapists',
    label: '도수치료 치료사',
    order: ['slot_index'],
    conflictColumns: ['id'],
  },
  {
    name: 'shockwave_monthly_therapists',
    label: '월별 치료사 배정',
    order: ['year', 'month', 'type', 'slot_index', 'start_day'],
    conflictColumns: ['year', 'month', 'slot_index', 'start_day', 'type'],
  },
  {
    name: 'staff_calendar_settings',
    label: '근무표 슬롯 설정',
    order: ['year', 'month'],
    conflictColumns: ['year', 'month'],
  },
  {
    name: 'holidays',
    label: '공휴일',
    order: ['date'],
    conflictColumns: ['date'],
  },
  {
    name: 'notices',
    label: '공지',
    order: ['slot_index'],
    conflictColumns: ['slot_index'],
  },
  {
    name: 'app_users',
    label: '앱 로그인 사용자',
    order: ['username'],
    conflictColumns: ['username'],
    sensitive: true,
  },
];

export const BACKUP_REALTIME_TABLES = [
  'shockwave_schedules',
  'staff_schedules',
];

export const DEFAULT_BACKUP_SETTINGS = {
  autoSnapshotEnabled: false,
  realtimeEnabled: false,
  snapshotIntervalMinutes: 10,
  maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
};

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openBackupDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('이 브라우저에서는 IndexedDB 백업 저장소를 사용할 수 없습니다.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const snapshotStore = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        snapshotStore.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains(CHANGE_EVENT_STORE)) {
        const eventStore = db.createObjectStore(CHANGE_EVENT_STORE, { keyPath: 'id', autoIncrement: true });
        eventStore.createIndex('created_at', 'created_at');
        eventStore.createIndex('table', 'table');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeBackupSettings(value = {}) {
  const interval = Number(value.snapshotIntervalMinutes);
  const maxSnapshots = Number(value.maxSnapshots);
  return {
    autoSnapshotEnabled: Boolean(value.autoSnapshotEnabled),
    realtimeEnabled: Boolean(value.realtimeEnabled),
    snapshotIntervalMinutes: [5, 10, 30, 60].includes(interval) ? interval : DEFAULT_BACKUP_SETTINGS.snapshotIntervalMinutes,
    maxSnapshots: Number.isFinite(maxSnapshots) && maxSnapshots >= 12 ? Math.min(500, Math.round(maxSnapshots)) : DEFAULT_MAX_SNAPSHOTS,
  };
}

export function readBackupSettings() {
  if (typeof window === 'undefined') return DEFAULT_BACKUP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(BACKUP_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_BACKUP_SETTINGS;
    return normalizeBackupSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_BACKUP_SETTINGS;
  }
}

export function writeBackupSettings(nextSettings) {
  const normalized = normalizeBackupSettings(nextSettings);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(BACKUP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(BACKUP_SETTINGS_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function getBackupTableConfig(tableName) {
  return BACKUP_TABLES.find((table) => table.name === tableName);
}

function getTableRows(snapshot, tableName) {
  const table = snapshot?.tables?.[tableName];
  return Array.isArray(table?.rows) ? table.rows : [];
}

export function getSnapshotRowCount(snapshot) {
  return BACKUP_TABLES.reduce((sum, table) => sum + getTableRows(snapshot, table.name).length, 0);
}

export function isSnapshotPartial(snapshot) {
  if (!snapshot?.tables) return true;
  return BACKUP_TABLES.some((table) => snapshot.tables[table.name]?.error);
}

export function createBackupFileName(snapshot, extension = 'json') {
  const rawDate = snapshot?.created_at || new Date().toISOString();
  const stamp = rawDate.replace(/[:.]/g, '-');
  return `clinic-supabase-backup-${stamp}.${extension}`;
}

export function downloadTextFile(text, fileName, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadSnapshotJson(snapshot) {
  downloadTextFile(
    JSON.stringify(snapshot, null, 2),
    createBackupFileName(snapshot),
    'application/json;charset=utf-8'
  );
}

export function createRestoreReadme(snapshot) {
  const rowCount = getSnapshotRowCount(snapshot);
  const tableLines = BACKUP_TABLES.map((table) => {
    const tableBackup = snapshot?.tables?.[table.name];
    const count = Array.isArray(tableBackup?.rows) ? tableBackup.rows.length : 0;
    const suffix = tableBackup?.error ? ` - ERROR: ${tableBackup.error}` : '';
    return `- ${table.name}: ${count} rows${suffix}`;
  }).join('\n');

  return `# Clinic Supabase Backup Restore

백업 파일: ${createBackupFileName(snapshot)}
백업 생성 시각: ${snapshot?.created_at || '-'}
총 행 수: ${rowCount}
부분 백업 여부: ${isSnapshotPartial(snapshot) ? '예' : '아니오'}

## 복구 순서

1. Supabase SQL Editor에서 repo의 \`supabase_schema.sql\`을 먼저 실행해 테이블 구조를 복구합니다.
2. 백업 JSON 파일을 안전한 위치에 둡니다.
3. 먼저 dry-run으로 확인합니다.

\`\`\`bash
node scripts/restore-supabase-backup.mjs /path/to/${createBackupFileName(snapshot)} --dry-run
\`\`\`

4. 출력된 테이블/행 수가 맞을 때만 실제 복구를 실행합니다.

\`\`\`bash
node scripts/restore-supabase-backup.mjs /path/to/${createBackupFileName(snapshot)} --apply --i-understand-this-writes-to-supabase
\`\`\`

주의: 복구 스크립트는 삭제를 실행하지 않고 insert/upsert만 수행합니다.

## 포함 테이블

${tableLines}
`;
}

export function downloadRestoreReadme(snapshot) {
  downloadTextFile(
    createRestoreReadme(snapshot),
    createBackupFileName(snapshot, 'restore.md')
  );
}

function applyTableOrdering(query, orderColumns) {
  return orderColumns.reduce((nextQuery, column) => nextQuery.order(column, { ascending: true }), query);
}

async function fetchTableRows(supabase, tableConfig) {
  const rows = [];
  let page = 0;

  while (true) {
    let query = supabase
      .from(tableConfig.name)
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    query = applyTableOrdering(query, tableConfig.order || []);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

export async function createFullBackupSnapshot(supabase, options = {}) {
  const createdAt = new Date().toISOString();
  const snapshot = {
    id: options.id || `snapshot-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'full_snapshot',
    app: 'clinic-schedule-manager',
    schema_version: 1,
    created_at: createdAt,
    reason: options.reason || 'manual',
    source: {
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'local',
    },
    tables: {},
  };

  for (const tableConfig of BACKUP_TABLES) {
    try {
      const rows = await fetchTableRows(supabase, tableConfig);
      snapshot.tables[tableConfig.name] = {
        label: tableConfig.label,
        rows,
        count: rows.length,
      };
    } catch (error) {
      snapshot.tables[tableConfig.name] = {
        label: tableConfig.label,
        rows: [],
        count: 0,
        error: error?.message || String(error),
      };
    }
  }

  snapshot.total_rows = getSnapshotRowCount(snapshot);
  snapshot.partial = isSnapshotPartial(snapshot);
  return snapshot;
}

export async function saveBackupSnapshot(snapshot, options = {}) {
  const db = await openBackupDb();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
  await transactionDone(transaction);
  db.close();
  await pruneBackupSnapshots(options.maxSnapshots || DEFAULT_MAX_SNAPSHOTS);
  return snapshot;
}

export async function listBackupSnapshots() {
  const db = await openBackupDb();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
  const snapshots = await requestToPromise(transaction.objectStore(SNAPSHOT_STORE).getAll());
  await transactionDone(transaction);
  db.close();
  return (snapshots || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getBackupSnapshot(id) {
  if (!id) return null;
  const db = await openBackupDb();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
  const snapshot = await requestToPromise(transaction.objectStore(SNAPSHOT_STORE).get(id));
  await transactionDone(transaction);
  db.close();
  return snapshot || null;
}

export async function deleteBackupSnapshot(id) {
  const db = await openBackupDb();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOT_STORE).delete(id);
  await transactionDone(transaction);
  db.close();
}

export async function pruneBackupSnapshots(maxSnapshots = DEFAULT_MAX_SNAPSHOTS) {
  const snapshots = await listBackupSnapshots();
  const removeTargets = snapshots.slice(maxSnapshots);
  if (removeTargets.length === 0) return;
  const db = await openBackupDb();
  const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
  const store = transaction.objectStore(SNAPSHOT_STORE);
  removeTargets.forEach((snapshot) => store.delete(snapshot.id));
  await transactionDone(transaction);
  db.close();
}

export async function importBackupSnapshot(snapshot, options = {}) {
  const validated = validateBackupSnapshot(snapshot);
  return saveBackupSnapshot(validated, options);
}

export function validateBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('백업 파일 형식이 올바르지 않습니다.');
  }
  if (!snapshot.tables || typeof snapshot.tables !== 'object') {
    throw new Error('백업 파일에 tables 데이터가 없습니다.');
  }
  const next = {
    ...snapshot,
    id: snapshot.id || `imported-${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: snapshot.created_at || new Date().toISOString(),
    kind: snapshot.kind || 'full_snapshot',
    schema_version: snapshot.schema_version || 1,
  };
  next.total_rows = getSnapshotRowCount(next);
  next.partial = isSnapshotPartial(next);
  return next;
}

export async function appendBackupChangeEvent(event, options = {}) {
  const db = await openBackupDb();
  const createdAt = new Date().toISOString();
  const transaction = db.transaction(CHANGE_EVENT_STORE, 'readwrite');
  transaction.objectStore(CHANGE_EVENT_STORE).add({
    ...event,
    created_at: createdAt,
  });
  await transactionDone(transaction);
  db.close();
  await pruneBackupChangeEvents(options.maxEvents || DEFAULT_MAX_CHANGE_EVENTS);
}

export async function listBackupChangeEvents(limit = 500) {
  const db = await openBackupDb();
  const transaction = db.transaction(CHANGE_EVENT_STORE, 'readonly');
  const events = await requestToPromise(transaction.objectStore(CHANGE_EVENT_STORE).getAll());
  await transactionDone(transaction);
  db.close();
  return (events || [])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

export async function getBackupChangeEventCount() {
  const db = await openBackupDb();
  const transaction = db.transaction(CHANGE_EVENT_STORE, 'readonly');
  const count = await requestToPromise(transaction.objectStore(CHANGE_EVENT_STORE).count());
  await transactionDone(transaction);
  db.close();
  return count || 0;
}

export async function clearBackupChangeEvents() {
  const db = await openBackupDb();
  const transaction = db.transaction(CHANGE_EVENT_STORE, 'readwrite');
  transaction.objectStore(CHANGE_EVENT_STORE).clear();
  await transactionDone(transaction);
  db.close();
}

async function pruneBackupChangeEvents(maxEvents = DEFAULT_MAX_CHANGE_EVENTS) {
  const db = await openBackupDb();
  const transaction = db.transaction(CHANGE_EVENT_STORE, 'readwrite');
  const store = transaction.objectStore(CHANGE_EVENT_STORE);
  const events = await requestToPromise(store.getAll());
  const sorted = (events || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const removeTargets = sorted.slice(maxEvents);
  removeTargets.forEach((event) => store.delete(event.id));
  await transactionDone(transaction);
  db.close();
}
