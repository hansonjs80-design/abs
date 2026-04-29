-- Clinic Schedule Manager schema
-- Idempotent Supabase/Postgres setup. Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Staff schedule memo table
CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  day integer NOT NULL,
  slot_index integer NOT NULL,
  content text NOT NULL DEFAULT '',
  font_color text,
  bg_color text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(year, month, day, slot_index)
);

ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS font_color text;
ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS bg_color text;
ALTER TABLE public.staff_schedules ALTER COLUMN content SET DEFAULT '';
UPDATE public.staff_schedules SET content = '' WHERE content IS NULL;
ALTER TABLE public.staff_schedules ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.staff_schedules DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_staff_schedules_month
ON public.staff_schedules (year, month);

DROP TRIGGER IF EXISTS set_staff_schedules_updated_at ON public.staff_schedules;
CREATE TRIGGER set_staff_schedules_updated_at
BEFORE UPDATE ON public.staff_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Therapist rosters
CREATE TABLE IF NOT EXISTS public.shockwave_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slot_index integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.manual_therapy_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slot_index integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.shockwave_therapists ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.manual_therapy_therapists ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
UPDATE public.shockwave_therapists SET is_active = true WHERE is_active IS NULL;
UPDATE public.manual_therapy_therapists SET is_active = true WHERE is_active IS NULL;
ALTER TABLE public.shockwave_therapists ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.manual_therapy_therapists ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shockwave_therapists_active_slot
ON public.shockwave_therapists (is_active, slot_index);

CREATE INDEX IF NOT EXISTS idx_manual_therapy_therapists_active_slot
ON public.manual_therapy_therapists (is_active, slot_index);

-- 3. Unified scheduler table
CREATE TABLE IF NOT EXISTS public.shockwave_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  week_index integer NOT NULL,
  day_index integer NOT NULL,
  row_index integer NOT NULL,
  col_index integer NOT NULL,
  content text NOT NULL DEFAULT '',
  bg_color text,
  body_part text,
  prescription text,
  merge_span jsonb NOT NULL DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(year, month, week_index, day_index, row_index, col_index)
);

ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS bg_color text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS body_part text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.shockwave_schedules ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.shockwave_schedules ALTER COLUMN merge_span SET DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb;
UPDATE public.shockwave_schedules SET content = '' WHERE content IS NULL;
UPDATE public.shockwave_schedules SET merge_span = '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb WHERE merge_span IS NULL;
UPDATE public.shockwave_schedules SET updated_at = timezone('utc'::text, now()) WHERE updated_at IS NULL;
ALTER TABLE public.shockwave_schedules ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.shockwave_schedules ALTER COLUMN merge_span SET NOT NULL;
ALTER TABLE public.shockwave_schedules ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.shockwave_schedules DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shockwave_schedules_month
ON public.shockwave_schedules (year, month);

CREATE INDEX IF NOT EXISTS idx_shockwave_schedules_day
ON public.shockwave_schedules (year, month, week_index, day_index);

CREATE INDEX IF NOT EXISTS idx_shockwave_schedules_cell_updated
ON public.shockwave_schedules (year, month, week_index, day_index, row_index, col_index, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_shockwave_schedules_nonempty_day
ON public.shockwave_schedules (year, month, week_index, day_index, col_index, row_index)
WHERE content <> '';

DROP TRIGGER IF EXISTS set_shockwave_schedules_updated_at ON public.shockwave_schedules;
CREATE TRIGGER set_shockwave_schedules_updated_at
BEFORE UPDATE ON public.shockwave_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Holidays and notices
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.notices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_index integer NOT NULL UNIQUE,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.notices ALTER COLUMN content SET DEFAULT '';
UPDATE public.notices SET content = '' WHERE content IS NULL;
ALTER TABLE public.notices ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_notices_updated_at ON public.notices;
CREATE TRIGGER set_notices_updated_at
BEFORE UPDATE ON public.notices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Scheduler settings
CREATE TABLE IF NOT EXISTS public.shockwave_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '18:00:00',
  interval_minutes integer NOT NULL DEFAULT 10,
  day_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  prescriptions text[] NOT NULL DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'],
  manual_therapy_prescriptions text[] NOT NULL DEFAULT ARRAY['40분', '60분'],
  prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  incentive_percentage numeric(5,2) NOT NULL DEFAULT 7,
  manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0,
  frozen_columns integer NOT NULL DEFAULT 6,
  prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_schedule_block_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_settlement_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS day_overrides jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS date_overrides jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_prices jsonb DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS incentive_percentage numeric(5,2) DEFAULT 7;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_incentive_percentage numeric(5,2) DEFAULT 0;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS frozen_columns integer DEFAULT 6;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_colors jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS staff_schedule_block_rules jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS monthly_settlement_settings jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

UPDATE public.shockwave_settings SET day_overrides = '{}'::jsonb WHERE day_overrides IS NULL;
UPDATE public.shockwave_settings SET date_overrides = '{}'::jsonb WHERE date_overrides IS NULL;
UPDATE public.shockwave_settings SET prescriptions = ARRAY['F1.5', 'F/Rdc', 'F/R'] WHERE prescriptions IS NULL;
UPDATE public.shockwave_settings SET manual_therapy_prescriptions = ARRAY['40분', '60분'] WHERE manual_therapy_prescriptions IS NULL;
UPDATE public.shockwave_settings SET prescription_prices = '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb WHERE prescription_prices IS NULL;
UPDATE public.shockwave_settings SET incentive_percentage = 7 WHERE incentive_percentage IS NULL;
UPDATE public.shockwave_settings SET manual_therapy_incentive_percentage = 0 WHERE manual_therapy_incentive_percentage IS NULL;
UPDATE public.shockwave_settings SET frozen_columns = 6 WHERE frozen_columns IS NULL;
UPDATE public.shockwave_settings SET prescription_colors = '{}'::jsonb WHERE prescription_colors IS NULL;
UPDATE public.shockwave_settings SET staff_schedule_block_rules = '{}'::jsonb WHERE staff_schedule_block_rules IS NULL;
UPDATE public.shockwave_settings SET monthly_settlement_settings = '{}'::jsonb WHERE monthly_settlement_settings IS NULL;
UPDATE public.shockwave_settings SET updated_at = timezone('utc'::text, now()) WHERE updated_at IS NULL;

ALTER TABLE public.shockwave_settings ALTER COLUMN day_overrides SET DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN date_overrides SET DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN prescriptions SET DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'];
ALTER TABLE public.shockwave_settings ALTER COLUMN manual_therapy_prescriptions SET DEFAULT ARRAY['40분', '60분'];
ALTER TABLE public.shockwave_settings ALTER COLUMN prescription_prices SET DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN incentive_percentage SET DEFAULT 7;
ALTER TABLE public.shockwave_settings ALTER COLUMN manual_therapy_incentive_percentage SET DEFAULT 0;
ALTER TABLE public.shockwave_settings ALTER COLUMN frozen_columns SET DEFAULT 6;
ALTER TABLE public.shockwave_settings ALTER COLUMN prescription_colors SET DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN staff_schedule_block_rules SET DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN monthly_settlement_settings SET DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.shockwave_settings ALTER COLUMN day_overrides SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN date_overrides SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN prescriptions SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN manual_therapy_prescriptions SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN prescription_prices SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN incentive_percentage SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN manual_therapy_incentive_percentage SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN frozen_columns SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN prescription_colors SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN staff_schedule_block_rules SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN monthly_settlement_settings SET NOT NULL;
ALTER TABLE public.shockwave_settings ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_shockwave_settings_updated_at ON public.shockwave_settings;
CREATE TRIGGER set_shockwave_settings_updated_at
BEFORE UPDATE ON public.shockwave_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Patient treatment logs
CREATE TABLE IF NOT EXISTS public.shockwave_patient_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
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
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
UPDATE public.shockwave_patient_logs SET source = 'manual' WHERE source IS NULL;
UPDATE public.manual_therapy_patient_logs SET source = 'manual' WHERE source IS NULL;
ALTER TABLE public.shockwave_patient_logs ALTER COLUMN source SET DEFAULT 'manual';
ALTER TABLE public.manual_therapy_patient_logs ALTER COLUMN source SET DEFAULT 'manual';
ALTER TABLE public.shockwave_patient_logs ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.manual_therapy_patient_logs ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shockwave_patient_logs_date
ON public.shockwave_patient_logs (date);

CREATE INDEX IF NOT EXISTS idx_shockwave_patient_logs_therapist_date
ON public.shockwave_patient_logs (therapist_name, date);

CREATE INDEX IF NOT EXISTS idx_shockwave_patient_logs_patient_date
ON public.shockwave_patient_logs (patient_name, chart_number, date DESC);

CREATE INDEX IF NOT EXISTS idx_manual_therapy_patient_logs_date
ON public.manual_therapy_patient_logs (date);

CREATE INDEX IF NOT EXISTS idx_manual_therapy_patient_logs_therapist_date
ON public.manual_therapy_patient_logs (therapist_name, date);

CREATE INDEX IF NOT EXISTS idx_manual_therapy_patient_logs_patient_date
ON public.manual_therapy_patient_logs (patient_name, chart_number, date DESC);

DROP TRIGGER IF EXISTS set_shockwave_patient_logs_updated_at ON public.shockwave_patient_logs;
CREATE TRIGGER set_shockwave_patient_logs_updated_at
BEFORE UPDATE ON public.shockwave_patient_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_manual_therapy_patient_logs_updated_at ON public.manual_therapy_patient_logs;
CREATE TRIGGER set_manual_therapy_patient_logs_updated_at
BEFORE UPDATE ON public.manual_therapy_patient_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Monthly therapist assignments
CREATE TABLE IF NOT EXISTS public.shockwave_monthly_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  slot_index integer NOT NULL,
  therapist_name text NOT NULL DEFAULT '',
  start_day integer NOT NULL DEFAULT 1,
  end_day integer NOT NULL DEFAULT 31,
  type text NOT NULL DEFAULT 'shockwave',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(year, month, slot_index, start_day, type)
);

ALTER TABLE public.shockwave_monthly_therapists ADD COLUMN IF NOT EXISTS type text DEFAULT 'shockwave';
UPDATE public.shockwave_monthly_therapists SET type = 'shockwave' WHERE type IS NULL;
ALTER TABLE public.shockwave_monthly_therapists ALTER COLUMN type SET DEFAULT 'shockwave';
ALTER TABLE public.shockwave_monthly_therapists ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shockwave_monthly_therapists_lookup
ON public.shockwave_monthly_therapists (year, month, type, slot_index, start_day, end_day);

-- 8. App users and permissions
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password text DEFAULT '';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS display_name text DEFAULT '';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
UPDATE public.app_users SET password = '' WHERE password IS NULL;
UPDATE public.app_users SET display_name = '' WHERE display_name IS NULL;
UPDATE public.app_users SET role = 'user' WHERE role IS NULL;
UPDATE public.app_users SET permissions = '{}'::jsonb WHERE permissions IS NULL;
UPDATE public.app_users SET is_active = true WHERE is_active IS NULL;
ALTER TABLE public.app_users ALTER COLUMN password SET NOT NULL;
ALTER TABLE public.app_users ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE public.app_users ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.app_users ALTER COLUMN permissions SET NOT NULL;
ALTER TABLE public.app_users ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_app_users_updated_at ON public.app_users;
CREATE TRIGGER set_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_users (username, password, display_name, role, permissions, is_active)
VALUES (
  'admin',
  '1',
  '관리자',
  'admin',
  '{"staff_schedule":true,"shockwave":true,"shockwave_stats":true,"manual_therapy_stats":true,"pt_stats":true,"settings":true}'::jsonb,
  true
)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  permissions = EXCLUDED.permissions,
  is_active = true,
  updated_at = timezone('utc'::text, now());

-- 9. Staff calendar slot settings
CREATE TABLE IF NOT EXISTS public.staff_calendar_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  week_slot_counts jsonb NOT NULL DEFAULT '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(year, month)
);

UPDATE public.staff_calendar_settings
SET week_slot_counts = '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb
WHERE week_slot_counts IS NULL;
ALTER TABLE public.staff_calendar_settings ALTER COLUMN week_slot_counts SET DEFAULT '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb;
ALTER TABLE public.staff_calendar_settings ALTER COLUMN week_slot_counts SET NOT NULL;
ALTER TABLE public.staff_calendar_settings DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_staff_calendar_settings_updated_at ON public.staff_calendar_settings;
CREATE TRIGGER set_staff_calendar_settings_updated_at
BEFORE UPDATE ON public.staff_calendar_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
