# 변경 기록

버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다. 기능을 더하면 가운데 숫자를, 고치기만 하면 끝 숫자를 올립니다. 릴리스마다 `vX.Y.Z` 태그를 붙입니다.

## 1.0.0 — 2026-11-01

첫 공개 버전입니다.

- Claude 구독, Anthropic API 키, Codex(ChatGPT) 구독, Anthropic 호환 서드파티 백엔드 계정을 하나의 풀로 묶는 프록시.
- 5시간·7일 쿼터와 모델별 주간 한도를 보고 계정을 전환하고, 레이트 리밋에서는 전환하지 않고 속도만 조절.
- 모든 계정이 바닥나면 쿼터가 초기화될 때까지 요청을 붙잡아 두는 `holdSeconds`.
- TUI, 브라우저 대시보드, MCP 엔드포인트, `api.anthropic.com`이 하드코딩된 요청을 잡는 MITM 포워드 프록시.
- `aipool status`가 Claude와 Codex 계정을 나눠서 표시.
- `aipool peer`: 같은 컴퓨터의 Claude Code 세션과 Codex 세션이 서로 메시지를 주고받음. Codex에는 다음 턴으로 들어가고, Claude 세션은 훅이 깨움.
