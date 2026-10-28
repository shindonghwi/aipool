# 설정

## 저장 위치

설정은 `~/.config/aipool.json`(또는 `$XDG_CONFIG_HOME/aipool.json`)에 저장됩니다. 처음 사용할 때 무작위 프록시 API 키가 생성됩니다.

자주 바뀌는 런타임 상태(관찰된 쿼터)는 설정 파일 옆의 `aipool.state.json`에 따로 기록되므로, 설정 파일은 깔끔하게 유지되어 직접 편집하기 쉽습니다. 상태 파일은 삭제해도 안전합니다. 쿼터는 트래픽을 통해 다시 학습될 뿐입니다.

설정 파일을 다시 쓰는 동안에는 — 서버가 리프레시 토큰을 로테이션할 때든, 저장 동작이 있는 CLI 명령이든, 다른 어떤 클라이언트든 — 쓰는 쪽이 그 옆에 `aipool.json.lock`을 잡습니다. 이 파일에는 `{"pid":<pid>,"at":<ms epoch>}`가 들어 있습니다. 이는 서로 다른 작성자가 서로의 편집을 덮어쓰지 않고 서로를 기다리도록 하는 권고(advisory) 잠금입니다(이 과정에서 유실되던 쓰기는 대개 방금 로테이션된 리프레시 토큰이었고, 그 대가로 다시 로그인해야 했습니다). 잠금 파일은 몇 밀리초 동안만 존재합니다. 10초보다 오래되었거나 해당 pid가 사라진 잠금은 오래된(stale) 것으로 간주되어 다음 작성자가 제거하며, 2초 안에 잠금을 얻지 못한 작성자는 멈춰 기다리지 않고 로그에 경고를 한 번 남긴 뒤 그대로 진행합니다. 잠금 파일이 남아 있다면 직접 삭제해도 안전합니다.

## 형식

```json
{
  "proxy": {
    "port": 3456,
    "apiKey": "tc-auto-generated-key"
  },
  "upstream": "https://api.anthropic.com",
  "switchThreshold": 0.98,
  "sx": { "apiKey": "your-sx-org-api-key", "mode": "always" },
  "accounts": [
    {
      "name": "user@example.com (Acme)",
      "type": "oauth",
      "accountUuid": "...",
      "orgUuid": "...",
      "orgName": "Acme",
      "priority": 0,
      "accessToken": "sk-ant-oat01-...",
      "refreshToken": "sk-ant-ort01-...",
      "expiresAt": 1774384968427
    }
  ]
}
```

## 필드

| 필드 | 설명 |
| --- | --- |
| `proxy.port` | 프록시가 수신 대기하는 로컬 포트입니다 |
| `proxy.host` | 바인딩할 인터페이스입니다. 기본값은 `127.0.0.1`(localhost 전용)입니다. 다른 머신의 클라이언트를 받으려면 `0.0.0.0`으로 설정합니다(또는 환경 변수 `AIPOOL_HOST`로 재정의합니다). 이 경우 원격 클라이언트는 키를 제시해야 하므로(`x-api-key`로, 또는 CONNECT/HTTPS 프록시로 사용할 때는 `Proxy-Authorization`으로) **`proxy.apiKey`를 반드시 설정해야 합니다**. 루프백은 `proxy.trustLoopback`이 `false`가 아닌 한 면제됩니다 |
| `proxy.apiKey` | 클라이언트가 프록시에 인증할 때 사용하는 API 키입니다(루프백이 아닌 모든 클라이언트에 필수입니다. 프록시가 실제 계정 토큰을 주입하므로, 인증 없이 열린 포트는 그 토큰을 유출하게 됩니다) |
| `proxy.trustLoopback` | `127.0.0.1` / `::1`에서 들어온 연결이 프록시 키를 생략할 수 있는지 여부입니다(기본값 `true`). **같은 호스트에서 리버스 프록시 뒤에 둘 때는 `false`로 설정하세요** — `127.0.0.1`에 바인딩된 리스너 앞에서 nginx나 Caddy가 TLS를 종료하면 인터넷의 모든 호출자가 루프백에서 온 것처럼 보이므로, 이 설정이 없으면 키 검사가 전혀 실행되지 않아 익명 요청이 계정 풀의 쿼터를 소모하게 됩니다. 이 설정과 무관하게 `X-Forwarded-For`, `X-Real-IP`, `Forwarded`를 담은 루프백 요청은 절대 면제되지 않으므로, 흔한 배포 형태는 기본적으로 막혀 있습니다. 이 설정은 그런 헤더를 하나도 보내지 않도록 구성된 리버스 프록시를 위한 것입니다. AIPool 자체 명령은 모든 호출에 `proxy.apiKey`를 제시하므로, 로컬 설치는 어느 쪽이든 계속 동작합니다 |
| `proxy.terminalOnly` | [MITM 모드](proxy-modes.md#mitm-프록시-모드기본값)에서 풀에 Codex 계정이 있더라도 `chatgpt.com`을 종료(terminate)하지 않고 터널링합니다(기본값 `false`). ChatGPT Desktop 앱도 함께 실행하는 머신을 위한 설정입니다. 이렇게 하면 앱의 네이티브 인증 및 기능 엔드포인트는 AIPool을 전혀 거치지 않고, 터미널의 Codex CLI는 명시적인 `/backend-api/codex` base URL을 통해 계속 풀에 접근합니다 |
| `proxy.clientKeys` | 선택 사항인 클라이언트별 키입니다: `[{ "name": "alice", "key": "tc-…" }, …]`. 각 항목은 `proxy.apiKey`와 똑같이 인증하며, 그 응답이 보고하는 토큰은 `name` 앞으로 집계됩니다. 클라이언트별 사용량은 `/aipool/status`의 `clients` 아래, `aipool status`, 그리고 (`--activity-log` 사용 시) 각 요청 줄 앞의 `[name]` 접두사로 표시됩니다. 이 키로 연 WebSocket 채널(Remote Control)은 요청과 별도로 해당 클라이언트의 `connections`로 집계되며, 열림/닫힘 줄에도 같은 접두사가 붙습니다. 카운터는 상태 파일에 영구 저장됩니다. 공유 `proxy.apiKey`나 루프백 면제를 통한 트래픽은 어느 클라이언트에도 귀속되지 않으므로, 완전한 통계를 원한다면 모든 사용자에게 각자의 항목을 부여하세요. 편집 내용은 `POST /aipool/reload`로 즉시 적용됩니다 |
| `proxy.usageDimensions` | 선택 사항인 요청 헤더 기반 사용량 차원입니다: `[{ "name": "project", "header": "x-aipool-project" }, …]`. 프록시는 각 요청에서 설정된 헤더를 읽어 응답 토큰을 정제(sanitize)된 헤더 값 앞으로 집계하며, 결과는 `/aipool/status`, `aipool status`, 대시보드의 `usageDimensions` 아래에 표시됩니다. 헤더를 생략한 요청은 해당 차원에서 귀속되지 않을 뿐입니다. 카운터는 상태 파일에 영구 저장되며, 각 차원은 서로 다른 값 500개로 제한됩니다. 그 이상의 값은 기존 행을 밀어내지 않고 `(other)`에 합산됩니다. 편집 내용은 `POST /aipool/reload`로 즉시 적용됩니다 |
| `proxy.sessionDetail` | `/aipool/status`와 대시보드에 대화별 내역(`sessions.items`)을 추가합니다. 대화마다 한 행이며, 그 대화가 속한 클라이언트 세션과 그 안에서 대화를 식별하는 다이제스트, 그리고 클라이언트, 차원 값, 고정된 계정, 주간 버킷별로 사용한 토큰을 보여 줍니다. 서브에이전트로 분기하는 세션은 에이전트마다 한 행이 됩니다. 행의 `id`는 `session/digest` 복합 키이며, 두 부분은 별도의 `session` 및 `conversation` 필드로도 반복됩니다. 그룹화는 `id`가 아니라 `session` 기준으로 하세요. **기본값은 꺼짐**입니다 — 어떤 프록시 키든 가진 사람은 누구나 상태를 읽을 수 있으므로, 공유 프록시에서는 모든 사용자가 다른 모든 사용자가 무슨 작업을 하는지 보게 됩니다. 집계된 `sessions` 카운트는 영향을 받지 않으며 항상 표시됩니다 |
| `proxy.mcp` | `/aipool/mcp`에서 [MCP 관리 엔드포인트](usage.md#mcp-엔드포인트)를 제공합니다. `"read"`는 상태, 쿼터, 로테이션 설정을 노출하고, `"full"`은 계정 제거를 포함해 이를 변경하는 도구를 추가합니다. 기본값은 `"off"`이며, 이 세 가지 외의 값은 모두 `"off"`로 취급됩니다. 요청마다 읽히며 reload 시 반영됩니다. 이 엔드포인트는 `/aipool/`의 나머지 부분과 같은 접근 검사를 거치며, 고유한 검사 두 가지가 더해집니다. 이름이 붙은 `proxy.clientKeys` 키는 `"full"` 모드에서도 `"read"`로 제공되므로 공유 `proxy.apiKey`와 키가 면제된 루프백 호출자만 계정 풀을 재구성할 수 있고, 프록시 키가 하나도 설정되지 않은 경우에는 포워딩 헤더가 없는 루프백 호출자에게만 제공됩니다. 키나 `proxy` 섹션 전체를 삭제하면 다음 reload 때 꺼집니다 |
| `upstream` | 업스트림 API base URL입니다 |
| `switchThreshold` | 계정을 전환하는 쿼터 사용률(0–1)입니다(`aipool threshold <1-100>`, 또는 TUI 설정 화면의 **Switch threshold**). 이 화면은 `99.5`처럼 0.1% 단위 값을 받으며, 이는 `0.995`로 저장됩니다. OAuth 계정이 보고하는 사용률은 정수 퍼센트 단위로 들어오므로, 소수 값이 실제 결과를 바꾸는 것은 사용 비율이 연속적인 API 키 계정뿐입니다 |
| `quotaProbeSeconds` | 백그라운드 [쿼터 프로브](quota.md#쿼터-프로브) 간격(초)입니다(`0` = 꺼짐, 기본값. CLI `probe`, 또는 TUI 설정 화면의 **Quota probe** 행) |
| `warmupSeconds` | [Keep-warm](quota.md#keep-warm) 간격(초)입니다(`0` = 꺼짐, 기본값. CLI `warmup`). 유휴 계정마다 최소한의 `claude`를 실행해 5시간 타이머를 시작시킵니다 — 프로브와 달리 **쿼터를 약간 소모합니다** |
| `warmupSchedule` | 선택 사항인, 리셋 시각을 목표로 하는 keep-warm 일정입니다. 일간(daily) 모드는 `{ "resetTime": "15:30", "timezone": "Europe/Moscow" }`를 저장하고, 롤링(rolling) 모드는 여기에 `"mode": "rolling"`과 절대 시각인 `"anchorResetAt"`도 저장합니다. 시간대는 IANA 이름이어야 합니다. `warmupSeconds`와 함께 쓸 수 없으며, `aipool warmup reset HH:MM --timezone Area/City` 또는 `aipool warmup rolling HH:MM --timezone Area/City`로 설정합니다 |
| `holdSeconds` | 모든 계정이 소진되었을 때, 하나가 회복될 때까지 조용히 폴링하며 [연결을 유지](quota.md#소진-시-대기)하는 최대 시간(초)입니다(`0` = 즉시 429 반환, 기본값). `aipool run`은 이에 맞춰 `API_TIMEOUT_MS`를 자동으로 올립니다. 시작 시 읽으므로 변경하려면 재시작해야 합니다 |
| `distributeSessions` | 동시에 진행되는 대화를 같은 우선순위의 계정들에 분산하고, 캐시 재사용을 위해 각 대화를 계정에 고정합니다(`aipool distribute <on\|off\|adaptive>`). 분산 단위는 대화이며 그 대화를 담은 클라이언트 세션이 아니므로, 세션과 그 서브에이전트가 한 계정으로 몰리지 않고 분산됩니다. 고정은 주간 쿼터 버킷마다 하나씩이므로, 한 모델 계열에서 다른 계정으로 옮겨 가도 다른 계열은 그대로 유지됩니다(`false` = 쿼터 기반 로테이션만 사용, 기본값). `"adaptive"`로 설정하면 세 번째 모드가 되어, 새 대화를 남은 주간 크레딧이 가장 적은 계정에 집중시킵니다 — 그 계정이 `switchThreshold`에 가까워질수록 점차 줄이고, 혼잡하면 물러납니다. 구독 용량은 OAuth 프로필 티어에서, 현재 사용률/리셋 시각은 쿼터 헤더에서 가져오며, 소진 속도와 허용 동시성은 실시간 트래픽에 맞춰 조정됩니다. [적응형 분산](routing.md#적응형-분산)을 참고하세요. 설정 reload 시 즉시 적용되며, **끄면** 점진적으로 빠집니다(drain) — 이미 진행 중인 대화는 계정을 유지하고 새 대화만 분산을 멈추므로, 대화 도중에 프롬프트 캐시를 잃는 일이 없습니다. 세션 추적과 표시는 이와 관계없이 항상 켜져 있습니다 — [세션 인식 라우팅](routing.md#세션-인식-라우팅)을 참고하세요 |
| `adaptiveDistribution` | [적응형 분산](routing.md#적응형-분산)의 선택적 튜닝입니다. 숫자로 이루어진 객체이며 모든 필드는 선택 사항입니다. 알 수 없는 필드, 숫자가 아니거나 유한하지 않은 값, 범위를 벗어난 값은 해당 필드를 명시한 **시작 오류**가 됩니다(그렇지 않으면 잘못된 숫자 하나가 모든 적응형 점수를 `NaN`으로 만들어 조용히 균등 모드처럼 라우팅하게 됩니다). 학습기는 모든 모드에서 실행되고 상태를 저장하므로, 이 블록은 모드가 켜져 있든 아니든 검사됩니다. 필드와 기본값: `maxSampleAgeMs` (`900000`, > 0) — 이보다 오래된 소진 샘플은 유휴 구간에 걸친 것으로 보고 버립니다; `lookaheadMs` (`1800000`, > 0) — 예비분(reserve)이 계정의 소진 속도를 얼마나 앞까지 내다보는지; `burnWindowMs` (`300000`, > 0) — 소진 속도 샘플 하나를 측정하는 실제 시간 간격; `burnAlpha` (`0.3`, (0, 1] 범위) — 새 소진 샘플의 EWMA 가중치; `minReserve` / `maxReserve` (`0.01` / `0.2`, [0, 1] 범위의 비율, min ≤ max) — 테이퍼가 작동하는 예비분의 하한과 상한; `initialBurnRate` (`0.05/3600000`, ms당 사용률로 시간당 창의 약 5%, ≥ 0) — 실제 관측값이 생기기 전까지 가정하는 값; `initialConcCap` / `minConcCap` / `maxConcCap` (`6` / `1` / `64`, > 0, min ≤ initial ≤ max) — 허용 동시성 추정치의 시작점과 학습 가능한 범위; `concBackoff` (`0.5`, (0, 1] 범위) — 스로틀이 발생했을 때 적용하는 EWMA 가중치; `concBackoffTo` (`0.75`, (0, 1] 범위) — 스로틀을 일으킨 부하 대비 물러날 비율; `concGrowth` (`0.05`, (0, 1] 범위) — 상한에서 실행 중일 때 +1 프로브의 EWMA 가중치; `maxBurnBoost` (`4`, ≥ 1) — 소진 우선(burn-down) 선호도의 상한으로, 임계값 부근에서 테이퍼가 우세할 수 있게 해 주는 값입니다. 시작 시에만 읽습니다 |
| `defaultClientMode` | `--mitm`과 `--no-mitm` 중 어느 것도 주지 않았을 때 `aipool run`과 `aipool env`의 동작입니다. `mitm`(기본값)은 실행된 클라이언트의 모든 요청을 프록시로 라우팅하며, 하드코딩된 `api.anthropic.com` 엔드포인트와 Codex CLI까지 포괄하는 방식이 바로 이것입니다. `base-url`은 `ANTHROPIC_BASE_URL`만 설정하므로, `eval "$(aipool env)"`로 설정한 셸이 다른 도구(`gh`, `git`, 패키지 매니저)까지 프록시로 보내지 않습니다. 플래그가 항상 이 설정보다 우선합니다. 설정 화면(**g** → Client mode)에서 전환하며, 실행할 때마다 디스크에서 읽습니다 |
| `skipPermissions` | `aipool run`(과 `claude` 별칭)이 `claude`에 `--dangerously-skip-permissions`를 붙일지 정합니다. 기본값 `true`, `false`로 끕니다. 인수에 `--dangerously-skip-permissions`나 `--permission-mode`가 이미 있으면 그대로 두고, root에서는 Claude Code가 이 플래그를 거부하므로 붙이지 않습니다(`IS_SANDBOX=1`이면 붙임) |
| `eventLogging` | 활동 로그에 대량의 잡음을 만드는 Claude Code의 텔레메트리(`/api/event_logging/*`)를 처리하는 방식입니다. `hide`(기본값)는 전달하되 활동 로그에는 표시하지 않고, `block`은 전달하지 않고 로컬에서 `200`으로 응답하며(업스트림 왕복 없음), `show`는 전달하고 표시합니다. 편집 내용은 `POST /aipool/reload`로 즉시 적용됩니다 |
| `logDir` | 요청/응답 로그를 저장할 디렉터리로, 기록된 요청마다 파일이 하나씩 생깁니다(CLI: `--log-to DIR`). 설정하지 않으면(기본값) 아무것도 기록하지 않습니다. 디렉터리는 `0700`, 각 파일은 `0600`으로 생성되며(이미 있는 디렉터리나 파일은 기존 권한을 유지합니다), 생성할 수 없는 디렉터리는 시작 시 한 번 보고되고 그 실행 동안 로깅이 꺼집니다. 기록되는 요청 본문은 업스트림으로 보낸 본문이므로, 프록시가 다시 쓴 내용(도구 쌍 정리, `modelMap`)도 그대로 보입니다. 429는 다른 계정으로 전환하든, 그 자리에서 기다리든, 클라이언트에 반환되든 파일을 전혀 남기지 않으며, 인증 실패는 재시도하는 시도들에 대해 파일을 남기지 않습니다. 제한 없이 두면 빠르게 커집니다 — 동시 세션 몇 개를 일주일 동안 돌렸을 때 24,516개 파일에 13 GB가 측정되었는데, 기록된 요청 하나가 양쪽 본문을 모두 그대로 기록하기 때문입니다. 아래 세 키 중 `logMaxBodyBytes`와 `logRetentionHours`가 상한 역할을 하며 기본적으로 켜져 있고, `logLevel`은 상세도와 크기를 맞바꿉니다 |
| `logLevel` | `logDir`이 각 요청을 얼마나 기록하는지입니다. `body`(기본값)는 헤더와 양쪽 본문을 기록하고, `headers`는 요청과 응답의 헤드만 기록해 요청당 메가바이트 단위 대신 약 1킬로바이트로 줄이며, `off`는 `logDir`을 설정해 둔 채로 아무것도 기록하지 않습니다 |
| `logMaxBodyBytes` | `logDir`이 방향별로 보관하는 최대 본문 크기로, 기본값은 `262144`입니다. JSON은 기록할 때 보기 좋게 정렬(pretty-print)되므로 디스크에 남는 크기는 상한보다 큽니다. 이보다 긴 본문은 잘리고 버려진 바이트 수가 표시됩니다. 완전한 본문은 앞부분과 끝부분을 남기고, 스트리밍된 본문은 앞부분만 남깁니다. `0`이면 모든 본문을 전부 기록합니다. 클라이언트가 받는 내용에는 전혀 영향이 없습니다 |
| `logRetentionHours` | `logDir` 파일을 삭제하는 경과 시간으로, 기본값은 `72`입니다. 시작 시 한 번, 그 뒤로 10분마다 정리하며, 로거가 직접 기록한 이름의 파일만 대상으로 합니다. `0`이면 모든 파일을 영구 보관합니다 |
| `blockedModels` | 모델 glob 패턴의 배열(예: `["*fable*"]`)로, 해당 모델의 요청은 전달되지 않고 재시도 불가능한 `400`으로 즉시 거부됩니다 — 어떤 계정도 처리할 수 없는 모델이 업스트림에서 레이트 리밋에 걸려 파이프라인이 멈추는 일을 막습니다. 비어 있으면(기본값) 아무것도 차단하지 않습니다. 편집 내용은 `POST /aipool/reload`로 즉시 적용됩니다 |
| `sessionTitles` | [활동 로그의 세션 제목](usage.md#활동-로그의-세션-제목)입니다(기본값 꺼짐). 객체: `{ enabled, width, projectsDir }` — 각 활동 행에 ID의 16진수 여섯 글자 대신, 그 요청을 보낸 Claude Code 세션의 이름을 표시합니다. `width`는 레이블에 할당되는 열 수입니다(기본값 18. 켜져 있는 동안에는 모든 행이 이 폭을 차지하므로 뒤의 열들이 정렬된 상태로 유지됩니다). `projectsDir`은 `~/.claude/projects`를 재정의합니다. 표시 전용이며, 계정 선택 코드는 이 값을 읽지 않습니다. 설정 화면(**g** → Session titles)에서 전환하며, 모든 필드는 설정 reload 시 즉시 적용됩니다 |
| `stormRamp` | 선택 사항인 [스톰 제어](routing.md#스톰-제어) 튜닝입니다(기본값 켜짐). 객체: `{ enabled, startConc, stepConc, stepMs, windowMs }` |
| `expiryRouting` | 선택 사항인 [만료 압력 라우팅](routing.md#만료-압력-라우팅)입니다(기본값 꺼짐). 객체: `{ enabled, tolerance, preempt }` — 기준이 되는 주간 쿼터가 넉넉하면서 가장 빨리 리셋되는 계정을 우선합니다. **키 이름은 잠정적입니다** |
| `routes` | 모델 패턴을 특정 계정에 고정하는 [라우팅 규칙](routing.md#모델-라우트)의 선택적 목록입니다 |
| `autoUpdate` | `false`로 설정하면 백그라운드 [자동 업데이트](usage.md#업데이트) 확인을 끕니다 |
| `upstreamProxy` | **AIPool이 Anthropic으로 보내는 모든 것** — 요청 전달, OAuth 로그인, 토큰 갱신, 프로필 및 사용량 조회 — 에 쓰이는 아웃바운드 HTTP 프록시입니다. `"http://user:pass@host:3128"` 또는 그냥 `"host:3128"` 형식입니다. `false`는 프록시를 끄고 *또한* 환경 변수도 무시합니다. 설정하지 않으면 `HTTPS_PROXY`/`ALL_PROXY`가 있을 때 그것을 사용합니다. AIPool 자신의 리스너를 가리키는 값은 무시됩니다(서버가 자기 자신을 경유하게 되기 때문입니다). TUI 설정 화면: **Upstream proxy**. [업스트림 프록시](proxy-modes.md#업스트림-프록시)를 참고하세요 |
| `noProxy` | `upstreamProxy`를 우회할 호스트를 쉼표로 구분해 나열합니다(접미사 일치, `*` = 전체). 기본값은 환경의 `NO_PROXY`입니다 |
| `mitm.http1Only` | 가로챈 MITM 연결에서 HTTP/1.1만 제공합니다(기본값 `false`). **Claude Code Desktop 앱의 Remote Control**에 필요합니다. HTTP/2 위의 WebSocket에는 RFC 8441 extended CONNECT가 필요한데 이는 중계되지 않으므로, h2를 협상한 클라이언트는 오류 없이 핸드셰이크가 끊깁니다 — 세션이 한 방향으로만 동기화되고 휴대폰에서 보낸 메시지는 전달되지 않습니다. 루프백 구간의 클라이언트→프록시 다중화를 포기하게 되지만, 업스트림은 이미 풀링된 HTTP/1.1을 사용합니다 |
| `sx.apiKey` | [sx.org](https://sx.org) API 키입니다. 설정하면 AIPool이 주거용 프록시를 자동으로 준비합니다(egress IP 기반 429 우회책). 없거나 비어 있으면 꺼집니다 — [sx.org 프록시 모드](proxy-modes.md#sxorg-프록시-모드)를 참고하세요 |
| `sx.mode` | `always`(모든 업스트림 트래픽을 라우팅), `429`(직접 연결하다가 429가 오면 프록시로 페일오버), `off`(키는 유지하되 사용하지 않음) 중 하나입니다. 키가 설정되어 있으면 기본값은 `always`입니다 |
| `accounts[].accountUuid` | Anthropic 계정(사람) ID로, OAuth 프로필에서 자동으로 설정됩니다 |
| `accounts[].orgUuid` / `orgName` | 계정이 속한 조직입니다 — 하나의 이메일로 여러 조직 계정을 보유할 수 있게 합니다 |
| `accounts[].priority` | 로테이션 선호도로, 값이 낮을수록 우선합니다(기본값 0) |
| `accounts[].switchThreshold` | 계정 풀 전체에 적용되는 `switchThreshold`를 계정별로 재정의합니다. 숫자 또는 `{ "unified7dFable": 0.8 }` 같은 버킷별 테이블입니다. 값은 버킷 단위로 결정됩니다 — 해당 버킷에 대한 계정 테이블의 항목, 없으면 계정 자체의 `default`(또는 단일 숫자), 그것도 없으면 그 버킷에 대한 계정 풀의 `switchThreshold` 순입니다 — 따라서 `default`가 없는 테이블은 나열한 버킷만 재정의하고 나머지는 계정 풀 설정을 상속합니다. 계정 풀 설정과 똑같이 이것도 *선호*일 뿐이며, 모든 계정이 소진되었을 때의 재검증 프로브가 이를 무시할 수도 있습니다. 바로 이 점 때문에 아래의 강제 상한인 `accounts[].maxUsage`와는 별개의 설정입니다. CLI 편집 기능은 없으므로 `maxUsage`와 마찬가지로 직접 편집한 뒤 reload하세요. reload 시 즉시 적용됩니다. [계정별 임계값](quota.md#계정별-임계값)을 참고하세요 |
| `accounts[].displayOrder` | TUI 계정 목록에서 계정이 놓이는 위치로, 낮은 값이 먼저 옵니다. 설정하지 않은 계정은 값이 있는 모든 계정 뒤에 나열됩니다. **표시 전용**입니다 — 로테이션이 어느 계정을 사용할지는 전혀 결정하지 않으며, 그것은 위의 `priority`가 정합니다. TUI(**`g`** → **Reorder accounts**)에서 설정하거나 직접 편집하며, reload 시 즉시 적용됩니다 |
| `accounts[].maxUsage` | 계정별 강제 사용량 상한입니다. 숫자 또는 `{ "unified7d": 0.6, "unified7dFable": 0.8 }` 같은 버킷별 테이블입니다(`switchThreshold`와 같은 키를 쓰며, `default`는 나열되지 않은 버킷에 적용되고 그 밖의 버킷에는 상한이 없습니다). 상한에 도달한 계정은 요청을 **전혀** 받지 않습니다 — 로테이션이 건너뛰고, 모든 계정이 소진되었을 때의 재검증 프로브도 건너뛰며, 이 계정에 고정된 요청은 소진 응답을 받습니다. 임계값처럼 모델 범위로 적용되며, reload 시 즉시 적용됩니다. [계정별 사용량 상한](quota.md#계정별-사용량-상한)을 참고하세요 |
| `accounts[].disabled` | `true`이면 다시 활성화할 때까지 해당 계정을 로테이션에서 제외합니다 |
| `accounts[].upstream` | 이 계정에 쓸 대체 업스트림 base URL입니다(예: `https://api.deepseek.com/anthropic`). 이 계정에 한해 전역 `upstream`을 재정의합니다 — [서드파티 백엔드](accounts.md#서드파티-백엔드-계정)를 참고하세요 |
| `accounts[].modelMap` | Anthropic 모델 이름을 이 백엔드의 모델 이름으로 매핑하는 객체입니다(예: `{"claude-sonnet-4-6": "deepseek-v4-pro[1m]"}`). 요청이 이 계정으로 라우팅될 때 자동으로 적용됩니다 |
| `accounts[].messageThreads` | 이 업스트림이 Anthropic 메시지 스레드 상태를 유지한다면 `true`로 설정합니다. 호스트가 Anthropic 자체가 아닌 계정별 `upstream`을 가진 계정에서는 기본값이 꺼짐입니다(리전 고정이나 미러에는 이 플래그가 필요 없고, 전역 `upstream`은 이를 활성화하지 않습니다). 스레드 상태를 유지하지 않는 백엔드는 해당 턴의 델타만 받게 되므로, 프록시는 `thread: {"type": "continue"}`에 대해 Anthropic이 이어 갈 수 없는 스레드에 돌려주는 것과 같은 `400`으로 응답하고, 그러면 Claude Code는 전체 대화를 다시 보내고 해당 세션에서 그 모델의 스레딩을 중단합니다. 완성(completion) 요청에만 해당하며, `count_tokens`는 항상 전달됩니다. [메시지 스레드](accounts.md#메시지-스레드)를 참고하세요 |
| `accounts[].stripRequestFields` | 이 계정으로 전달하기 전에 제거할 **최상위** 요청 본문 필드의 배열입니다. Anthropic 메시지 API를 구현하지만 Claude Code가 보내는 필드를 거부하는 서드파티 업스트림을 위한 것입니다(예: `["context_management"]` — 일부 업스트림은 이 필드에 `400 Extra inputs are not permitted`를 반환하므로, 그 계정이 선택되는 순간 모든 요청이 실패합니다). 이 계정에만 적용되며 Anthropic 계정은 영향을 받지 않습니다. 중첩 형식은 하나만 허용됩니다. `"cache_control.<subfield>"`(예: `["cache_control.scope"]`)는 문서화된 모든 프롬프트 캐시 브레이크포인트(루트, `system[]`, `messages[].content[]`, `tools[]`)에서 해당 하위 필드를 제거하며, 이를 `400 unknown parameter`로 거부하는 백엔드를 위한 것입니다. `type`과 `ttl`은 나열하지 않는 한 전달됩니다. 항목이 없으면 아무것도 제거하지 않습니다 |
| `accounts[].models` | **더 이상 사용되지 않음** — 대신 `match`와 `accounts`를 지정한 [`routes`](routing.md#모델-라우트) 항목을 사용하세요. 이 계정이 독점적으로 처리하는 모델 이름의 배열이며, routes 도입 이전 설정과의 하위 호환을 위해 유지됩니다 |

## 환경 변수

| 변수 | 효과 |
| --- | --- |
| `TC_ACCT` | 로테이션을 우회해 [세션을 **하나의** 계정에 고정](routing.md#세션을-한-계정에-고정)합니다. `accountUuid`, `orgUuid`, `accountUuid/orgUuid`, 또는 표시 이름/이메일을 받습니다. `aipool run`과 `aipool env`가 읽은 뒤 환경에서 제거하므로 claude에는 절대 전달되지 않습니다 |
| `AIPOOL_CONFIG` | 설정 파일 경로입니다(기본값 `~/.config/aipool.json`) |
| `AIPOOL_HOST` | `proxy.host`를 재정의합니다 |
| `AIPOOL_DISABLE_AUTOUPDATE` | `1`로 설정하면 백그라운드 자동 업데이트 확인을 건너뜁니다 |
| `AIPOOL_STATUS_TIMEOUT_MS` | `aipool status`가 서버 응답을 기다리다 포기하기까지의 시간입니다(기본값 `5000`). 연결은 수락되었지만 응답이 없는 경우는, 연결이 거부된 경우("Is the server running?")와 구분해 멈추었거나 과부하 상태인 서버로 보고됩니다 |
| `HTTPS_PROXY` / `ALL_PROXY` | 설정에 `upstreamProxy`가 없을 때 사용하는 아웃바운드 프록시입니다(소문자 형태도 인식합니다) |
| `NO_PROXY` | 설정에 `noProxy`가 없을 때 아웃바운드 프록시를 우회하는 호스트입니다. `aipool run`/`env`가 실행하는 클라이언트에도 상속됩니다 — 클라이언트용 루프백 항목이 사용자가 지정한 값에 추가되며, `*`는 무시됩니다 |

```bash
AIPOOL_CONFIG=./my-config.json aipool server
```

### 이벤트 루프 진단

이벤트 루프가 꽉 막혀 버리는 것은 상태 엔드포인트가 보고할 수 없는 유일한 장애입니다. 엔드포인트 자체가 실행될 수 없기 때문입니다. 그래서 서버는 작은 감시 장치(watchdog)를 둡니다. 1초 타이머가 각 틱이 얼마나 늦게 실행되는지 측정하고, 500ms 넘게 늦은 틱은 정체(stall)로 간주되어 서비스 로그에 한 줄을 기록합니다(최대 30초에 한 번).

```
[AIPool] Event loop stalled: lag=1840ms (threshold=500ms, stalls=3)
```

이 수치는 `GET /aipool/status`와 `aipool status --json`의 `server.eventLoop` 아래에 보고됩니다 — 숫자만 포함되며, 요청 내용은 절대 포함되지 않습니다.

| 필드 | 의미 |
| --- | --- |
| `lastLagMs` | 가장 최근 틱이 얼마나 늦게 실행되었는지 |
| `maxLagMs` | 서버 시작 이후 관측된 최대 지연 |
| `stallCount` | 시작 이후 임계값을 넘은 틱 수 |
| `lastStallAt` | 가장 최근 정체의 ISO 타임스탬프, 또는 `null` |
| `warnLagMs` | 적용 중인 임계값(`500`) |

`aipool status`가 시간 초과되는데(`AIPOOL_STATUS_TIMEOUT_MS` 참고) 로그에 정체가 보인다면, 이는 업스트림 문제가 아니라 자원을 받지 못하거나 차단된 프로세스의 징후입니다 — macOS에서는 LaunchAgent가 `Background` QoS 제한 아래에서 실행되고 있지 않은지 확인하세요.

## 사용량 차원

사용량 차원은 새로운 분류 기준이 생길 때마다 AIPool을 수정하지 않고도, 어떤 프로젝트, 브랜치, 풀 리퀘스트, CI 작업이 토큰을 사용했는지 알려 줍니다. `proxy.clientKeys`는 **누가** 사용했는지를 나타내고, 차원은 **무엇에** 사용했는지를 나타냅니다. 후자는 공유 CI 키 하나만으로는 표현할 수 없습니다.

프록시에서 차원을 한 번 설정합니다.

```json
{
  "proxy": {
    "usageDimensions": [
      { "name": "project", "header": "x-aipool-project" },
      { "name": "ref", "header": "x-aipool-ref" }
    ]
  }
}
```

개발자는 저장소마다 `.claude/settings.json`에 프로젝트 식별자를 설정합니다.

```json
{
  "env": {
    "ANTHROPIC_CUSTOM_HEADERS": "X-Aipool-Project: acme/webapp"
  }
}
```

CI에서는 줄바꿈으로 구분한 사용자 정의 헤더로 여러 차원을 설정할 수 있습니다.

```bash
export ANTHROPIC_CUSTOM_HEADERS=$'X-Aipool-Project: acme/webapp\nX-Aipool-Ref: pull/123'
```

`org/repo`, `pull/123`, 브랜치 이름처럼 안정적이고 카디널리티가 낮은 값을 사용하세요 — 한 차원은 서로 다른 값 500개로 제한되며, 상한을 넘는 값은 모두 `(other)` 행에 합산됩니다. 헤더 값은 클라이언트가 제공하는 것이므로, 수집 시 정제되고 상태 출력에 도달하기 전에 길이가 제한됩니다.

설정된 차원 헤더는 **프록시가 소비하며 업스트림으로 전달되지 않습니다** — 이 헤더는 이 프록시를 위해 트래픽에 레이블을 붙이는 용도이므로, 내부 프로젝트 및 브랜치 이름은 자체 인프라 안에 머뭅니다. 그렇다고 비밀 정보를 넣을 곳은 아닙니다. 값은 상태 파일에 영구 저장되며 프록시 키를 가진 누구나 읽을 수 있습니다.

프록시 자신이나 클라이언트가 이미 사용하고 있어서 프록시가 차원으로 쓰기를 거부하는 헤더 이름은 다음과 같습니다: `authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `x-app`, `x-claude-code-session-id`, `x-claude-code-agent-id`, `x-claude-code-parent-agent-id`, `x-anthropic-additional-protection`.

### 세션별 비용

세션별 토큰 비용은 사용량 차원이 **아닙니다**. 세션 추적기가 이미 각 세션의 응답이 보고한 양을 — 캐시 읽기와 캐시 생성을 포함해 — 주간 버킷별로 계량하고 있으며, 중요한 것은 바로 그 수치입니다. `input_tokens`와 `output_tokens`의 합은 캐시를 사용하는 Claude Code 세션의 비용을 몇 자릿수나 과소평가합니다. 세션별로 이를 표시하려면 `proxy.sessionDetail`을 설정하세요.

## 네트워크 복원력

호스트 네트워크가 끊겼다가 다시 연결되면, Node의 공유 연결 풀에 죽은 keep-alive 소켓이 남아 있을 수 있습니다. 요청에는 기본 시간 제한이 없으므로, 재시도가 죽은 소켓에 걸려 영원히 멈출 수 있습니다 — 모든 계정과 모든 재시도가 같은 오염된 소켓에 계속 걸리므로, 재시작할 때까지 프록시가 멈춘 것처럼 보입니다. AIPool은 각 단계에 제한을 두어 멈춘 요청이 대신 빠르게 실패하도록 합니다. 실패하면 Node가 죽은 소켓을 제거하고, 클라이언트가 재시도하며, 다음 요청은 새로 연결됩니다 — 재시작이 필요 없습니다. 복구는 소켓 단위로 이루어지므로 네트워크가 한 번 흔들린 뒤 완전히 정리되기까지 실패했다가 재시도되는 요청이 몇 개 생길 수 있지만, 결국에는 항상 수렴합니다.

**동시성 하의 연결 풀링.** 업스트림 요청은 풀링된 **HTTP/1.1** 전송(`node:https`)을 사용하므로, 동시 요청마다 각자의 연결을 갖습니다. 반면 Node의 전역 `fetch`는 `api.anthropic.com`으로 가는 모든 요청을 **단일 HTTP/2 연결** 위에서 다중화합니다. 대용량 업로드가 동시에 많이 일어나면(Claude Code는 턴마다 약 1&nbsp;MB의 컨텍스트를 POST합니다) 그 하나의 연결이 HTTP/2의 공유 흐름 제어 창에 막혀 직렬화되고, 사소한 요청조차 헤더를 받기까지 몇 분을 기다릴 수 있습니다. 독립적인 H1 연결에는 이런 경합이 없습니다 — 각 업로드가 자기 소켓을 TCP 속도로 채우므로, Claude Code 프로세스 N개가 직접 연결할 때와 같은 동작이 됩니다.

기본값은 그대로 두는 것을 전제로 합니다. 아래 변수들은 기본값이 맞지 않는 드문 경우를 위한 것입니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `AIPOOL_UPSTREAM_HEADERS_TIMEOUT_MS` | `120000`, Codex 계정은 `300000` | 업스트림 **응답 헤더**를 기다리는 최대 시간(첫 바이트까지의 시간)입니다. 헤더가 도착하는 즉시 해제되므로 긴 스트리밍 본문이 잘리는 일은 없습니다. 스트리밍 완성은 몇 초 안에 첫 바이트를 보내지만, 이보다 오래 정상적으로 생성하는 비스트리밍(`stream:false`) 요청은 이 제한에 걸릴 수 있으므로, 그런 호출자를 위해서는 값을 올리세요. Codex 계정으로 전달되는 요청은 `300000`에서 시작하는데, 모델이 추론하는 동안 ChatGPT 백엔드가 헤드를 보내지 않고 붙잡고 있기 때문입니다([Codex 계정](accounts.md#codex-계정-실험적) 참고). 이 변수를 설정하면 모든 계정에 대해 두 값을 모두 대체합니다 |
| `AIPOOL_UPSTREAM_BODY_TIMEOUT_MS` | `120000` | 응답 본문 청크 사이의 최대 **유휴** 간격입니다. 청크마다 초기화되므로 느리지만 정상적인 스트림은 문제없습니다. 스트림 도중 소켓이 조용해질 때(헤더 수신 이후의 끊김)에만 발동해, 무한 대기를 빠르고 재시도 가능한 실패로 바꿉니다 |
| `AIPOOL_UPSTREAM_MAX_SOCKETS` | `256` | 풀링 경로에서 **오리진별** 최대 동시 업스트림 연결 수이자, 그 앞에 있는 승인(admission) 관문의 폭입니다. 긴 스트림은 본문이 끝날 때까지 슬롯을 점유하며, 이 수를 넘는 요청은 아래의 제한된 큐에서 기다립니다(한 호스트에 대해 이보다 많은 동시 세션을 실행한다면 값을 올리세요) |
| `AIPOOL_UPSTREAM_MAX_QUEUE` | `64` | `MAX_SOCKETS`가 모두 사용 중일 때 **오리진별로** 빈 슬롯을 기다릴 수 있는 요청 수입니다. 큐가 가득 찬 상태에서 도착한 요청은 즉시 거부됩니다(`0`이면 큐잉을 끕니다) |
| `AIPOOL_UPSTREAM_QUEUE_TIMEOUT_MS` | `5000` | 큐에 들어간 요청이 거부되기 전까지 슬롯을 기다리는 최대 시간입니다. 요청이 승인된 뒤에야 작동하는 헤더 시간 제한과는 별개입니다 |
| `AIPOOL_UPSTREAM_GLOBAL_FETCH` | _(꺼짐)_ | `1`로 설정하면 업스트림 요청을 풀링된 H1 전송 대신 Node의 전역 `fetch`(단일 HTTP/2 연결)로 라우팅합니다 — 비상 탈출구일 뿐이며, 동시성이 높은 환경에서는 권장하지 않습니다 |
| `AIPOOL_REFRESH_TIMEOUT_MS` | `30000` | OAuth 토큰 갱신을 기다리는 최대 시간입니다. 멈춘 갱신은 모든 호출자에 걸쳐 하나로 합쳐지므로, 제한이 없으면 해당 계정의 모든 요청이 멈춰 버립니다 |
| `AIPOOL_RATE_LIMIT_ABSORB_MAX_SECONDS` | `60` | 레이트 리밋 429를 클라이언트에 드러내기 전에, 같은 계정에서 그 자리에서 기다려 흡수하는 `retry-after`의 최대 길이입니다 — [두 종류의 429](routing.md#두-종류의-429)를 참고하세요 |
| `AIPOOL_HEADERLESS_429_RETRY_DELAY_MS` | `2000` | **헤더 없는**(요청 범위) 429 — `retry-after`도 `anthropic-ratelimit-*` 헤더도 없는 429 — 를 한 번 재시도하기 전에 기다리는 시간입니다. 모든 프로바이더에 대해 요청당 한 번 재시도하며, 페일오버로 다른 계정으로 넘어간 뒤에는 넘어간 그 계정에서 재시도합니다. 재시도도 거부되면 429는 조금 늦게 클라이언트에 전달될 뿐입니다. 일시적인 오류를 흡수하기보다 429를 더 빨리 받고 싶다면 값을 낮추고, 재시도를 완전히 끄려면 `0`으로 설정하세요. 그러면 헤더 없는 429는 페일오버 시도(있는 경우)마저 거부되는 즉시 클라이언트로 돌아갑니다. 설정하지 않았거나 비어 있거나 해석할 수 없는 값이면 기본값을 사용합니다 — [두 종류의 429](routing.md#두-종류의-429)를 참고하세요 |

**업스트림 승인.** Node의 연결 풀은 `MAX_SOCKETS`를 넘는 요청을 내부적으로, 제한도 기한도 없이 큐에 쌓습니다 — 이미 떠난 클라이언트의 요청(과 버퍼된 본문)도 앞에 있는 장시간 스트림이 끝날 때까지 그곳에 묶여 있었습니다. 이제 요청은 업스트림 연결이 만들어지기 *전에* 오리진별로 승인됩니다. 큐 길이는 `AIPOOL_UPSTREAM_MAX_QUEUE`로, 대기 시간은 `AIPOOL_UPSTREAM_QUEUE_TIMEOUT_MS`로 제한되며, 큐에서 기다리는 동안 연결을 끊은 클라이언트는 즉시 큐에서 빠집니다. 관문이 거부한 요청은 **`Retry-After: 1`이 붙은 `503` 응답**과 `overloaded_error` 본문을 받습니다. 이는 계정이 아니라 프록시가 포화 상태라는 뜻입니다. 따라서 다른 계정에서 재시도하지 않으며(모든 계정이 같은 오리진 관문을 공유하므로 다시 시도해 봐야 부하만 늘어납니다), 이 때문에 계정이 일시 중지되거나 배제되지도 않고, 활동 로그에서 해당 행은 계정이 아니라 `(upstream queue full)`로 표시됩니다. `GET /aipool/status`는 이 관문을 `upstreamPool` 아래에 `active`, `queued`, `origins`, `perOriginLimit`, `maxQueue`, `queueTimeoutMs`로 보고하며, 카운터만 포함합니다.

`AIPOOL_UPSTREAM_MAX_SOCKETS`를 **낮췄다면** 동작이 바뀐 점에 유의하세요. 예전에는 한도를 넘는 요청이 Node의 풀 안에서 무기한 대기했지만, 이제는 최대 `AIPOOL_UPSTREAM_QUEUE_TIMEOUT_MS`(5초) 동안만 기다린 뒤 위의 503으로 실패합니다. 긴 스트리밍 완성은 전체 기간 동안 슬롯을 점유하므로, 풀이 작은데 동시 세션이 많으면 이 503을 보게 됩니다. 동시성에 맞게 풀 폭(또는 큐와 그 기한)을 올리세요. 전역 `fetch` 비상 탈출구(`AIPOOL_UPSTREAM_GLOBAL_FETCH=1`)에는 풀이 없으므로 관문도 적용되지 않습니다.

요청 도중 연결을 끊은 클라이언트도 더 이상 업스트림 작업을 살려 두지 않습니다. 업스트림 요청은 (큐에 있든 진행 중이든) 취소되고, 쿼터 대기나 레이트 리밋 대기는 즉시 끝나며, 조용한 SSE 스트림은 본문 유휴 감시 장치를 기다리지 않고 취소됩니다. 이런 요청의 활동 행은 `499`로 닫힙니다.
