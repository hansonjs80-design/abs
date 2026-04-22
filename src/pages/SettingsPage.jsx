import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../components/common/Toast';
import { supabase } from '../lib/supabaseClient';
import { useSchedule } from '../contexts/ScheduleContext';
import { Sun, Moon, Database, Shield, Copy, Users } from 'lucide-react';
import {
  ADMIN_USERNAME,
  APP_TABS,
  DEFAULT_ADMIN_PASSWORD,
  createDefaultPermissions,
  isAdminUser,
  normalizeUsername,
} from '../lib/authPermissions';

const SQL_SNIPPETS = [
  {
    title: '충격파 설정 테이블',
    description: '기본 시간, 간격 그리고 요일별 오버라이드 정보 저장.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '18:00:00',
  interval_minutes int NOT NULL DEFAULT 10,
  day_overrides jsonb NOT NULL DEFAULT '{}',
  date_overrides jsonb NOT NULL DEFAULT '{}',
  prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'],
  manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'],
  prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  incentive_percentage numeric(5,2) NOT NULL DEFAULT 7,
  manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0,
  frozen_columns int DEFAULT 6,
  prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_settlement_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS day_overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS date_overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS incentive_percentage numeric(5,2) NOT NULL DEFAULT 7;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS frozen_columns int DEFAULT 6;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS monthly_settlement_settings jsonb NOT NULL DEFAULT '{}'::jsonb;`
  },
  {
    title: '치료사 목록 테이블',
    description: '스케줄러에 나열할 치료사 이름과 순서를 관리.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slot_index int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '도수치료 치료사 목록 테이블',
    description: '도수치료 현황 탭에 나열할 치료사 이름과 순서를 관리.',
    sql: `CREATE TABLE IF NOT EXISTS public.manual_therapy_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slot_index int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '통합 충격파 스케줄 테이블',
    description: '스케줄러의 셀 내용, 배경색, 병합(JSON) 정보를 저장합니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  week_index int NOT NULL,
  day_index int NOT NULL,
  row_index int NOT NULL,
  col_index int NOT NULL,
  content text,
  bg_color text,
  body_part text,
  prescription text,
  merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month, week_index, day_index, row_index, col_index)
);
ALTER TABLE public.shockwave_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS body_part text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb;`
  },
  {
    title: '환자 치료 로그 (통계/현황)',
    description: '충격파/도수치료 통계 탭에서 관리하는 환자 일일 기록 테이블입니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_patient_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS public.manual_therapy_patient_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';`
  },
  {
    title: '직원 근무표용 스케줄 테이블',
    description: '직원 근무표 탭에서 사용하는 메모 저장소입니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  day int NOT NULL,
  slot_index int NOT NULL,
  content text,
  font_color text,
  bg_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month, day, slot_index)
);
ALTER TABLE public.staff_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS bg_color text;`
  },
  {
    title: '공지사항 및 공휴일',
    description: '공지사항 보드 및 달력 공휴일 관리용.',
    sql: `-- 공지사항
CREATE TABLE IF NOT EXISTS public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_index int NOT NULL UNIQUE,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;

-- 공휴일
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '로그인 사용자 및 권한 테이블',
    description: '앱 내부 로그인 계정, 비밀번호, 탭별 접근 권한을 관리합니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user',
  permissions jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password text NOT NULL DEFAULT '';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
INSERT INTO public.app_users (username, password, display_name, role, permissions, is_active)
VALUES ('admin', '1', '관리자', 'admin', '{"staff_schedule":true,"shockwave":true,"shockwave_stats":true,"manual_therapy_stats":true,"settings":true}'::jsonb, true)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  permissions = EXCLUDED.permissions,
  is_active = true,
  updated_at = now();`
  }
];

const SQL_SETUP_SCRIPT = `-- 1. 직원 근무표 메모 보관 테이블
CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  day integer NOT NULL,
  slot_index integer NOT NULL,
  content text,
  font_color text,
  bg_color text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(year, month, day, slot_index)
);

-- 2. 역대 최강 통합 충격파 치료사 목록 (N인 호환)
CREATE TABLE IF NOT EXISTS public.shockwave_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slot_index integer NOT NULL, -- 화면 표시 순서 (0, 1, 2, ... N)
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.manual_therapy_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slot_index integer NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 통합 충격파 스케줄 테이블 (N열 호환)
CREATE TABLE IF NOT EXISTS public.shockwave_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  week_index integer NOT NULL, /* 월의 몇 번째 주인지 (0~) */
  day_index integer NOT NULL,  /* 요일 인덱스 (0=일) */
  row_index integer NOT NULL,  /* 시간표 상하 칸 인덱스 */
  col_index integer NOT NULL,  /* 몇 번째 치료사 칸인지 (0~N) */
  content text,
  bg_color text,
  body_part text,
  prescription text,
  merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(year, month, week_index, day_index, row_index, col_index)
);

ALTER TABLE public.shockwave_schedules
ADD COLUMN IF NOT EXISTS prescription text;

ALTER TABLE public.shockwave_schedules
ADD COLUMN IF NOT EXISTS body_part text;

ALTER TABLE public.shockwave_schedules
ADD COLUMN IF NOT EXISTS merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb;

-- 4. 휴일 관리 테이블
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL UNIQUE,
  name text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. 공지사항 보드 테이블
CREATE TABLE IF NOT EXISTS public.notices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_index integer NOT NULL UNIQUE,
  content text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS (보안 정책) 비활성화 (개발 편의를 위해 임시)
ALTER TABLE public.staff_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;

-- 6. 충격파 스케줄러 환경설정 (단일 Row 강제)
CREATE TABLE IF NOT EXISTS public.shockwave_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '18:00:00',
  interval_minutes integer NOT NULL DEFAULT 10,
  day_overrides jsonb DEFAULT '{}'::jsonb,
  date_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'],
  manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'],
  prescription_prices jsonb DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  incentive_percentage numeric(5,2) DEFAULT 7,
  manual_therapy_incentive_percentage numeric(5,2) DEFAULT 0,
  frozen_columns integer DEFAULT 6,
  monthly_settlement_settings jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;

-- =============================================
-- [긴급 패치] 기존 설정 테이블에 요일별 설정 및 병합 데이터 컬럼 추가
-- (이미 테이블이 생성된 경우를 대비한 ALTER 명령)
-- =============================================
ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS day_overrides jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'];

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'];

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS prescription_prices jsonb DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS incentive_percentage numeric(5,2) DEFAULT 7;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS manual_therapy_incentive_percentage numeric(5,2) DEFAULT 0;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS frozen_columns integer DEFAULT 6;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS date_overrides jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS prescription_colors jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.shockwave_settings
ADD COLUMN IF NOT EXISTS monthly_settlement_settings jsonb DEFAULT '{}'::jsonb;

-- =============================================
-- [통계/내역 탭 전용] 환자 일일 치료 기록 로그 테이블
-- =============================================
CREATE TABLE IF NOT EXISTS public.shockwave_patient_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,          -- 치료 날짜 (YYYY-MM-DD)
  patient_name text NOT NULL,  -- 환자 이름 (초진인 경우 * 표시 등 그대로 유지 가능)
  chart_number text,           -- 차트 번호
  visit_count text,            -- 회차 (e.g. '1', '-', '4' 등)
  body_part text,              -- 변환된 치료 부위/메모 (예: Rt. Shoulder)
  therapist_name text,         -- 담당 치료사 이름 또는 인덱스
  prescription text,           -- 처방 종류 (예: F1.5, F/R DC, F/R 등)
  prescription_count integer,  -- 처방 횟수/숫자 기입 (예: 1, 2)
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.manual_therapy_patient_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.shockwave_patient_logs
ADD COLUMN IF NOT EXISTS prescription text;

ALTER TABLE public.shockwave_patient_logs
ADD COLUMN IF NOT EXISTS prescription_count integer;

-- source 컬럼: 'scheduler' (스케줄러 자동 동기화) 또는 'manual' (수동 입력)
ALTER TABLE public.shockwave_patient_logs
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

ALTER TABLE public.manual_therapy_patient_logs
ADD COLUMN IF NOT EXISTS prescription text;

ALTER TABLE public.manual_therapy_patient_logs
ADD COLUMN IF NOT EXISTS prescription_count integer;

ALTER TABLE public.manual_therapy_patient_logs
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

ALTER TABLE public.staff_schedules
ADD COLUMN IF NOT EXISTS bg_color text;

-- =============================================
-- [월별 치료사 설정] 스케줄러 슬롯별 날짜 범위 기반 치료사 배정
-- =============================================
CREATE TABLE IF NOT EXISTS public.shockwave_monthly_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  slot_index integer NOT NULL,             -- 열 번호 (0, 1, 2 ...)
  therapist_name text NOT NULL DEFAULT '', -- 치료사 이름 (빈 문자열 = 해당 기간 비활성)
  start_day integer NOT NULL DEFAULT 1,    -- 시작일 (1~31)
  end_day integer NOT NULL DEFAULT 31,     -- 종료일 (1~31, 해당 월의 마지막 날까지)
  type text NOT NULL DEFAULT 'shockwave',  -- 'shockwave' 또는 'manual_therapy'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(year, month, slot_index, start_day, type)
);

ALTER TABLE public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;

-- type 컬럼 추가 (기존 테이블이 있는 경우)
ALTER TABLE public.shockwave_monthly_therapists
ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'shockwave';

-- =============================================
-- [로그인/권한 관리] 앱 내부 사용자 계정 및 탭 권한
-- =============================================
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS password text NOT NULL DEFAULT '';

ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';

ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.app_users
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO public.app_users (username, password, display_name, role, permissions, is_active)
VALUES (
  'admin',
  '1',
  '관리자',
  'admin',
  '{"staff_schedule":true,"shockwave":true,"shockwave_stats":true,"manual_therapy_stats":true,"settings":true}'::jsonb,
  true
)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  permissions = EXCLUDED.permissions,
  is_active = true,
  updated_at = timezone('utc'::text, now());`;

export default function SettingsPage() {
  const { user, signOut, refreshStoredUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const { saveShockwaveSettings } = useSchedule();
  const canManageLogin = isAdminUser(user);
  const [settingsSection, setSettingsSection] = useState('general');
  
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [appUsers, setAppUsers] = useState([]);
  const [newAppUser, setNewAppUser] = useState({
    username: '',
    password: '',
    display_name: '',
    role: 'user',
    permissions: createDefaultPermissions(),
    is_active: true,
  });
  
  const [swSettings, setSwSettings] = useState({ 
    start_time: '09:00', 
    end_time: '18:00', 
    interval_minutes: 10,
    prescriptions: ['F1.5', 'F/Rdc', 'F/R'],
    manual_therapy_prescriptions: ['40분', '60분'],
    prescription_prices: {
      'F1.5': 50000,
      'F/Rdc': 70000,
      'F/R': 80000,
    },
    prescription_colors: {},
    incentive_percentage: 7,
    manual_therapy_incentive_percentage: 0,
    frozen_columns: 6,
    day_overrides: {},
    date_overrides: {},
    monthly_settlement_settings: {},
  });

  const handleCopySQL = async (sql) => {
    if (!navigator?.clipboard) {
      addToast('복사 실패: 브라우저가 클립보드를 지원하지 않습니다.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(sql);
      addToast('SQL 코드가 클립보드에 복사되었습니다.', 'success');
    } catch (err) {
      addToast('복사 실패: 클립보드 접근 권한이 필요합니다.', 'error');
    }
  };

  useEffect(() => {
    loadHolidays();
    loadSettings();
  }, []);

  useEffect(() => {
    if (canManageLogin) loadAppUsers();
  }, [canManageLogin]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('shockwave_settings').select('*').order('updated_at', { ascending: false }).limit(1).single();
      if (!error && data) {
        setSwSettings({
          start_time: data.start_time.substring(0, 5),
          end_time: data.end_time.substring(0, 5),
          interval_minutes: data.interval_minutes,
          prescriptions: data.prescriptions || ['F1.5', 'F/Rdc', 'F/R'],
          manual_therapy_prescriptions: data.manual_therapy_prescriptions || ['40분', '60분'],
          prescription_prices: data.prescription_prices || {
            'F1.5': 50000,
            'F/Rdc': 70000,
            'F/R': 80000,
          },
          prescription_colors: data.prescription_colors || {},
          incentive_percentage: data.incentive_percentage ?? 7,
          manual_therapy_incentive_percentage: data.manual_therapy_incentive_percentage ?? 0,
          frozen_columns: data.frozen_columns || 6,
          day_overrides: data.day_overrides || {},
          date_overrides: data.date_overrides || {},
          monthly_settlement_settings: data.monthly_settlement_settings || {},
        });
      }
    } catch(e) {}
  };

  const loadAppUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .order('role', { ascending: true })
        .order('username', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) {
        await supabase.from('app_users').insert({
          username: ADMIN_USERNAME,
          password: DEFAULT_ADMIN_PASSWORD,
          display_name: '관리자',
          role: 'admin',
          permissions: createDefaultPermissions(),
          is_active: true,
        });
        loadAppUsers();
        return;
      }
      setAppUsers(rows.map((row) => ({
        ...row,
        permissions: {
          ...createDefaultPermissions(),
          ...(row.permissions || {}),
        },
      })));
    } catch (err) {
      console.error('Failed to load app users:', err);
      addToast('로그인 사용자 목록을 불러오지 못했습니다. SQL 테이블을 먼저 생성해주세요.', 'error');
    }
  };

  const addAppUser = async () => {
    const username = normalizeUsername(newAppUser.username);
    const password = String(newAppUser.password || '').trim();
    if (!username || !password) {
      addToast('아이디와 비밀번호를 입력해주세요.', 'error');
      return;
    }
    if (appUsers.some((item) => item.username === username)) {
      addToast('이미 존재하는 아이디입니다.', 'error');
      return;
    }
    try {
      const row = {
        username,
        password,
        display_name: newAppUser.display_name.trim() || username,
        role: username === ADMIN_USERNAME ? 'admin' : newAppUser.role,
        permissions: username === ADMIN_USERNAME ? createDefaultPermissions() : newAppUser.permissions,
        is_active: true,
      };
      const { error } = await supabase.from('app_users').insert(row);
      if (error) throw error;
      setNewAppUser({
        username: '',
        password: '',
        display_name: '',
        role: 'user',
        permissions: createDefaultPermissions(),
        is_active: true,
      });
      addToast('사용자가 추가되었습니다.', 'success');
      loadAppUsers();
    } catch (err) {
      addToast('사용자 추가 실패: ' + (err.message || err), 'error');
    }
  };

  const updateAppUserLocal = (id, field, value) => {
    setAppUsers((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      return { ...row, [field]: value };
    }));
  };

  const toggleAppUserPermission = (id, key) => {
    setAppUsers((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      return {
        ...row,
        permissions: {
          ...createDefaultPermissions(),
          ...(row.permissions || {}),
          [key]: row.username === ADMIN_USERNAME ? true : !(row.permissions?.[key] !== false),
        },
      };
    }));
  };

  const saveAppUser = async (row) => {
    const username = normalizeUsername(row.username);
    const password = String(row.password || '').trim();
    if (!username || !password) {
      addToast('아이디와 비밀번호는 비워둘 수 없습니다.', 'error');
      return;
    }
    const isAdminRow = username === ADMIN_USERNAME || row.role === 'admin';
    const payload = {
      username,
      password: username === ADMIN_USERNAME ? DEFAULT_ADMIN_PASSWORD : password,
      display_name: String(row.display_name || '').trim() || username,
      role: isAdminRow ? 'admin' : 'user',
      permissions: isAdminRow ? createDefaultPermissions() : {
        ...createDefaultPermissions(),
        ...(row.permissions || {}),
      },
      is_active: Boolean(row.is_active),
      updated_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from('app_users').update(payload).eq('id', row.id);
      if (error) throw error;
      addToast('사용자 설정이 저장되었습니다.', 'success');
      if (normalizeUsername(user?.email) === username && refreshStoredUser) {
        refreshStoredUser({
          ...user,
          username,
          email: username,
          user_metadata: { ...(user.user_metadata || {}), name: payload.display_name },
          app_permissions: payload.permissions,
          app_role: payload.role,
          isAdmin: payload.role === 'admin',
        });
      }
      loadAppUsers();
    } catch (err) {
      addToast('사용자 저장 실패: ' + (err.message || err), 'error');
    }
  };

  const removeAppUser = async (row) => {
    if (normalizeUsername(row.username) === ADMIN_USERNAME || row.role === 'admin') {
      addToast('admin 계정은 삭제할 수 없습니다.', 'error');
      return;
    }
    try {
      const { error } = await supabase.from('app_users').delete().eq('id', row.id);
      if (error) throw error;
      addToast('사용자가 삭제되었습니다.', 'success');
      loadAppUsers();
    } catch (err) {
      addToast('사용자 삭제 실패: ' + (err.message || err), 'error');
    }
  };

  const handleSaveSettings = async () => {
    const success = await saveShockwaveSettings({
      start_time: swSettings.start_time + ':00',
      end_time: swSettings.end_time + ':00',
      interval_minutes: Number(swSettings.interval_minutes),
      day_overrides: swSettings.day_overrides || {},
      date_overrides: swSettings.date_overrides || {},
      prescriptions: swSettings.prescriptions,
      manual_therapy_prescriptions: swSettings.manual_therapy_prescriptions,
      prescription_prices: swSettings.prescription_prices,
      prescription_colors: swSettings.prescription_colors,
      incentive_percentage: Number(swSettings.incentive_percentage) || 0,
      manual_therapy_incentive_percentage: Number(swSettings.manual_therapy_incentive_percentage) || 0,
      frozen_columns: Number(swSettings.frozen_columns),
      monthly_settlement_settings: swSettings.monthly_settlement_settings || {},
    });
    if (success) addToast('시간표 설정이 저장되었습니다.', 'success');
  };

  const loadHolidays = async () => {
    const { data } = await supabase.from('holidays').select('*').order('date');
    setHolidays(data || []);
  };

  const addHoliday = async () => {
    if (!newHoliday.date) return;
    const { error } = await supabase.from('holidays').insert({
      date: newHoliday.date,
      name: newHoliday.name.trim() || null
    });
    if (error) { addToast('추가 실패: ' + error.message, 'error'); return; }
    addToast('공휴일이 추가되었습니다', 'success');
    setNewHoliday({ date: '', name: '' });
    loadHolidays();
  };

  const removeHoliday = async (id) => {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (!error) { addToast('삭제되었습니다', 'success'); loadHolidays(); }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">설정</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm ${settingsSection === 'general' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSettingsSection('general')}
        >
          환경 설정
        </button>
        {canManageLogin && (
          <button
            type="button"
            className={`btn btn-sm ${settingsSection === 'login' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSettingsSection('login')}
          >
            로그인 관리
          </button>
        )}
      </div>

      {settingsSection === 'general' && (
        <>
      {/* 테마 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">{theme === 'light' ? <Sun size={18} /> : <Moon size={18} />} 테마 설정</span>
        </div>
        <div className="card-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">다크 모드</div>
              <div className="settings-row-desc">어두운 테마로 전환합니다</div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleTheme}>
              {theme === 'light' ? '다크 모드로' : '라이트 모드로'}
            </button>
          </div>
        </div>
      </div>

      {/* 충격파 시간표 관리 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">⏰ 충격파 스케줄 시간표 설정</span>
        </div>
        <div className="card-body">
          <div className="settings-row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">시작 시간</span>
              <input type="time" className="form-input" style={{ width: 120 }} value={swSettings.start_time} onChange={e => setSwSettings(p => ({ ...p, start_time: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">종료 시간</span>
              <input type="time" className="form-input" style={{ width: 120 }} value={swSettings.end_time} onChange={e => setSwSettings(p => ({ ...p, end_time: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">시간 단위</span>
              <select className="form-input" style={{ width: 100 }} value={swSettings.interval_minutes} onChange={e => setSwSettings(p => ({ ...p, interval_minutes: Number(e.target.value) }))}>
                <option value={10}>10분</option>
                <option value={15}>15분</option>
                <option value={20}>20분</option>
                <option value={30}>30분</option>
                <option value={60}>60분(1시간)</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleSaveSettings}>적용 및 저장</button>
          </div>
          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div>
              <div className="settings-row-label">🧊 고정 컬럼 개수</div>
              <div className="settings-row-desc">가로 스크롤 시 왼쪽에 고정할 열의 개수를 지정합니다. (기본 6: #, 날짜, 이름, 차트번호, 회차, 부위)</div>
            </div>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: 80 }} 
              min={0} max={10} 
              value={swSettings.frozen_columns} 
              onChange={e => setSwSettings(p => ({ ...p, frozen_columns: parseInt(e.target.value) || 0 }))} 
            />
          </div>

          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div style={{ flex: 1 }}>
              <div className="settings-row-label">📝 처방 목록 (현황 탭)</div>
              <div className="settings-row-desc">치료사별로 표시할 처방 종류와 결산에 사용할 가격을 관리합니다.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {swSettings.prescriptions.map((pres, idx) => (
                  <span 
                    key={idx} 
                    style={{ 
                      background: 'var(--accent-color, #6366f1)', 
                      color: 'white', 
                      padding: '4px 4px 4px 10px', 
                      borderRadius: 16, 
                      fontSize: '0.8rem', 
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    {pres}
                    <input
                      type="color"
                      value={swSettings.prescription_colors[pres] || '#000000'}
                      onChange={(e) => {
                        const newColor = e.target.value;
                        setSwSettings(p => ({
                          ...p,
                          prescription_colors: {
                            ...p.prescription_colors,
                            [pres]: newColor
                          }
                        }));
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        padding: 0,
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        overflow: 'hidden'
                      }}
                      title="스케줄러 글자색 선택"
                    />
                    <span
                      style={{ cursor: 'pointer', paddingRight: 6 }}
                      onClick={() => {
                        const next = swSettings.prescriptions.filter((_, i) => i !== idx);
                        setSwSettings(p => ({ ...p, prescriptions: next }));
                      }}
                    >✕</span>
                  </span>
                ))}
                <input 
                  className="form-input" 
                  placeholder="+ 추가" 
                  style={{ width: 100, height: 28, fontSize: '0.8rem', padding: '0 8px' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const val = e.target.value.trim();
                      if (!swSettings.prescriptions.includes(val)) {
                        setSwSettings(p => ({
                          ...p,
                          prescriptions: [...p.prescriptions, val],
                          prescription_prices: {
                            ...p.prescription_prices,
                            [val]: p.prescription_prices?.[val] ?? 0,
                          },
                        }));
                      }
                      e.target.value = '';
                    }
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
                {swSettings.prescriptions.map((pres) => (
                  <label key={`${pres}-price`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>{pres} 가격</span>
                    <input
                      type="number"
                      className="form-input"
                      min={0}
                      step={1000}
                      value={swSettings.prescription_prices?.[pres] ?? 0}
                      onChange={(e) => {
                        const value = Number(e.target.value) || 0;
                        setSwSettings((p) => ({
                          ...p,
                          prescription_prices: {
                            ...p.prescription_prices,
                            [pres]: value,
                          },
                        }));
                      }}
                    />
                  </label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>인센티브 퍼센트</span>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    step={0.1}
                    value={swSettings.incentive_percentage}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSwSettings((p) => ({
                        ...p,
                        incentive_percentage: Number.isFinite(value) ? value : 0,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div style={{ flex: 1 }}>
              <div className="settings-row-label">💆 도수 처방목록 / 인센</div>
              <div className="settings-row-desc">도수치료 통계 탭에서 사용할 시간 라벨과 인센티브 퍼센트를 별도로 관리합니다.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {swSettings.manual_therapy_prescriptions.map((pres, idx) => (
                  <span
                    key={`manual-${idx}`}
                    style={{
                      background: '#0f766e',
                      color: 'white',
                      padding: '4px 10px',
                      borderRadius: 16,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    onClick={() => {
                      const next = swSettings.manual_therapy_prescriptions.filter((_, i) => i !== idx);
                      setSwSettings(p => ({ ...p, manual_therapy_prescriptions: next }));
                    }}
                  >
                    {pres} ✕
                  </span>
                ))}
                <input
                  className="form-input"
                  placeholder="+ 도수 라벨 추가"
                  style={{ width: 140, height: 28, fontSize: '0.8rem', padding: '0 8px' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const val = e.target.value.trim();
                      if (!swSettings.manual_therapy_prescriptions.includes(val)) {
                        setSwSettings(p => ({
                          ...p,
                          manual_therapy_prescriptions: [...p.manual_therapy_prescriptions, val],
                          prescription_prices: {
                            ...p.prescription_prices,
                            [val]: p.prescription_prices?.[val] ?? 0,
                          },
                        }));
                      }
                      e.target.value = '';
                    }
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
                {swSettings.manual_therapy_prescriptions.map((pres) => (
                  <label key={`manual-${pres}-price`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>{pres} 가격</span>
                    <input
                      type="number"
                      className="form-input"
                      min={0}
                      step={1000}
                      value={swSettings.prescription_prices?.[pres] ?? 0}
                      onChange={(e) => {
                        const value = Number(e.target.value) || 0;
                        setSwSettings((p) => ({
                          ...p,
                          prescription_prices: {
                            ...p.prescription_prices,
                            [pres]: value,
                          },
                        }));
                      }}
                    />
                  </label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>도수 인센티브 퍼센트</span>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    step={0.1}
                    value={swSettings.manual_therapy_incentive_percentage}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSwSettings((p) => ({
                        ...p,
                        manual_therapy_incentive_percentage: Number.isFinite(value) ? value : 0,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleSaveSettings}>환경설정 저장</button>
          </div>
        </div>
      </div>

      {/* 공휴일 관리 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title"><Database size={18} /> 공휴일 관리</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 140 }}
              type="date"
              value={newHoliday.date}
              onChange={e => setNewHoliday(p => ({ ...p, date: e.target.value }))}
            />
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 120 }}
              placeholder="공휴일 이름 (선택)"
              value={newHoliday.name}
              onChange={e => setNewHoliday(p => ({ ...p, name: e.target.value }))}
            />
            <button className="btn btn-primary btn-sm" onClick={addHoliday}>추가</button>
          </div>

          {holidays.slice(0, 20).map(h => (
            <div key={h.id} className="settings-row">
              <div>
                <div className="settings-row-label">{h.date}</div>
                <div className="settings-row-desc">{h.name || '(이름 없음)'}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeHoliday(h.id)}>삭제</button>
            </div>
          ))}

          {holidays.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              등록된 공휴일이 없습니다
            </p>
          )}
        </div>
      </div>

      {/* 계정 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Shield size={18} /> 계정</span>
        </div>
        <div className="card-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{user?.email}</div>
              <div className="settings-row-desc">현재 로그인된 계정</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={signOut}>로그아웃</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span className="card-title"><Copy size={18} /> Supabase SQL 코드</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
            아래 SQL 스니펫을 복사해서 Supabase SQL 편집기 또는 psql에 붙여넣으면 현재 프로그램이 사용하는 테이블을 준비할 수 있습니다.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {SQL_SNIPPETS.map(snippet => (
              <div
                key={snippet.title}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'var(--bg-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{snippet.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{snippet.description}</div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => handleCopySQL(snippet.sql)}
                  >
                    <Copy size={14} />
                    복사
                  </button>
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  lineHeight: '1.35rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 8,
                  padding: 10,
                  overflowX: 'auto',
                  fontFamily: 'Consolas, menlo, monospace'
                }}>
                  {snippet.sql}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span className="card-title"><Copy size={18} /> 전체 SQL 스크립트</span>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => handleCopySQL(SQL_SETUP_SCRIPT)}
          >
            <Copy size={14} />
            전체 복사
          </button>
        </div>
        <div className="card-body">
          <textarea
            readOnly
            value={SQL_SETUP_SCRIPT}
            style={{
              width: '100%',
              minHeight: 220,
              borderRadius: 10,
              padding: 12,
              fontFamily: 'Consolas, Menlo, monospace',
              fontSize: '0.78rem',
              border: '1px solid var(--border-color)'
            }}
          />
          <p style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            위 전체 SQL을 복사하면 필요한 테이블과 기본 데이터를 한 번에 생성할 수 있습니다.
          </p>
        </div>
      </div>
        </>
      )}

      {settingsSection === 'login' && canManageLogin && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title"><Users size={18} /> 로그인 인원 / 권한 관리</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px auto',
                gap: 8,
                alignItems: 'center',
                padding: 12,
                border: '1px solid var(--border-color-light)',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
              }}
            >
              <input
                className="form-input"
                placeholder="아이디"
                value={newAppUser.username}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, username: e.target.value }))}
              />
              <input
                className="form-input"
                placeholder="비밀번호"
                value={newAppUser.password}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, password: e.target.value }))}
              />
              <input
                className="form-input"
                placeholder="표시 이름"
                value={newAppUser.display_name}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, display_name: e.target.value }))}
              />
              <select
                className="form-input"
                value={newAppUser.role}
                onChange={(e) => setNewAppUser((prev) => ({
                  ...prev,
                  role: e.target.value,
                  permissions: e.target.value === 'admin' ? createDefaultPermissions() : prev.permissions,
                }))}
              >
                <option value="user">사용자</option>
                <option value="admin">관리자</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={addAppUser}>인원 추가</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>아이디</th>
                    <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>비밀번호</th>
                    <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>이름</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>역할</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>탭 권한</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>사용</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {appUsers.map((row) => {
                    const adminRow = row.username === ADMIN_USERNAME || row.role === 'admin';
                    const permissions = {
                      ...createDefaultPermissions(),
                      ...(row.permissions || {}),
                    };
                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--border-color-light)' }}>
                        <td style={{ padding: 8 }}>
                          <input
                            className="form-input"
                            value={row.username}
                            disabled={adminRow}
                            onChange={(e) => updateAppUserLocal(row.id, 'username', normalizeUsername(e.target.value))}
                          />
                        </td>
                        <td style={{ padding: 8 }}>
                          <input
                            className="form-input"
                            value={row.username === ADMIN_USERNAME ? DEFAULT_ADMIN_PASSWORD : (row.password || '')}
                            disabled={row.username === ADMIN_USERNAME}
                            onChange={(e) => updateAppUserLocal(row.id, 'password', e.target.value)}
                          />
                        </td>
                        <td style={{ padding: 8 }}>
                          <input
                            className="form-input"
                            value={row.display_name || ''}
                            onChange={(e) => updateAppUserLocal(row.id, 'display_name', e.target.value)}
                          />
                        </td>
                        <td style={{ padding: 8, textAlign: 'center' }}>
                          <select
                            className="form-input"
                            value={adminRow ? 'admin' : row.role || 'user'}
                            disabled={row.username === ADMIN_USERNAME}
                            onChange={(e) => updateAppUserLocal(row.id, 'role', e.target.value)}
                          >
                            <option value="user">사용자</option>
                            <option value="admin">관리자</option>
                          </select>
                        </td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {APP_TABS.map((tab) => (
                              <label
                                key={`${row.id}-${tab.key}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  border: '1px solid var(--border-color-light)',
                                  borderRadius: 999,
                                  background: permissions[tab.key] !== false ? 'rgba(34, 197, 94, 0.12)' : 'var(--bg-secondary)',
                                  color: 'var(--text-primary)',
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={adminRow || permissions[tab.key] !== false}
                                  disabled={adminRow}
                                  onChange={() => toggleAppUserPermission(row.id, tab.key)}
                                />
                                {tab.label}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: 8, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={row.is_active !== false}
                            disabled={adminRow}
                            onChange={(e) => updateAppUserLocal(row.id, 'is_active', e.target.checked)}
                          />
                        </td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button className="btn btn-primary btn-sm" onClick={() => saveAppUser(row)}>저장</button>
                            <button className="btn btn-danger btn-sm" disabled={adminRow} onClick={() => removeAppUser(row)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
              admin 계정은 전체 권한을 항상 가지며 삭제할 수 없습니다. 초기 admin 비밀번호는 1입니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
