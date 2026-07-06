# Supabase 로컬 백업

이 백업 기능은 Supabase Free 요금제에서 공식 백업을 쓰기 어려운 상황을 대비하기 위한 보조 장치입니다.

## 백업 방식

- 설정 > 백업 탭에서 Supabase 테이블을 읽어서 브라우저 IndexedDB에 전체 스냅샷을 저장합니다.
- 자동 백업은 앱이 브라우저에서 열려 있을 때만 실행됩니다.
- 실시간 변경 로그는 `shockwave_schedules`, `staff_schedules` 변경만 보조 기록합니다.
- 앱 안의 백업 기능은 Supabase에 쓰기, 삭제, 복구 작업을 실행하지 않습니다.
- 장기 보관용 백업은 반드시 JSON 내보내기를 눌러 로컬 드라이브나 외장 저장소에 보관해야 합니다.

## 포함 테이블

- `staff_schedules`
- `shockwave_schedules`
- `shockwave_patient_logs`
- `manual_therapy_patient_logs`
- `shockwave_settings`
- `shockwave_therapists`
- `manual_therapy_therapists`
- `shockwave_monthly_therapists`
- `staff_calendar_settings`
- `holidays`
- `notices`
- `app_users`

`app_users`에는 로그인 정보가 포함될 수 있으므로 백업 JSON은 외부에 공유하지 마세요.

## DB가 삭제된 경우 복구 흐름

1. Supabase SQL Editor에서 repo의 `supabase_schema.sql`을 실행해 테이블 구조를 먼저 복구합니다.
2. 설정 > 백업 탭에서 내보낸 JSON 파일을 준비합니다.
3. dry-run으로 백업 내용을 확인합니다.

```bash
npm run restore:supabase-backup -- /path/to/clinic-supabase-backup.json --dry-run
```

4. 행 수와 테이블 목록이 맞을 때만 실제 복구를 실행합니다.

```bash
npm run restore:supabase-backup -- /path/to/clinic-supabase-backup.json --apply --i-understand-this-writes-to-supabase
```

복구 스크립트는 삭제를 실행하지 않습니다. 실제 실행 모드에서도 백업 데이터의 `upsert`만 수행합니다.

## 환경변수

복구 스크립트는 다음 파일이나 환경변수에서 Supabase 접속 정보를 읽습니다.

- `.env.backup.local`
- `.env.backup`
- `.env.local`
- `.env`

권장 값:

```bash
SUPABASE_URL=https://프로젝트.supabase.co
SUPABASE_SERVICE_ROLE_KEY=서비스롤키
```

서비스롤키는 절대 Git에 커밋하지 마세요.
