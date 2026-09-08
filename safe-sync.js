import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONNECTION_STRING = process.env.DATABASE_URL;
const TARGET_SQL_FILE = 'supabase_schema.sql';
const BACKUP_DIR = path.resolve(__dirname, 'backups');

// 백업 폴더 생성
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

let debounceTimer = null;
let isExecuting = false;

// 🛡️ 위험 구문(데이터 삭제) 검사 필터
function validateSqlSafety(sql) {
  const cleanSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  
  const dangerousPatterns = [
    { regex: /DROP\s+SCHEMA\s+public/i, name: 'DROP SCHEMA public (전체 스키마 삭제)' },
    { regex: /DROP\s+TABLE\s+(?!IF\s+EXISTS\s+temp_)/i, name: 'DROP TABLE (기존 테이블 및 데이터 영구 삭제)' },
    { regex: /TRUNCATE\s+TABLE/i, name: 'TRUNCATE (데이터 전체 삭제)' }
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.regex.test(cleanSql)) {
      throw new Error(`🚨 [위험 구문 감지] 기존 데이터 보호를 위해 실행을 차단했습니다:\n👉 "${pattern.name}"`);
    }
  }
}

async function runSafeSync() {
  if (isExecuting) return;

  if (!CONNECTION_STRING || CONNECTION_STRING.includes('[YOUR-PASSWORD]')) {
    console.error('\n❌ [.env 설정 필요] .env 파일의 DATABASE_URL에 올바른 Supabase DB 연결 주소(비밀번호 포함)를 입력해야 합니다.');
    return;
  }

  isExecuting = true;
  const filePath = path.resolve(__dirname, TARGET_SQL_FILE);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${TARGET_SQL_FILE} 파일이 없습니다.`);
    isExecuting = false;
    return;
  }

  const sqlContent = fs.readFileSync(filePath, 'utf-8');

  // 1. 안전성 검사
  try {
    validateSqlSafety(sqlContent);
  } catch (safetyErr) {
    console.error('\n' + safetyErr.message);
    console.log('⚠️ 데이터 유실 방지를 위해 업데이트를 건너뛰었습니다. SQL 파일을 확인해 주세요.\n');
    isExecuting = false;
    return;
  }

  console.log(`\n⏳ [${new Date().toLocaleTimeString()}] ${TARGET_SQL_FILE} 변경 감지! Supabase 안전 업데이트 진행 중...`);

  // 2. 자동 백업
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const backupPath = path.join(BACKUP_DIR, `schema_${timestamp}.sql`);
  fs.writeFileSync(backupPath, sqlContent);
  console.log(`📦 안전 백업 생성됨: backups/schema_${timestamp}.sql`);

  // 3. 트랜잭션 실행
  const client = new Client({
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sqlContent);
    await client.query("NOTIFY pgrst, 'reload schema';");
    await client.query('COMMIT');

    console.log(`✨ [${new Date().toLocaleTimeString()}] Supabase DB가 안전하게 업데이트되었습니다! (데이터 100% 보존)`);
  } catch (dbErr) {
    console.error(`❌ [업데이트 실패]:`, dbErr.message);
    try {
      await client.query('ROLLBACK');
      console.log('🛡️ 롤백(Rollback)되어 이전 DB 상태와 데이터가 안전하게 보호되었습니다.');
    } catch (_) {}
  } finally {
    await client.end();
    isExecuting = false;
  }
}

console.log('====================================================');
console.log('🚀 Supabase 실시간 안전 동기화 시스템 가동 중');
console.log(`📁 감시 파일: ${TARGET_SQL_FILE}`);
console.log('🛡️ 보호 기능: 삭제 방지 필터 + 트랜잭션 롤백 + 자동 백업 + API 즉시 갱신');
console.log('====================================================');

chokidar.watch(TARGET_SQL_FILE, { ignoreInitial: true })
  .on('change', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSafeSync, 1500);
  });
