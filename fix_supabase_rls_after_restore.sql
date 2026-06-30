-- Fix RLS after Supabase restore.
-- Run in Supabase Dashboard > SQL Editor for the project used by the app.

ALTER TABLE IF EXISTS public.shockwave_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shockwave_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shockwave_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.staff_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.staff_calendar_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.holidays DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notices DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_users DISABLE ROW LEVEL SECURITY;

SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'shockwave_settings',
    'shockwave_schedules',
    'shockwave_therapists',
    'manual_therapy_therapists',
    'shockwave_monthly_therapists',
    'staff_schedules',
    'staff_calendar_settings',
    'holidays',
    'notices',
    'shockwave_patient_logs',
    'manual_therapy_patient_logs',
    'app_users'
  )
ORDER BY tablename;
