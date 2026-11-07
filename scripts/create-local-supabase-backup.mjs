import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import {
  BACKUP_TABLES,
  createFullBackupSnapshot,
  getSnapshotRowCount,
  isSnapshotPartial,
  validateBackupSnapshot,
} from '../src/lib/supabaseBackupUtils.js';

const DEFAULT_MAX_AUTO_BACKUPS = 20;
const SUPABASE_WRITE_DIFF_PATTERN = /(\.upsert\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|applyScheduleStatsMutation|syncMonthShockwaveScheduleToStats|syncMonthManualTherapyScheduleToStats|saveShockwaveMemo|saveStaffMemo|saveCArmMonth|saveMonthlyTherapistConfigs|saveTherapistRosterSafely)/;

function resolveDiffRange() {
  for (const candidate of ['@{u}..HEAD', 'origin/main..HEAD', 'HEAD~1..HEAD']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate.split('..')[0]], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try next fallback range
    }
  }
  return null;
}

function hasSupabaseDataMutationRiskInGitDiff() {
  const range = resolveDiffRange();
  if (!range) return false;

  let changedFiles = [];
  try {
    const out = execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf8' });
    changedFiles = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return false;
  }

  if (changedFiles.length === 0) return false;
  if (changedFiles.some((file) => file.endsWith('.sql'))) return true;

  const codeFiles = changedFiles.filter((file) => (
    /\.(js|jsx|mjs|ts|tsx)$/.test(file)
    && !file.endsWith('.test.js')
    && !file.includes('__tests__/')
    && file !== 'scripts/create-local-supabase-backup.mjs'
  ));

  if (codeFiles.length === 0) return false;

  try {
    const diffText = execFileSync('git', ['diff', '-U0', range, '--', ...codeFiles], { encoding: 'utf8' });
    const changedCodeLines = diffText
      .split(/\r?\n/)
      .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'));
    return changedCodeLines.some((line) => SUPABASE_WRITE_DIFF_PATTERN.test(line));
  } catch {
    return false;
  }
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) return;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

function loadEnv() {
  const cwd = process.cwd();
  ['.env.backup.local', '.env.backup', '.env.local', '.env'].forEach((fileName) => {
    parseEnvFile(path.join(cwd, fileName));
  });
}

function extractProjectIdentifier() {
  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch {
    return 'supabase-local';
  }
}

function findRecentBackup(backupDir, maxAgeHours) {
  if (!existsSync(backupDir) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return null;
  const cutoffMs = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith('auto-prepush-') && name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const recent = files.find((item) => item.mtimeMs >= cutoffMs);
  if (!recent) return null;

  try {
    const parsed = validateBackupSnapshot(JSON.parse(readFileSync(recent.fullPath, 'utf8')));
    if (!isSnapshotPartial(parsed) && getSnapshotRowCount(parsed) > 0) {
      return recent;
    }
  } catch {
    return null;
  }
  return null;
}

function pruneOldAutoBackups(backupDir, maxKeep = DEFAULT_MAX_AUTO_BACKUPS) {
  if (!existsSync(backupDir)) return;
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith('auto-prepush-') && name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  files.slice(maxKeep).forEach((oldFile) => {
    try {
      unlinkSync(oldFile.fullPath);
    } catch {
      // Ignore cleanup errors
    }
  });
}

async function createSnapshotViaPg(databaseUrl, reason) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const createdAt = new Date().toISOString();
  const snapshot = {
    id: `snapshot-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'full_snapshot',
    app: 'clinic-schedule-manager',
    schema_version: 1,
    created_at: createdAt,
    reason,
    source: {
      hostname: 'local-mac-pg',
      project: extractProjectIdentifier(),
    },
    tables: {},
  };

  try {
    for (const tableConfig of BACKUP_TABLES) {
      const orderClause = Array.isArray(tableConfig.order) && tableConfig.order.length > 0
        ? `ORDER BY ${tableConfig.order.map((col) => `"${col}" ASC`).join(', ')}`
        : '';
      const sql = `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) AS rows FROM (SELECT * FROM public."${tableConfig.name}" ${orderClause}) t`;
      const res = await client.query(sql);
      const rows = Array.isArray(res.rows?.[0]?.rows) ? res.rows[0].rows : [];
      snapshot.tables[tableConfig.name] = {
        label: tableConfig.label,
        rows,
        count: rows.length,
      };
    }
  } finally {
    await client.end().catch(() => {});
  }

  snapshot.total_rows = getSnapshotRowCount(snapshot);
  snapshot.partial = isSnapshotPartial(snapshot);
  return snapshot;
}

async function createSnapshotViaRest(reason) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase 접속 정보(DATABASE_URL 또는 VITE_SUPABASE_URL/KEY)가 없습니다.');
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createFullBackupSnapshot(supabase, { reason });
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const hoursArg = args.find((arg) => arg.startsWith('--if-older-than-hours='));
  const maxAgeHours = force ? 0 : (hoursArg ? Number(hoursArg.split('=')[1]) : 0);
  const reason = args.includes('--pre-push') ? 'pre-push' : 'local-cli';

  const backupDir = path.resolve(process.cwd(), 'backups');
  mkdirSync(backupDir, { recursive: true });

  if (!force && reason === 'pre-push' && !hasSupabaseDataMutationRiskInGitDiff()) {
    console.log('[로컬 백업 생략] Supabase 데이터 쓰기·삭제·스키마와 무관한 코드 수정이므로 백업을 건너뜁니다.');
    return;
  }

  if (!force && maxAgeHours > 0) {
    const recent = findRecentBackup(backupDir, maxAgeHours);
    if (recent) {
      console.log(`[로컬 백업 확인] 최근 ${maxAgeHours}시간 이내 생성된 백업이 이미 존재하여 추가 다운로드를 생략합니다: backups/${recent.name}`);
      return;
    }
  }

  let snapshot = null;
  if (process.env.DATABASE_URL) {
    try {
      snapshot = await createSnapshotViaPg(process.env.DATABASE_URL, reason);
    } catch (pgErr) {
      console.warn('[로컬 백업] 직접 DB 연결 백업 실패, REST API로 재시도합니다:', pgErr.message);
    }
  }
  if (!snapshot) {
    snapshot = await createSnapshotViaRest(reason);
  }

  const stamp = snapshot.created_at.replace(/[:.]/g, '-');
  const project = extractProjectIdentifier();
  const prefix = reason === 'pre-push' ? 'auto-prepush' : 'manual-local';
  const fileName = `${prefix}-${project}-${stamp}.json`;
  const filePath = path.join(backupDir, fileName);

  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
  chmodSync(filePath, 0o600);

  const verified = validateBackupSnapshot(JSON.parse(readFileSync(filePath, 'utf8')));
  if (isSnapshotPartial(verified) || getSnapshotRowCount(verified) === 0) {
    throw new Error(`백업 검증 실패: 일부 테이블 오류 또는 0행 결과 (${fileName})`);
  }

  pruneOldAutoBackups(backupDir, DEFAULT_MAX_AUTO_BACKUPS);
  console.log(`[로컬 백업 완료] backups/${fileName} (총 ${getSnapshotRowCount(verified).toLocaleString()}행, 테이블 ${BACKUP_TABLES.length}개 검증 완료)`);
}

main().catch((error) => {
  console.error('[로컬 백업 오류]', error?.message || error);
  process.exit(1);
});

