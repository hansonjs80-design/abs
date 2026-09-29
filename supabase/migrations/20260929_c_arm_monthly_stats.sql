-- Independent manual C-Arm records. No existing treatment tables are modified.
-- App-user tab permissions are enforced by the existing application login layer.
CREATE TABLE IF NOT EXISTS public.c_arm_monthly_stats (
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 9999),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  radiographers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(radiographers) = 'array' AND jsonb_array_length(radiographers) <= 30),
  incentive_rate integer NOT NULL DEFAULT 2000 CHECK (incentive_rate BETWEEN 0 AND 100000000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (year, month)
);
-- Match the existing app_users-based application access model; no Supabase Auth
-- session is issued for these accounts. Do not imply this is per-account DB RLS.
ALTER TABLE public.c_arm_monthly_stats DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.c_arm_monthly_stats FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.c_arm_monthly_stats TO anon, authenticated;
GRANT ALL ON public.c_arm_monthly_stats TO service_role;
NOTIFY pgrst, 'reload schema';
