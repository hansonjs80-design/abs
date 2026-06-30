-- Post-restore repair for app settings.
-- Run in Supabase Dashboard > SQL Editor on the project used by the app.
-- This does not delete schedule data. It fixes schema/RLS and creates one default settings row if missing.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.shockwave_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '20:00:00',
  interval_minutes integer NOT NULL DEFAULT 20,
  time_label_interval_minutes integer NOT NULL DEFAULT 20,
  prescriptions text[] NOT NULL DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'],
  manual_therapy_prescriptions text[] NOT NULL DEFAULT ARRAY['40분', '60분'],
  prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  incentive_percentage numeric(5,2) NOT NULL DEFAULT 7,
  manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0,
  frozen_columns integer NOT NULL DEFAULT 6,
  day_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_schedule_block_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  shortcuts jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_therapy_shortcuts jsonb NOT NULL DEFAULT '{}'::jsonb,
  dose_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_therapy_dose_tags jsonb NOT NULL DEFAULT '{"40분":"40","60분":"60"}'::jsonb,
  duration_minutes jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_therapy_duration_minutes jsonb NOT NULL DEFAULT '{"40분":40,"60분":60}'::jsonb,
  visit_line_break_prescriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  manual_therapy_visit_line_break_prescriptions jsonb NOT NULL DEFAULT '["40분","60분"]'::jsonb,
  monthly_settlement_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

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

CREATE TABLE IF NOT EXISTS public.shockwave_monthly_therapists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  slot_index integer NOT NULL,
  start_day integer NOT NULL,
  end_day integer NOT NULL,
  therapist_name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'shockwave',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.staff_calendar_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL,
  week_slot_counts jsonb NOT NULL DEFAULT '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

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
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

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
  merge_span jsonb NOT NULL DEFAULT '{"rowSpan":1,"colSpan":1,"mergedInto":null}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

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

ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS time_label_interval_minutes integer DEFAULT 20;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_colors jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS shortcuts jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_shortcuts jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS dose_tags jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_dose_tags jsonb DEFAULT '{"40분":"40","60분":"60"}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS duration_minutes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_duration_minutes jsonb DEFAULT '{"40분":40,"60분":60}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS visit_line_break_prescriptions jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_visit_line_break_prescriptions jsonb DEFAULT '["40분","60분"]'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS staff_schedule_block_rules jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS monthly_settlement_settings jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS bg_color text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS body_part text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS merge_span jsonb DEFAULT '{"rowSpan":1,"colSpan":1,"mergedInto":null}'::jsonb;
ALTER TABLE public.shockwave_schedules ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());
ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS font_color text;
ALTER TABLE public.staff_schedules ADD COLUMN IF NOT EXISTS bg_color text;
ALTER TABLE public.shockwave_monthly_therapists ADD COLUMN IF NOT EXISTS type text DEFAULT 'shockwave';
ALTER TABLE public.staff_calendar_settings ADD COLUMN IF NOT EXISTS week_slot_counts jsonb DEFAULT '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb;

UPDATE public.shockwave_settings SET
  time_label_interval_minutes = COALESCE(time_label_interval_minutes, interval_minutes, 20),
  prescription_colors = COALESCE(prescription_colors, '{}'::jsonb),
  shortcuts = COALESCE(shortcuts, '{}'::jsonb),
  manual_therapy_shortcuts = COALESCE(manual_therapy_shortcuts, '{}'::jsonb),
  dose_tags = COALESCE(dose_tags, '{}'::jsonb),
  manual_therapy_dose_tags = COALESCE(manual_therapy_dose_tags, '{"40분":"40","60분":"60"}'::jsonb),
  duration_minutes = COALESCE(duration_minutes, '{}'::jsonb),
  manual_therapy_duration_minutes = COALESCE(manual_therapy_duration_minutes, '{"40분":40,"60분":60}'::jsonb),
  visit_line_break_prescriptions = COALESCE(visit_line_break_prescriptions, '[]'::jsonb),
  manual_therapy_visit_line_break_prescriptions = COALESCE(manual_therapy_visit_line_break_prescriptions, '["40분","60분"]'::jsonb),
  staff_schedule_block_rules = COALESCE(staff_schedule_block_rules, '{}'::jsonb),
  monthly_settlement_settings = COALESCE(monthly_settlement_settings, '{}'::jsonb);

UPDATE public.shockwave_schedules SET content = '' WHERE content IS NULL;
UPDATE public.shockwave_schedules SET merge_span = '{"rowSpan":1,"colSpan":1,"mergedInto":null}'::jsonb WHERE merge_span IS NULL;
UPDATE public.staff_schedules SET content = '' WHERE content IS NULL;
UPDATE public.staff_calendar_settings SET week_slot_counts = '{"0":6,"1":6,"2":6,"3":6,"4":6}'::jsonb WHERE week_slot_counts IS NULL;
UPDATE public.shockwave_monthly_therapists SET type = 'shockwave' WHERE type IS NULL;
UPDATE public.shockwave_therapists SET is_active = true WHERE is_active IS NULL;
UPDATE public.manual_therapy_therapists SET is_active = true WHERE is_active IS NULL;

ALTER TABLE public.shockwave_schedules ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.shockwave_schedules ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.shockwave_schedules ALTER COLUMN merge_span SET DEFAULT '{"rowSpan":1,"colSpan":1,"mergedInto":null}'::jsonb;
ALTER TABLE public.shockwave_schedules ALTER COLUMN merge_span SET NOT NULL;
ALTER TABLE public.staff_schedules ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.staff_schedules ALTER COLUMN content SET NOT NULL;
ALTER TABLE public.shockwave_monthly_therapists ALTER COLUMN type SET DEFAULT 'shockwave';
ALTER TABLE public.shockwave_monthly_therapists ALTER COLUMN type SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.shockwave_schedules ADD CONSTRAINT shockwave_schedules_unique_cell UNIQUE (year, month, week_index, day_index, row_index, col_index);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.staff_schedules ADD CONSTRAINT staff_schedules_unique_slot UNIQUE (year, month, day, slot_index);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.staff_calendar_settings ADD CONSTRAINT staff_calendar_settings_unique_month UNIQUE (year, month);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_shockwave_therapists_active_slot ON public.shockwave_therapists (is_active, slot_index);
CREATE INDEX IF NOT EXISTS idx_manual_therapy_therapists_active_slot ON public.manual_therapy_therapists (is_active, slot_index);
CREATE INDEX IF NOT EXISTS idx_monthly_therapists_lookup ON public.shockwave_monthly_therapists (year, month, type, slot_index, start_day);
CREATE INDEX IF NOT EXISTS idx_shockwave_schedules_month ON public.shockwave_schedules (year, month);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_month ON public.staff_schedules (year, month);

INSERT INTO public.shockwave_settings (
  start_time,
  end_time,
  interval_minutes,
  time_label_interval_minutes,
  prescriptions,
  manual_therapy_prescriptions,
  prescription_prices,
  prescription_colors,
  incentive_percentage,
  manual_therapy_incentive_percentage,
  frozen_columns,
  day_overrides,
  date_overrides,
  staff_schedule_block_rules,
  shortcuts,
  manual_therapy_shortcuts,
  dose_tags,
  manual_therapy_dose_tags,
  duration_minutes,
  manual_therapy_duration_minutes,
  visit_line_break_prescriptions,
  manual_therapy_visit_line_break_prescriptions,
  monthly_settlement_settings,
  updated_at
)
SELECT
  '09:00:00',
  '20:00:00',
  20,
  20,
  ARRAY['F1.5','F/Rdc','F/R'],
  ARRAY['40분','60분'],
  '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  '{}'::jsonb,
  7,
  0,
  6,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{"F/R":"1","F/Rdc":"2","F1.5":"3"}'::jsonb,
  '{"40분":"4","60분":"6"}'::jsonb,
  '{}'::jsonb,
  '{"40분":"40","60분":"60"}'::jsonb,
  '{}'::jsonb,
  '{"40분":40,"60분":60}'::jsonb,
  '[]'::jsonb,
  '["40분","60분"]'::jsonb,
  '{}'::jsonb,
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.shockwave_settings);

ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_calendar_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_users DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  ALTER TABLE public.shockwave_schedules REPLICA IDENTITY FULL;
  ALTER TABLE public.staff_schedules REPLICA IDENTITY FULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

COMMIT;

SELECT
  'shockwave_settings' AS table_name,
  COUNT(*) AS rows
FROM public.shockwave_settings
UNION ALL
SELECT 'shockwave_therapists', COUNT(*) FROM public.shockwave_therapists WHERE is_active = true
UNION ALL
SELECT 'manual_therapy_therapists', COUNT(*) FROM public.manual_therapy_therapists WHERE is_active = true
UNION ALL
SELECT 'shockwave_monthly_therapists', COUNT(*) FROM public.shockwave_monthly_therapists
UNION ALL
SELECT 'staff_calendar_settings', COUNT(*) FROM public.staff_calendar_settings
UNION ALL
SELECT 'holidays', COUNT(*) FROM public.holidays
UNION ALL
SELECT 'notices', COUNT(*) FROM public.notices
ORDER BY table_name;
