# 클리닉 스케줄 매니저

병원 직원 근무표 및 충격파 환자 스케줄 관리 PWA 웹앱

## 기능

- 📅 **직원 근무표** — 월별 달력에 직원 스케줄 관리
- ⚡ **충격파 2인 스케줄** — 2명 치료사 일정 관리
- ⚡ **충격파 3인 스케줄** — 3명 치료사 일정 관리
- 📋 **전달 사항 보드** — 공지/메모 관리
- 🌙 **다크/라이트 모드** — 테마 전환 지원
- 📱 **PWA** — 모바일/태블릿/데스크톱 설치 가능

## 기술 스택

- Vite + React
- Supabase (DB + Auth)
- vite-plugin-pwa
- Vanilla CSS

## 설치 & 실행

```bash
npm install
npm run dev
```

## 환경변수

`.env` 파일에 Supabase 정보를 설정하세요:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_KEY=your_supabase_anon_key
```

## Supabase 테이블

Supabase 대시보드에서 다음 테이블을 생성하세요:

- `staff_schedules`
- `holidays`
- `shockwave_2_schedules`
- `shockwave_3_schedules`
- `shockwave_therapists`
- `notices`
- `patients`
