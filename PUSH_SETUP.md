# Push + 원격 브랜치 동기화 가이드

`setup_push.sh`는 아래를 한 번에 처리합니다.

1. `origin` remote 추가/업데이트
2. push 기본 설정 적용 (`push.default=current`, `push.autoSetupRemote=true`)
3. 지정한 원격 브랜치 fetch
4. 로컬 브랜치를 원격 브랜치와 동일 상태로 동기화
5. (선택) SSH fingerprint로 특정 키를 강제 사용

## 사용 방법

### 방법 A) tree URL만 입력 (권장)

```bash
chmod +x ./setup_push.sh
./setup_push.sh https://github.com/hansonjs80-design/PTperfect/tree/codex/configure-automatic-push-settings-htqfkw
```

### 방법 B) repo URL + branch 분리 입력

```bash
./setup_push.sh https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw
```

### 방법 C) 로컬 브랜치명 지정

```bash
./setup_push.sh https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw my-local-branch
```

### 방법 D) 특정 SSH fingerprint 강제 사용

```bash
./setup_push.sh --ssh-fingerprint SHA256:YOUR_FINGERPRINT \
  https://github.com/hansonjs80-design/PTperfect/tree/codex/configure-automatic-push-settings-htqfkw
```

- `~/.ssh/*.pub` 중 fingerprint가 일치하는 키를 찾아 `core.sshCommand`에 고정합니다.
- 이 경우 `origin`은 자동으로 SSH URL(`git@github.com:...`)로 설정됩니다.

## 꼭 필요한 사용자 작업

아래 중 하나는 반드시 설정되어야 fetch/push가 동작합니다.

1. HTTPS 인증 사용 시: GitHub PAT 준비/로그인
2. SSH 사용 시: SSH 키 등록 및 `git@github.com:...` 원격 사용
3. 회사망/프록시 사용 시: GitHub 접근 허용

## 실패할 수 있는 경우

- 네트워크/프록시 제한 (예: `CONNECT tunnel failed, response 403`)
- 저장소 접근 권한 문제 (PAT/SSH 미설정)
- 지정한 fingerprint에 해당하는 로컬 키가 없음

실패 시 스크립트가 원인 점검 메시지를 출력하고 종료합니다.
