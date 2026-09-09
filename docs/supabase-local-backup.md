# Supabase 로컬 백업

이 백업 기능은 Supabase Free 요금제에서 공식 백업을 쓰기 어려운 상황을 대비하기 위한 보조 장치입니다.

## 코딩 중 위험 작업 전 백업

프로젝트 루트의 [AGENTS.md](../AGENTS.md)에 운영 데이터를 변경하는 명령·마이그레이션·복구·실데이터 테스트 실행 전 새 백업 생성 및 검증을 필수로 지정했습니다. 백업이 실패하거나 불완전하면 해당 DB 변경 실행을 중단합니다. 운영 DB 변경을 실행하지 않는 코드 작성·테스트·커밋·푸시는 그대로 진행합니다. 저장 로직 수정도 코드 반영 자체가 데이터를 변경하지 않으면 백업 때문에 보류하지 않습니다. 푸시·배포가 자동 마이그레이션이나 데이터 변경을 실행하는 경우에는 먼저 백업합니다.

작업 전 백업은 아래 앱 기능으로 생성한 뒤 JSON으로 내보내거나, 영향 범위에 맞는 읽기 전용 DB 백업 도구로 생성합니다. 저장 위치는 Git에서 제외된 `supabase-backups/` 또는 `backups/`입니다. 프로젝트 식별자와 생성 시각이 포함된 고유 파일명을 사용하고 기존 백업을 덮어쓰지 않습니다. 원본과 테이블별 행 수, 페이지 누락, 조회 오류, 권한 제한을 확인해야 합니다.

아래 고정 테이블 목록에 없는 데이터, 스키마·정책·함수·Auth·Storage 등은 이 앱의 JSON 백업만으로 보호되지 않습니다. 해당 자원을 변경할 때는 별도 백업과 복구 방법을 확보해야 합니다. 복구 스크립트의 dry-run 성공만으로 백업이 완전하다고 판단하지 않습니다.

이 규칙은 코딩 에이전트의 작업 절차이며, 서버에 상시 자동 백업이나 위험 쿼리 차단 기능을 설치하는 설정은 아닙니다.

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
