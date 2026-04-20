-- 1. 직원 근무표 메모 보관 테이블
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
  prescription_count integer,     -- 처방 횟수/숫자 기입 (예: 1, 2)
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
  slot_index integer NOT NULL,          -- 열 번호 (0, 1, 2 ...)
  therapist_name text NOT NULL DEFAULT '',  -- 치료사 이름 (빈 문자열 = 해당 기간 비활성)
  start_day integer NOT NULL DEFAULT 1, -- 시작일 (1~31)
  end_day integer NOT NULL DEFAULT 31,  -- 종료일 (1~31, 해당 월의 마지막 날까지)
  type text NOT NULL DEFAULT 'shockwave', -- 'shockwave' 또는 'manual_therapy'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(year, month, slot_index, start_day, type)
);

ALTER TABLE public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;

-- type 컬럼 추가 (기존 테이블이 있는 경우)
ALTER TABLE public.shockwave_monthly_therapists
ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'shockwave';

