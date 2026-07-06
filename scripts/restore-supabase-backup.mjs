import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import {
  BACKUP_TABLES,
  getSnapshotRowCount,
  isSnapshotPartial,
  validateBackupSnapshot,
} from '../src/lib/supabaseBackupUtils.js';

const APPLY_FLAG = '--apply';
const ACK_FLAG = '--i-understand-this-writes-to-supabase';
const CHUNK_SIZE = 200;

function usage() {
  console.log(`
Usage:
  npm run restore:supabase-backup -- /path/to/backup.json --dry-run
  npm run restore:supabase-backup -- /path/to/backup.json --apply --i-understand-this-writes-to-supabase

Default behavior is dry-run. This script never deletes Supabase rows.
`);
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

function getRows(snapshot, tableName) {
  const tableBackup = snapshot.tables?.[tableName];
  return Array.isArray(tableBackup?.rows) ? tableBackup.rows : [];
}

function printPlan(snapshot) {
  console.log(`Backup created_at: ${snapshot.created_at || '-'}`);
  console.log(`Total rows: ${getSnapshotRowCount(snapshot).toLocaleString()}`);
  console.log(`Partial backup: ${isSnapshotPartial(snapshot) ? 'YES' : 'NO'}`);
  console.log('');
  BACKUP_TABLES.forEach((table) => {
    const tableBackup = snapshot.tables?.[table.name];
    const rows = getRows(snapshot, table.name);
    const errorSuffix = tableBackup?.error ? ` | BACKUP ERROR: ${tableBackup.error}` : '';
    const sensitiveSuffix = table.sensitive ? ' | sensitive' : '';
    console.log(`${table.name}: ${rows.length.toLocaleString()} rows${sensitiveSuffix}${errorSuffix}`);
  });
}

function getSupabaseClient() {
  loadEnv();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase URL/key가 없습니다. .env.backup.local 또는 환경변수에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정하세요.');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function upsertTable(supabase, tableConfig, rows) {
  if (rows.length === 0) return { count: 0 };
  const onConflict = tableConfig.conflictColumns?.join(',');
  let count = 0;
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase
      .from(tableConfig.name)
      .upsert(chunk, onConflict ? { onConflict } : undefined);
    if (error) throw error;
    count += chunk.length;
  }
  return { count };
}

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('--'));
  const apply = args.includes(APPLY_FLAG);
  const acknowledged = args.includes(ACK_FLAG);

  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  if (!filePath) {
    usage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const snapshot = validateBackupSnapshot(JSON.parse(readFileSync(resolvedPath, 'utf8')));
  printPlan(snapshot);

  if (!apply) {
    console.log('\nDry-run only. No Supabase writes were executed.');
    console.log(`To restore, rerun with ${APPLY_FLAG} ${ACK_FLAG}`);
    return;
  }

  if (!acknowledged) {
    console.error(`\nRefusing to write. Add ${ACK_FLAG} if you intentionally want to upsert this backup into Supabase.`);
    process.exit(1);
  }

  const supabase = getSupabaseClient();
  console.log('\nApplying backup with upsert only. No deletes will be executed.');

  for (const table of BACKUP_TABLES) {
    if (snapshot.tables?.[table.name]?.error) {
      console.warn(`Skipping ${table.name}: snapshot contains table error.`);
      continue;
    }
    const rows = getRows(snapshot, table.name);
    const result = await upsertTable(supabase, table, rows);
    console.log(`Restored ${table.name}: ${result.count.toLocaleString()} rows`);
  }

  console.log('\nRestore finished. Review the app before making any further DB changes.');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
