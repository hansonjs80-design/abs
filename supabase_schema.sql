-- 1. 직원 근무표 메모 보관 테이블
CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  day integer NOT NULL,
  slot_index integer NOT NULL,
  content text,
  font_color text,
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
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(year, month, week_index, day_index, row_index, col_index)
);

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
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;

-- =============================================
-- [긴급 패치] 기존 설정 테이블에 요일별 설정 및 병합 데이터 컬럼 추가
-- (이미 테이블이 생성된 경우를 대비한 ALTER 명령)
-- =============================================
ALTER TABLE public.shockwave_settings 
ADD COLUMN IF NOT EXISTS day_overrides jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.shockwave_schedules 
ADD COLUMN IF NOT EXISTS merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb;

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
  prescription_count text,     -- 처방 횟수/숫자 기입 (예: 1, 2)
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.shockwave_patient_logs 
ADD COLUMN IF NOT EXISTS prescription text;

ALTER TABLE public.shockwave_patient_logs 
ADD COLUMN IF NOT EXISTS prescription_count text;
