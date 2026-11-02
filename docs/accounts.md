# 계정

AIPool이 로테이션하는 계정을 추가하고, 이름을 붙이고, 관리하는 방법을 설명합니다.

## OAuth 로그인 (권장)

```bash
aipool login
```

브라우저를 열고 Claude Code와 동일한 OAuth 흐름을 사용합니다. 계정 이메일과 구독 등급은 자동으로 감지됩니다. 같은 계정으로 다시 로그인하면 해당 계정의 자격 증명이 갱신됩니다.

계정마다 한 번씩 실행합니다. 서버가 실행 중일 때도 계정을 추가할 수 있으며, TUI에서 **R**을 누르면 다시 불러옵니다.

프로필을 식별할 수 없으면 로그인은 자리표시자 계정을 추가하지 않고 중단됩니다. 자격 증명이 유효한지 확인한 뒤 다시 시도하거나, `aipool login --name <name>`을 사용해 프로필 감지 없이 추가합니다.

## Claude Code에서 가져오기

Claude Code를 이미 설정해 두었다면 그 자격 증명을 바로 가져올 수 있습니다.

```bash
claude /login           # Claude Code에서 계정에 로그인
aipool import       # 해당 자격 증명 가져오기
```

같은 계정을 다시 가져오면 자격 증명이 갱신됩니다. 다른 경로에서 가져올 수도 있습니다.

```bash
aipool import --from /path/to/credentials.json
```

자동 이름 지정은 프로필 조회가 성공해야 동작합니다. 자격 증명이 유효하지 않거나 프로필을 식별할 수 없으면 가져오기는 자리표시자 계정을 추가하지 않고 중단됩니다. 프로필 감지 없이 명시적으로 가져오려면 `--name <name>`을 전달합니다.

## 자격 증명을 파일에 위임하기 (`importFrom`)

OAuth 계정의 토큰을 `aipool.json`에 저장하는 대신, 계정 항목에 토큰을 읽어 올 파일을 지정할 수 있습니다.

```json
{ "name": "me@example.com", "type": "oauth", "importFrom": "~/.claude/.credentials.json" }
```

토큰(`accessToken`, `refreshToken`, `expiresAt`)은 시작할 때와 설정을 다시 불러올 때마다 해당 파일에서 읽어 옵니다. 따라서 Claude Code가 직접 갱신한 로그인도 `aipool import`를 다시 실행하지 않고 반영됩니다. 항목의 나머지 필드(`priority`, `disabled`, `upstream`, `modelMap`, …)는 작성된 그대로 유지됩니다. 파일에 토큰이 없으면 빈 자격 증명을 업스트림으로 보내는 대신 메시지를 출력하고 해당 계정을 건너뜁니다. 대안은 `aipool import`로, 토큰을 설정에 한 번 복사해 넣습니다.

## API 키

Console을 통해 과금되는 Anthropic API 키 계정은 다음 명령을 사용합니다.

```bash
aipool login --api
```

## 여러 조직

하나의 이메일이 서로 다른 조직(예: 회사 + 개인)에 걸쳐 여러 계정을 가질 수 있습니다. 중복 제거는 계정 + 조직을 기준으로 하며, 이름은 `email (Org)` 형식으로 구분됩니다.

이메일만으로는 어느 계정인지 모호할 때 `--org <name|uuid>`를 전달해 특정합니다.

```bash
aipool remove user@example.com --org Acme
```

## 계정 관리

```bash
aipool accounts             # 등급 및 토큰 상태와 함께 계정 목록 표시
aipool accounts -v          # 토큰 만료 시각도 함께 표시
aipool remove <name>        # 계정 제거 (이름 또는 이메일로 지정)
aipool disable <name>       # 로테이션에서 일시적으로 제외
aipool enable <name>        # 다시 활성화 (멈춰 있는 오류 상태도 해제)
aipool priority <name> 1    # 로테이션 우선순위, 낮을수록 우선
aipool priority <name> --first
aipool priority <name> --last
```

`login`, `import`, `enable`, `disable`, `priority`는 실행 중인 서버에 다시 불러오기를 알리므로 자격 증명, 우선순위, 활성/비활성 변경이 즉시 반영됩니다. 같은 다시 불러오기(POST `/aipool/reload`, 또는 TUI에서 **R**)는 계정의 `upstream`/`modelMap`을 직접 수정한 내용에도 적용됩니다. `remove`도 즉시 적용됩니다. 파일을 수정하기 전에 실행 중인 서버에 계정을 내리도록 요청하므로(`POST /aipool/remove`, 클라이언트 키가 아닌 프록시 자체의 `apiKey`가 필요합니다), 계정은 곧바로 로테이션과 `status`에서 빠지고 서버가 다음에 저장할 때 그 계정을 다시 써넣지 못합니다. 이 엔드포인트를 지원하지 않는 오래된 서버를 상대로 하면 `remove`는 파일을 수정하기는 하지만 재시작이 필요하다고 경고합니다. TUI에서 제거하거나 [MCP 엔드포인트](usage.md#mcp-엔드포인트)의 `remove_account`로 제거하는 경우에도 마찬가지로 즉시 반영됩니다. 반면 파일을 **직접 수정**해서 제거한 경우에는 여전히 재시작이 필요합니다. 다시 불러오기는 실행 중인 계정을 절대 내리지 않기 때문입니다.

TUI 설정 화면에서도 계정을 추가, 제거, 재정렬할 수 있습니다: **`g`** → **Add account** / **Remove account** / **Reorder accounts**.

**Reorder accounts**는 계정 목록이 그려지는 순서를 정합니다. `↑`/`↓`로 계정을 고르고 `←`/`→`로 위아래로 옮기며, 옮길 때마다 바로 저장됩니다. 이 기능은 항목에 `displayOrder`를 기록할 뿐 다른 것은 건드리지 않습니다. 계정은 `accounts` 배열 안에서의 위치를 그대로 유지하므로 라우트 고정, 세션 고정, `TC_ACCT`는 모두 계속 같은 계정을 가리키며, 로테이션 순서는 오로지 `priority`가 결정합니다. `displayOrder`가 없는 계정(처음 정렬하기 전까지는 모든 계정, 그리고 그 뒤에 추가되는 모든 계정)은 이 값이 있는 계정 뒤에 표시되는데, 이는 새로 추가된 계정이 원래 나타나던 위치이기도 합니다. 로컬 프로세스가 제공하는 [서드파티 백엔드](#서드파티-백엔드-계정)는 로테이션할 좌석이라기보다 인프라에 가깝습니다. 그래서 TUI는 이런 계정을 목록 끝에 두며, 이 화면에서도 그 자리에 그대로 둡니다.

## `id` 필드

모든 계정 항목에는 `id`가 있습니다. 설정을 처음 읽을 때 추가되고, 다음 저장 때 파일에 기록됩니다. 이 값은 항목과 그 항목으로 만들어진 실행 중인 계정을 연결하는 역할을 합니다. 사용 가능한 자격 증명이 없는 항목은 시작 시 건너뛰므로 파일 안에서 항목의 위치가 계정 풀 안에서 계정의 위치와 일치하지 않으며, 그렇지 않다면 한 계정에 대해 갱신된 토큰이 다른 계정에 기록될 수 있습니다.

직접 수정해도 괜찮습니다. `id`를 그대로 두면 계속 동작하고, 삭제하면 다음에 읽을 때 새 값이 발급됩니다. 계정 블록을 복사해 두 번째 항목을 만들면 다음에 읽을 때 중복된 `id`가 감지되고, 둘 중 뒤에 있는 항목에 새 값이 부여됩니다.

## Codex 계정 (실험적)

OpenAI Codex 구독을 Claude 계정과 함께 풀에 넣을 수 있습니다.

```bash
aipool login --codex     # 브라우저 로그인, 계정마다 반복
```

브라우저를 여는 대신 URL을 출력하려면 `--no-browser`를, 계정 이름을 직접 붙이려면 `--name`을 추가합니다(기본값은 로그인한 계정의 이메일입니다).

이미 가지고 있는 로그인을 풀에 넣거나 브라우저 없이 계정을 추가하려면, 대신 계정이 Codex CLI 자체의 자격 증명 파일을 가리키도록 합니다. 기본값은 `~/.codex/auth.json`입니다.

```json
{ "name": "me@example.com", "type": "oauth", "provider": "codex" }
```

Codex CLI는 `CODEX_HOME`을 따르므로 여러 로그인을 나란히 보관해 두고 `importFrom`으로 풀에 넣을 수 있습니다.

```bash
CODEX_HOME=~/.codex-second codex login
```

```json
{ "name": "second", "type": "oauth", "provider": "codex",
  "importFrom": "~/.codex-second/auth.json" }
```

그런 다음 `~/.codex/config.toml`에서 Codex가 OpenAI 대신 AIPool에 접속하도록 설정합니다.

```toml
model_provider = "aipool"

[model_providers.aipool]
name = "aipool"
base_url = "http://127.0.0.1:3456/backend-api/codex"
wire_api = "responses"
requires_openai_auth = true   # 이미지 생성에 필요. `codex login`도 해 두세요
```

### MITM 프록시를 통한 방식 (Codex 설정 불필요)

MITM 모드는 `api.anthropic.com`뿐 아니라 `chatgpt.com`도 가로채므로, 프록시 뒤에서 실행한 Codex CLI는 `~/.codex/config.toml`을 전혀 바꾸지 않아도 풀에 포함됩니다.

```bash
eval "$(aipool env)"   # HTTPS_PROXY + NODE_EXTRA_CA_CERTS
codex
```

알아 둘 만한 경계가 두 가지 있습니다.

- `chatgpt.com`은 **Codex 계정이 설정된 경우에만** 가로챕니다. Anthropic 계정만 있는 계정 풀에서는 이 호스트를 건드리지 않고 그대로 터널링합니다. 아무도 프록시에 읽어 달라고 요청하지 않은 호스트를 가로채는 것은 중립적인 기본값이 아니기 때문입니다.
- `ab.chatgpt.com`은 절대 가로채지 않습니다. 이는 OpenAI의 텔레메트리 엔드포인트로, 추론 요청이 오가지 않으며 다시 쓸 내용도 없습니다.

아래의 base URL 라우트도 여전히 동작하며, MITM 없이 Codex를 풀에 넣는 방법입니다.

`OPENAI_BASE_URL`로는 이 작업을 할 수 **없습니다**. ChatGPT로 인증한 Codex는 이 값을 무시합니다. 지원되는 리디렉션 방법은 `model_providers`입니다.

`/backend-api/codex` 접미사가 중요합니다. Codex 구독은 OpenAI API 플랫폼이 아니라 ChatGPT 백엔드를 상대로 인증합니다. `api.openai.com`을 가리키면 같은 토큰이 `Missing scopes:
api.responses.write`와 함께 거부됩니다. Codex는 `base_url` 뒤에 `/responses`와 `/models`를 붙이므로, 이 접미사를 쓰면 Codex가 ChatGPT 백엔드가 기대하는 경로를 정확히 만들어 내고 AIPool은 이를 그대로 전달합니다.

### Claude와 포트를 공유하는 방식

하나의 리스너가 두 CLI를 모두 처리합니다. 요청 경로를 보면 어느 계정 풀이 대상인지 알 수 있기 때문입니다. Claude Code는 `/v1/messages`로, Codex는 `/backend-api/codex/responses`로 요청을 보냅니다. Anthropic 계정에는 Codex 요청이 절대 배정되지 않고 그 반대도 마찬가지이므로, 두 풀은 하나의 포트, 하나의 설정, 하나의 TUI에서 서로 독립적으로 로테이션됩니다.

### Claude 계정과 다른 점

- 자격 증명은 `Authorization: Bearer`와 `ChatGPT-Account-Id` 헤더로 주입됩니다. 이 헤더는 AIPool이 Anthropic 요청 본문에 패치해 넣는 `account_uuid`에 해당하는 OpenAI 측 대응물입니다. 따라서 Codex 경로에서는 본문을 전혀 다시 쓰지 않습니다.
- 토큰은 Codex CLI 자체의 client id를 사용해 `auth.openai.com`에서 갱신됩니다.
- 프록시는 응답 헤더를 계정 풀 기본값인 2분이 아니라 **5분** 동안 기다립니다. ChatGPT 백엔드는 모델이 추론을 마칠 때까지 아무것도 보내지 않기 때문에, 컨텍스트가 큰 턴에서는 완전히 정상인 소켓에서도 몇 분 동안 아무 응답이 없습니다. 이 대기는 응답 헤더에만 적용됩니다. 헤더가 도착하면 기한이 해제되고, 본문은 필요한 만큼 계속 스트리밍됩니다. `AIPOOL_UPSTREAM_HEADERS_TIMEOUT_MS`로 두 값을 모두 재정의할 수 있습니다.
- 요청 본문은 수정 없이 그대로 전달됩니다. 이는 패스스루일 뿐 변환 계층이 아닙니다. AIPool은 Anthropic 프로토콜과 OpenAI 프로토콜 사이를 절대 변환하지 않습니다.

### 쿼터

Codex는 모든 응답에 한도를 보고하며, AIPool은 이를 Anthropic 경로가 채우는 것과 같은 필드로 정규화합니다. 따라서 전환 임계값, 리셋 카운트다운, TUI의 쿼터 막대가 Codex 계정에서도 동작하며, 로테이션은 429를 받은 뒤가 아니라 업스트림이 거부하기 *전에* 일어납니다.

원시 헤더를 직접 읽는다면 알아 둘 만한 세부 사항이 두 가지 있습니다.

- 한도는 패밀리 단위로 전달됩니다. 이름이 없는 패밀리는 계정 전체 한도이고, `-limit-name`이 붙은 패밀리는 모델 범위 한도로 Anthropic의 Fable 주간 버킷에 해당합니다.
- `primary`와 `secondary`는 기간이 아니라 위치입니다. 계정 전체 패밀리는 `primary`에 7일 창을 넣을 수 있고, 모델 범위 패밀리는 같은 자리에 5시간 창을 넣을 수 있습니다. 창은 위치가 아니라 명시된 `window-minutes`로만 분류됩니다.

### 무료 레이트 리밋 리셋 크레딧

OpenAI는 가끔 ChatGPT 계정에 무료 **레이트 리밋 리셋 크레딧**을 지급합니다. 이를 사용하면 계정이 소진한 창이 원래 리셋 시점보다 먼저 초기화됩니다. Codex CLI는 이를 수동 작업으로만 제공하므로, 풀에 있는 계정이 바닥나면 누군가 크레딧이 있다는 사실을 알아채지 않는 한 크레딧을 가진 채로 남은 한 주를 쉬게 됩니다.

계정이 보유한 크레딧 개수는 쿼터 프로브에서 덤으로 얻습니다. 쿼터 값과 같은 `/wham/usage` 페이로드에 함께 실려 오며, TUI 행의 `RC1`, `aipool status`의 `Reset` 줄, 대시보드 카드의 배지로 표시됩니다. 이 값은 재시작 후에도 유지되는데, 프로브가 기본적으로 꺼져 있기 때문에 이 점이 중요합니다. 그렇지 않다면 다음에 무언가가 사용량 엔드포인트를 읽기 전까지 크레딧이 있다는 사실을 알려 주는 곳이 없을 것입니다.

개수는 프로브만 갱신하므로, 읽어 온 값이 그 값이 가리키는 크레딧보다 오래 남아 있을 수 있습니다(Codex CLI에서 이미 사용했거나 만료된 경우). 그래서 `status` 줄은 읽어 온 값이 얼마나 오래되었는지(`as of 3h ago`)를 함께 표시하며, 7일이 지난 값은 모든 화면에서 더 이상 표시하지 않습니다.

이 개수는 계정이 **보유한** 크레딧 수입니다. 특정 크레딧을 사용할 수 있는지는 별개의 문제입니다. 페이로드의 `applicable_available_count`는 지금 당장 창을 리셋할 수 있는 크레딧이 몇 개인지에 대한 업스트림 자체의 판단이며, 이 값이 0이면 `status` 줄에 표시됩니다. 크레딧 사용은 여전히 Codex CLI에서 수동으로 해야 합니다.

## 서드파티 백엔드 계정

Anthropic 호환 API라면 무엇이든 Claude 계정과 함께 계정으로 추가할 수 있습니다. `priority` 값을 더 높게 지정하면(값이 낮을수록 우선이므로 예를 들어 `100`) 모든 Claude 계정이 소진되었을 때 폴백으로 사용됩니다.

```json
{
  "name": "deepseek",
  "type": "oauth",
  "accessToken": "sk-your-deepseek-api-key",
  "upstream": "https://api.deepseek.com/anthropic",
  "priority": 100,
  "modelMap": {
    "claude-haiku-4-5-20251001": "deepseek-v4-flash",
    "claude-sonnet-4-6": "deepseek-v4-pro[1m]"
  }
}
```

- **`upstream`** — 대상 API의 base URL입니다. 이 계정에 한해서만 요청이 `upstream + /v1/messages`(등)로 전송됩니다. 한 종류의 요청은 전달되지 않고 프록시가 직접 응답합니다. 자세한 내용은 아래 [메시지 스레드](#메시지-스레드)를 참고하세요.
- **`modelMap`** — 요청 본문에 Claude 모델 이름이 들어오면, 전달하기 전에 매핑된 이름으로 다시 씁니다.
- **`messageThreads`** — 백엔드가 Anthropic 메시지 스레드 상태를 유지하는 경우(Anthropic에 도달하는 릴레이가 그렇습니다) `true`로 설정합니다. 서드파티 백엔드에서는 기본적으로 꺼져 있습니다. 아래에서 설명합니다.

공급자가 자체 잔액이나 쿼터를 공개하는 경우 그 값이 `aipool status`에 표시됩니다. 자세한 내용은 [서드파티 백엔드 쿼터](quota.md#서드파티-백엔드-쿼터)를 참고하세요.

[라우트](routing.md#모델-라우트)를 사용하면 해당 모델을 명시적으로 요청한 세션 전용으로 백엔드를 남겨 둘 수 있습니다.

```json
{ "name": "deepseek", "match": ["deepseek-*"], "accounts": ["deepseek"] }
```

그런 다음 실행할 때, 또는 세션 안에서 `/model`로 모델을 선택합니다.

```bash
# 이 세션은 DeepSeek으로 라우팅되고, 다른 모든 세션은 계속 Claude 계정을 사용합니다.
claude --model 'deepseek-v4-pro[1m]'
```

대괄호가 들어간 모델 이름(예: `deepseek-v4-pro[1m]`)은 셸에서 따옴표로 감싸야 합니다.

### 메시지 스레드

스레드가 생기면 Claude Code는 대화를 서버 쪽에 유지합니다. 첫 번째 `/v1/messages` 본문에는 전체 messages 배열과 함께 `thread: {"type": "create"}`가 실리고, 이후의 모든 본문에는 새로운 델타만과 함께 `thread: {"type": "continue"}`가 실립니다. 스레드 상태를 유지하지 않는 백엔드는 알 수 없는 필드를 무시하고 델타만 보고 응답하므로, 두 번째 턴부터 모델은 더 이상 대화를 보지 못하며 어디에서도 오류가 보고되지 않습니다.

스레드를 이어 갈 수 없으면 Anthropic은 `400`으로 응답하고, Claude Code는 포기하는 대신 전체 대화를 다시 보냅니다(2.1.269에서 확인). 그래서 프록시는 계정별 `upstream`이 지정된 계정으로 향하는 `continue` 요청을 전달하지 않고 같은 `400`으로 직접 응답합니다. 응답 본문에는 `details.error_code: "thread_unsupported_request"`가 담기며, 클라이언트는 이를 "이 모델은 스레드 상태를 유지하지 않는다"는 뜻으로 해석합니다. 클라이언트는 해당 턴을 전체로 다시 보낸 뒤 세션이 끝날 때까지 `thread` 필드를 아예 빼므로, 거부는 턴 단위가 아니라 에이전트와 모델 단위로 한 번씩만 발생하며 토큰도 소모하지 않습니다. 서브에이전트를 실행하는 세션에서는 메인 에이전트에 대해 한 번, 그리고 해당 모델을 쓰는 서브에이전트마다 한 번씩 거부가 발생합니다. `count_tokens`는 절대 거부되지 않습니다. 토큰 수를 셀 때는 다시 보낼 대화가 없기 때문입니다.

클라이언트가 설정하는 플래그는 해당 모델을 처리하는 계정이 아니라 모델을 기준으로 합니다. 같은 모델 이름을 서드파티 백엔드와 Anthropic 계정이 모두 제공한다면, 한 번의 거부로 세션이 끝날 때까지 그 모델의 스레드가 모든 곳에서 꺼집니다. 대화는 여전히 동작하며, 다만 매 턴 전체가 전송될 뿐입니다.

호스트가 Anthropic 자체 호스트인 `upstream`은 별도 플래그 없이도 그대로 둡니다. 리전 고정이나 미러는 실제 스레드 저장소에 도달하므로 바로잡을 것이 없습니다. 판단 기준은 호스트입니다. Anthropic 형식을 제공하는 서드파티 API는 자체 호스트에서 그렇게 합니다.

이 동작은 계정별 `upstream`이 있을 때만 활성화됩니다. 전역 `upstream`으로 서드파티 호스트를 가리키는 계정 풀은 대상이 아니며, 그런 경우에 거부를 켜는 설정도 없습니다.

Anthropic으로 전달하는 릴레이는 실제로 스레드 상태를 유지하므로, 이런 릴레이에는 거부가 순전히 오버헤드일 뿐입니다. 클라이언트가 아무 이득 없이 매 턴 전체 기록을 다시 보내게 됩니다. `"messageThreads": true`로 선언하면 continue 요청이 수정 없이 그대로 전달됩니다.

### `accounts[].models` 지원 중단

예전의 계정별 `models` 목록은 여전히 동작하지만, 대신 [라우트](routing.md#모델-라우트)를 사용하세요. 라우트는 더 유연하고(glob 매칭, 여러 계정, 버킷 재정의) 예상 밖의 동작이 적습니다. `models` 목록은 *계정 풀 전체*에 걸쳐 어떤 계정이 선택 대상이 되는지를 바꿉니다. 어느 한 계정이라도 특정 모델을 지정하면, 그 모델을 지정하지 않은 모든 계정은 해당 모델에 대해 건너뜁니다. 서버는 시작 시 이를 대체할 라우트를 알려 주는 지원 중단 알림을 출력하며, 이 필드는 향후 버전에서 제거될 수 있습니다.
