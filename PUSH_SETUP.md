# Push + 원격 브랜치 동기화 가이드

이 스크립트는 아래를 한 번에 처리합니다.

1. `origin` remote 추가/업데이트
2. push 기본 설정 적용 (`push.default=current`, `push.autoSetupRemote=true`)
3. 지정한 원격 브랜치 fetch
4. 로컬 브랜치를 원격 브랜치와 동일 상태로 동기화
5. HTTPS fetch 실패 시 GitHub URL이면 SSH 원격으로 자동 재시도

## 사용 방법

```bash
chmod +x ./setup_push.sh
./setup_push.sh https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw
```

- 세 번째 인자(로컬 브랜치명)는 선택입니다.
- 생략 시 원격 브랜치명과 같은 이름으로 로컬 브랜치를 만듭니다.

예시:

```bash
./setup_push.sh https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw my-local-branch
```

## SSH fallback 동작

HTTPS `git fetch`가 실패하고 URL이 `https://github.com/<org>/<repo>.git` 형식이면,
자동으로 `git@github.com:<org>/<repo>.git`로 원격을 바꿔 재시도합니다.

## 실패할 수 있는 경우

- 네트워크/프록시 제한 (예: `CONNECT tunnel failed, response 403`)
- 저장소 접근 권한 문제 (PAT/SSH 미설정)
- SSH 키 미등록 또는 22번 포트 차단

실패 시 스크립트가 원인 점검 메시지를 출력하고 종료합니다.
