-- Therapist roster restore helper
-- 로컬 백업에는 치료사 이름 테이블이 없어서, 충격파 스케줄 열 개수 기준으로 임시 복구합니다.
-- 실행 전 아래 이름을 실제 이름으로 수정해도 됩니다.

BEGIN;

ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_monthly_therapists DISABLE ROW LEVEL SECURITY;

UPDATE public.shockwave_therapists SET is_active = false WHERE is_active = true;
UPDATE public.manual_therapy_therapists SET is_active = false WHERE is_active = true;

INSERT INTO public.shockwave_therapists (slot_index, name, is_active)
VALUES
  (0, '주한솔', true),
  (1, '신수민', true),
  (2, '치료사3', true);

INSERT INTO public.manual_therapy_therapists (slot_index, name, is_active)
VALUES
  (0, '주한솔', true),
  (1, '신수민', true);

COMMIT;

SELECT 'shockwave_therapists' AS table_name, slot_index, name, is_active
FROM public.shockwave_therapists
WHERE is_active = true
UNION ALL
SELECT 'manual_therapy_therapists' AS table_name, slot_index, name, is_active
FROM public.manual_therapy_therapists
WHERE is_active = true
ORDER BY table_name, slot_index;
