# 변경 기록

버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다. 기능을 더하면 가운데 숫자를, 고치기만 하면 끝 숫자를 올립니다. 릴리스마다 `vX.Y.Z` 태그를 붙입니다.

## 1.2.1 — 2026-11-09

- 프록시를 거치는 HTTPS 연결(터널)이 연결된 뒤에도 30초 무응답 제한에 걸려 끊기던 문제 수정. 이미지 생성처럼 응답 전까지 30초 넘게 조용한 요청이 정확히 30초에 끊겼음. 연결 단계는 그대로 30초, 연결 뒤에는 10분 동안 아무 데이터가 없을 때만 끊음(`AIPOOL_TUNNEL_IDLE_TIMEOUT_MS`로 변경 가능).

## 1.2.0 — 2026-11-09

- Codex 계정이 모두 전환 임계값(기본 98%)을 넘으면, 플랜이 남은 계정이 100%까지 계속 처리. 전에는 1분에 요청 하나만 보내고 나머지는 429로 돌려보냈음.
- Codex 구매 크레딧 지원. 플랜을 100% 다 썼고 크레딧이 남아 있으면 `aipool status`와 Codex가 받는 429 메시지에서 계속 쓸지 묻고, `aipool credits on|off`로 답을 저장. 답은 주간 한도가 초기화될 때까지만 유효하고, 다음에 플랜을 다 쓰면 다시 물음. 답을 받기 전에는 크레딧으로 청구될 요청을 하나도 보내지 않음.
- `aipool status`의 Codex 카드에 `Credits` 줄(잔액과 설정)을 항상 표시.
- Codex가 예정보다 일찍 한도를 초기화해도 감지. 붙잡아 둔 Codex 계정은 2분마다 무료 사용량 조회로 확인하고, 풀리면 429 대기를 풀고 바로 플랜으로 처리.
- 무료 리셋 크레딧은 보유 사실만 알리고 사용하지 않음. 문구를 `N free limit resets held, not used by aipool`로 바꿈.
- `aipool status`, `status -v`, TUI에 Antigravity 사용량 표시. Antigravity CLI의 상태 줄이 남긴 캐시(`~/.cache/aipool/agy-status.json`)를 읽음. TUI는 설정의 `agyStatus`를 켜야 표시.

## 1.1.1 — 2026-11-06

- `aipool status`의 쿼터 항목을 제공자별로 구분. Codex 계정에 Claude의 Fable·Sonnet 항목이 표시되던 문제 수정.
- `peer list`에서 사용하는 Claude 세션의 `kind` 필드를 타입 선언에 추가해 타입 검사 오류 수정.

## 1.1.0 — 2026-11-03

- `aipool peer`가 백그라운드 세션(`claude --bg`)과도 메시지를 주고받음. `peer list`에 `(background)`로 표시.
- `/resume`이나 `/clear` 뒤에 남는 대기 프로세스를 서버가 5분마다 정리. `aipool peer sweep`으로 바로 정리할 수도 있음.
- 대기 프로세스가 없는 세션에 보내면 "바로 깨운다" 대신 언제 받는지 안내.
- 문서: Codex 이미지 생성(`$imagegen`)에 필요한 `requires_openai_auth = true`와 `codex login` 안내.

## 1.0.0 — 2026-11-01

첫 공개 버전입니다.

- Claude 구독, Anthropic API 키, Codex(ChatGPT) 구독, Anthropic 호환 서드파티 백엔드 계정을 하나의 풀로 묶는 프록시.
- 5시간·7일 쿼터와 모델별 주간 한도를 보고 계정을 전환하고, 레이트 리밋에서는 전환하지 않고 속도만 조절.
- 모든 계정이 바닥나면 쿼터가 초기화될 때까지 요청을 붙잡아 두는 `holdSeconds`.
- TUI, 브라우저 대시보드, MCP 엔드포인트, `api.anthropic.com`이 하드코딩된 요청을 잡는 MITM 포워드 프록시.
- `aipool status`가 Claude와 Codex 계정을 나눠서 표시.
- `aipool peer`: 같은 컴퓨터의 Claude Code 세션과 Codex 세션이 서로 메시지를 주고받음. Codex에는 다음 턴으로 들어가고, Claude 세션은 훅이 깨움.
