# Push 설정 가이드

현재 환경에서는 GitHub 원격 저장소 접근(HTTPS fetch)이 차단되어 자동으로 코드를 가져오지 못했습니다.
`CONNECT tunnel failed, response 403` 오류가 발생했습니다.

그래서 로컬 저장소에서 **push 가능하도록 기본 설정**을 먼저 추가했습니다.

## 추가된 것

- `setup_push.sh`
  - `origin` remote를 추가/업데이트
  - `push.default=current` 설정
  - `push.autoSetupRemote=true` 설정

## 사용 방법

```bash
chmod +x ./setup_push.sh
./setup_push.sh https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw
```

그 다음 최초 1회:

```bash
git push -u origin codex/configure-automatic-push-settings-htqfkw
```

이후에는 일반적으로 `git push`만으로 동작합니다.

## 참고

- 인증이 필요한 경우 GitHub Personal Access Token(PAT) 또는 SSH 키 설정이 필요합니다.
- 네트워크 제한이 없는 환경에서 아래로 코드 가져오기가 가능합니다.

```bash
git fetch origin codex/configure-automatic-push-settings-htqfkw
git checkout -B codex/configure-automatic-push-settings-htqfkw --track origin/codex/configure-automatic-push-settings-htqfkw
```
