# AIPool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Claude Code](https://claude.ai/claude-code)와 [Codex](https://github.com/openai/codex)를 위한 다계정 프록시입니다. Claude Max, ChatGPT/Codex, API 키, 서드파티 백엔드 계정을 하나의 풀로 묶고, 쿼터에 따라 계정을 돌려 씁니다.

코딩 에이전트와 프로바이더 API 사이에 끼어서 여러 계정을 들고 있다가, 지금 쓰는 계정이 세션 한도나 주간 한도에 가까워지면 다음 계정으로 넘어갑니다. 그래서 429에서 세션이 멈추지 않고 계속 이어집니다. Claude 계정은 Claude Code를, Codex 계정은 Codex CLI를 맡고, 두 풀이 프록시 하나를 같이 씁니다.

npm 같은 레지스트리에는 배포하지 않습니다. 이 저장소를 클론해서 그대로 실행합니다.

## 빠른 시작

처음 쓰신다면 설치부터 Claude Code·Codex 연결까지 한 번에 따라 할 수 있는 [시작하기](docs/getting-started.md)를 먼저 보세요. 아래는 요약입니다.

Node.js 20 이상이 필요합니다.

```bash
git clone https://github.com/shindonghwi/aipool.git && cd aipool
alias aipool='node '"$PWD"'/src/index.js'   # 같은 줄을 셸 rc 파일에도 넣어 두세요

aipool login     # 브라우저 OAuth, 계정마다 한 번씩
aipool server    # 프록시 시작, TUI 표시
aipool run       # 다른 터미널에서: 프록시를 거쳐 Claude Code 실행 (기본: 권한 확인 생략)
```

이미 Claude Code에 로그인되어 있다면 `aipool import`로 그 자격 증명을 가져오면 OAuth를 다시 거칠 필요가 없습니다. 저장소에서 컨테이너를 빌드할 수도 있습니다. [컨테이너에서 실행하기](docs/usage.md#컨테이너에서-실행)를 보세요. API 키, 그리고 이메일 하나가 여러 조직에 계정을 가진 경우는 [docs/accounts.md](docs/accounts.md)에 정리되어 있습니다.

## 하는 일

- 5시간 세션 버킷이나 7일 주간 버킷이 임계값(기본 98%)에 닿으면 다음 계정으로 전환합니다. 이때 주간 쿼터가 가장 먼저 초기화되는 계정을 우선합니다.
- 모델별 주간 한도를 따로 추적합니다. Fable 쿼터가 바닥난 계정은 Fable 요청에서만 건너뛰고, Opus와 Sonnet 요청은 계속 처리합니다.
- 쿼터 버킷이 바닥난 경우와 분당 레이트 리밋을 구분해서, 앞의 경우에만 전환합니다. 레이트 리밋에서 전환하면 순간적으로 몰린 요청이 다음 계정으로 옮겨 갈 뿐이고 데워진 캐시만 버리게 되므로, 그때는 같은 계정에서 속도를 조절합니다.
- 방금 전환한 계정으로 요청을 천천히 흘려 보냅니다. 여러 에이전트가 같은 순간에 한꺼번에 페일오버해서 새 계정이 막히고, 그 여파가 계정 풀 전체로 번지는 일을 막습니다.
- TUI에서 쿼터 막대, 초기화까지 남은 시간, 활동 로그를 보여 주고, 계정 추가·삭제를 포함한 설정을 실행 중에 바꿀 수 있습니다.
- 선택적으로 켜는 MCP 엔드포인트가 같은 제어 기능을 Claude Code에 도구로 제공합니다. 에이전트가 세션 안에서 계정 풀의 쿼터를 읽거나 계정을 바꿀 수 있습니다.
- `ANTHROPIC_BASE_URL`이 닿지 않는, `api.anthropic.com`이 하드코딩된 엔드포인트(예: Claude Design MCP)도 로컬 MITM 포워드 프록시로 잡아냅니다.
- 모든 계정이 바닥났을 때 429를 돌려주는 대신 쿼터가 초기화될 때까지 요청을 붙잡고 있어서, 무인 실행이 알아서 끝까지 갑니다(`holdSeconds`, 기본값은 꺼짐).
- OAuth 토큰이 만료되기 전에 갱신하고 설정 파일에 다시 씁니다. 클라이언트가 직접 하는 토큰 갱신은 그대로 통과시킵니다.
- OpenAI Codex 구독도 Claude 계정과 함께 풀로 묶습니다(실험적). Codex CLI는 설정으로, 또는 MITM 프록시를 통해 투명하게 같은 프록시를 거치고, 자기 쿼터에 따라 전환합니다.
- Anthropic 호환 API(DeepSeek, GLM)를 Claude 계정이 다 떨어졌을 때 쓰는 낮은 우선순위의 대체 수단으로 받아 줍니다.
- 같은 컴퓨터의 Claude Code 세션과 Codex 세션이 서로 메시지를 주고받게 합니다(`aipool peer`). 쉬고 있는 Claude 세션도 메시지가 오면 깨어납니다.
- 의존성이 없습니다. Node 내장 모듈만 씁니다.

## 자주 쓰는 명령

```bash
aipool accounts          # 계정 목록과 등급, 토큰 상태
aipool status            # 실행 중인 프록시의 실시간 상태 (서버가 떠 있어야 함)
aipool disable <name>    # 계정을 지우지 않고 잠시 멈춤
aipool priority <name> 1 # 로테이션 순서, 낮을수록 우선
aipool alias --install   # 그냥 `claude`를 실행해도 프록시를 거치게 함
aipool peer list         # 메시지를 주고받을 수 있는 Claude·Codex 세션
aipool help              # 나머지 전부
```

전체 명령 설명: [docs/usage.md](docs/usage.md)

## 설정

설정 파일은 `~/.config/aipool.json`(`$XDG_CONFIG_HOME`을 따름)이고, 손으로 고쳐 쓰기 좋게 되어 있습니다. 프록시 API 키는 처음 쓸 때 만들어집니다. 관측한 쿼터는 그 옆의 `aipool.state.json`에 따로 저장되는데, 쿼터는 트래픽에서 다시 알아내므로 지워도 괜찮습니다.

모든 필드, 환경 변수, 네트워크 조정: [docs/configuration.md](docs/configuration.md)

## 동작 방식

1. Claude Code가 `api.anthropic.com` 대신 로컬 프록시와 통신합니다.
2. 프록시가 쓸 수 있는 계정을 골라 그 계정의 실제 토큰을 넣고, 요청 본문의 `account_uuid`도 그 계정에 맞게 바꿉니다.
3. 응답의 `anthropic-ratelimit-unified-*` 헤더로 세션(5시간)과 주간(7일) 쿼터 상태를 갱신합니다. 이 상태는 재시작해도 유지됩니다.
4. 임계값에 닿으면 다음 계정으로 넘어갑니다. 쿼터 429를 받으면 다른 계정으로 요청을 다시 보내므로, 여유가 남은 계정이 있는 한 클라이언트는 한도에 걸린 걸 보지 못합니다.
5. 만료되는 토큰, 일시적인 네트워크 오류, 클라이언트의 토큰 갱신은 프록시 안에서 처리되어 세션을 끊지 않습니다.

요청 하나의 처리 과정을 단계별로: [docs/routing.md](docs/routing.md#요청-처리-흐름)

## 문서

| 문서 | 내용 |
| --- | --- |
| [시작하기](docs/getting-started.md) | 설치, 계정 추가, Claude Code·Codex 연결, 자주 겪는 문제 |
| [계정](docs/accounts.md) | OAuth 로그인, 가져오기, API 키, 여러 조직, Codex 계정, 서드파티 백엔드 |
| [사용법](docs/usage.md) | 서버와 TUI, Claude Code 실행, 셸 alias, 명령 레퍼런스, 브라우저 대시보드, MCP 엔드포인트, 로깅 |
| [라우팅](docs/routing.md) | 로테이션, 두 종류의 429, 스톰 제어, 모델 라우트, 세션 분산, 고정, 프롬프트 캐시 |
| [쿼터](docs/quota.md) | 쿼터 프로브, keep-warm, 소진 시 대기 |
| [설정](docs/configuration.md) | 설정 형식, 모든 필드, 환경 변수, 네트워크 조정 |
| [프록시 모드](docs/proxy-modes.md) | MITM 포워드 프록시, sx.org 주거용 egress |
| [약관 준수](docs/compliance.md) | 이용 약관 관련 메모 |

## 보안

보안 문제는 공개 이슈 말고 [SECURITY.md](SECURITY.md)에 적힌 방법으로 알려 주세요.

## 약관 준수

AIPool은 내 자격 증명을 들고 내 Claude Code CLI를 구동하는 로컬 프록시입니다. 이것이 Anthropic 약관과 어떻게 맞물리는지, 특히 가장 많이 묻는 여러 구독을 함께 쓰는 문제는 [docs/compliance.md](docs/compliance.md)에 정리했습니다. 법률 자문이 아닙니다.

## 라이선스

MIT. [LICENSE](LICENSE)를 보세요.
