# 사용법

서버를 실행하는 방법, 서버를 거쳐 Claude Code를 실행하는 방법, 그리고 전체 명령어 레퍼런스를 다룹니다.

## 프록시 서버 시작

```bash
aipool server
```

TTY에서 실행하면 대화형 TUI가 표시됩니다. 세션/주간 쿼터 막대와 리셋 카운트다운이 담긴 계정 테이블, 실시간 활동 로그, 키보드 조작으로 구성됩니다.

두 프로바이더(Claude와 Codex)의 계정이 함께 있고 터미널 폭이 127열 이상이면, 계정 테이블은 프로바이더마다 하나씩 두 개의 패널로 나란히 그려지며 각 패널의 제목은 해당 프로바이더 이름입니다. 프로바이더별 풀은 각자의 커서를 유지하므로, 패널마다 현재 계정을 가리키는 `►` 표시가 따로 붙습니다. 패널 배치는 두 패널 모두 각 행의 쿼터 막대를 빠짐없이 그릴 수 있을 때만 사용하므로, 모델별 막대나 라우트 열, 차단된 모델 계열 태그가 있는 계정 풀에는 127열보다 조금 더 넓은 터미널이 필요합니다. 그보다 좁은 터미널에서는 단일 목록을 유지하고 타입 열에 프로바이더 이름을 표시합니다(이때도 `►`는 프로바이더마다 하나씩입니다). 목록의 Codex 계정이 모두 5시간 창 없이 보고된 경우에는 `Ses` 막대 열을 빼고 주간 막대만 그립니다.

stdout이 TTY가 아니면(예: 서비스로 실행할 때) 일반 로그 출력으로 대체됩니다. 터미널에서도 일반 로그 모드를 강제하려면 `--headless`(또는 `--no-tui`)를 넘기면 됩니다. 프록시를 백그라운드로 돌릴 때 유용합니다.

### 컨테이너에서 실행

체크아웃한 소스에서 `docker build -t aipool .` 명령으로 이미지를 빌드합니다. 이 이미지는 컨테이너 안에서 `0.0.0.0`에 바인딩된 `server --headless`를 실행하므로, 포트를 게시하고 설정 파일을 바인드 마운트해야 합니다:

```bash
docker run -d --name aipool -p 3456:3456 \
  -v ~/.config/aipool.json:/data/aipool.json \
  aipool

docker exec -it aipool aipool login --token   # 컨테이너 안에서 계정 추가
docker exec -it aipool aipool status
```

엔트리포인트는 실행 사용자를 마운트된 설정 파일의 소유자(파일이 아직 없으면 `/data`의 소유자)에 맞추는 동안만 root로 동작한 뒤 권한을 내려놓습니다. 따라서 여러분의 사용자가 소유한 파일은 `chown` 없이도 계속 쓸 수 있습니다. 감지된 소유자는 `AIPOOL_UID`(필요하면 `AIPOOL_GID`도 함께)로 재정의할 수 있습니다. stderr는 stdout으로 합쳐지므로 `docker logs`에는 하나의 스트림만 보입니다. 둘을 분리하려면 `AIPOOL_SPLIT_STDERR=1`을 설정합니다. 업그레이드하려면 이미지를 다시 빌드합니다.

설정 파일은 처음 시작할 때 무작위 `proxy.apiKey`와 함께 생성됩니다. 컨테이너 바깥에서 프록시에 접근하는 것은 모두 비루프백 클라이언트이므로 이 키를 제시해야 합니다([proxy.host](configuration.md#필드) 참고). 예외는 `docker exec`로 실행한 `aipool` 명령뿐입니다.

### 활동 로그의 세션 제목

Claude Code는 요청마다 `x-claude-code-session-id`를 보내므로, 활동 로그의 모든 행은 어느 세션에 속하는지 알 수 있습니다. `sessionTitles.enabled`를 설정하면 각 행에 해당 세션의 이름이 붙습니다:

```
 ⠋ 17:42:57  api-refactor       POST /v1/messages (claude-opus-5) → work@example.com (1.9s...)
 ⠋ 17:42:57  fix-login-bug      POST /v1/messages (claude-opus-5) → work@example.com (0.4s...)
 ⠋ 17:42:57                     POST /v1/messages?beta=true (claude-opus-5) → work@example.com (1.1s...)
```

이름은 `~/.claude/projects` 아래에 있는 Claude Code 자체 파일에서 다음 순서로 가져옵니다:

1. `/rename`이 기록하는 `<session-id>/custom-title.json`.
2. 세션 트랜스크립트 안의 `custom-title` 레코드. 이 파일이 생기기 전에 이름을 바꾼 세션에는 이것이 유일한 사본입니다.
3. `ai-title` 레코드. Claude Code가 생성하는 제목으로, 이름을 바꾸지 않은 세션도 대부분 이 레코드를 갖고 있습니다.

이 중 아무것도 없는 세션은 ID의 앞 16진수 여섯 자리를 그대로 표시합니다. 세션 헤더가 없는 요청도 마찬가지입니다. SDK나 API 클라이언트를 그대로 쓰면 익명으로 프록시에 도달하며, 이름을 알려 줄 파일도 없습니다.

각 레이블은 렌더링 경로와 분리된 곳에서 한 번 읽히고, 많아야 30초에 한 번 다시 읽힙니다. 그래서 `/rename`은 재시작 없이 로그에 반영되고, 어떤 프레임도 디스크를 기다리지 않습니다. 세션 ID와 제목은 둘 다 프록시 외부에서 들어오는 값이므로, UUID 형태의 세션 ID만 조회하고 제목은 제어 문자를 제거한 뒤 출력합니다.

이 기능은 기본적으로 꺼져 있습니다. 보이는 모든 세션의 트랜스크립트 끝부분을 읽는데, 이는 요청받지 않는 한 프록시가 다른 어떤 일로도 접근하지 않는 범위이기 때문입니다. 프록시 실행 중에 **g** → **Session titles**를 누르면 레이블을 켜고 끌 수 있습니다. 레이블에 할당되는 열 수를 바꾸려면 `sessionTitles.width`를 설정합니다. 자세한 내용은 [설정](configuration.md)을 참고하세요.

헤드리스 모드에서는 로컬 제어 엔드포인트에 POST 요청을 보내 재시작 없이 설정의 계정을 다시 동기화할 수 있습니다(TUI에서 **R**을 누르는 것과 같습니다):

```bash
curl -X POST http://localhost:3456/aipool/reload
```

보통은 직접 호출할 필요가 없습니다. `login`, `import`, `enable`, `disable`, `priority`, `route`, `threshold`, `distribute`, `probe`, `warmup`은 실행 중인 서버에 스스로 알립니다.

제어 평면의 **쓰기** 요청(`reload`, `switch`)은 브라우저의 `Origin` 헤더나 크로스 사이트 `Sec-Fetch-Site` 헤더가 있으면 거부됩니다. 루프백은 프록시 API 키 검사에서 면제되므로 CLI에는 별도 설정이 필요 없지만, 이 면제는 우연히 방문한 웹 페이지에도 똑같이 적용됩니다. 웹 페이지는 프리플라이트 없이 `127.0.0.1`로 크로스 오리진 POST를 보낼 수 있고, 응답을 읽지는 못해도 쓰기 자체는 반영됩니다. `curl`과 CLI는 두 헤더 모두 보내지 않으므로 영향이 없습니다. 읽기(`status`)는 제한하지 않습니다. 동일 출처 정책이 이미 페이지가 응답을 보지 못하도록 막기 때문입니다.

`GET /aipool/quota`는 상태 표시줄 연동을 위한 간결한 읽기 엔드포인트입니다. 티어 가중치를 적용한 계정 풀 집계값과 그 바탕이 되는 계정별 한도를 반환합니다. 자세한 내용은 [계정 풀 쿼터 엔드포인트](quota.md#계정-풀-쿼터-엔드포인트)를 참고하세요.

계정을 수동으로 전환하는 데도 같은 헤드리스 경로가 있습니다. TUI에서 **s**를 누르고 기본 대상이 선택된 상태로 확인하는 것과 같습니다:

```bash
aipool switch                 # 계정 목록 표시(현재 계정 표시 포함)
aipool switch me@example.com  # 해당 계정을 우선 계정으로 지정
```

두 형식 모두 실행 중인 서버가 필요합니다. 이 선택은 런타임 상태일 뿐 설정에 기록되지 않으므로, 나중에 재시작할 때 적용할 것이 없습니다. 이 명령은 `{"account": "<name>"}` 본문으로 `POST /aipool/switch`를 호출하는 래퍼이며, 계정은 표시 이름, 이메일 주소, `accountUuid`, `orgUuid`, 또는 완전한 형식인 `accountUuid/orgUuid`로 지정할 수 있습니다. 하나의 이메일이 여러 조직에 계정을 가지고 있을 때 이를 구분할 수 있는 형식은 마지막 것뿐입니다. 로테이션 인덱스는 의도적으로 받지 않습니다. 인덱스는 배열 위치이므로, `1`로 고정한 스크립트는 계정이 제거된 뒤 아무 경고 없이 다른 계정을 가리키게 됩니다.

TUI와 마찬가지로 이 선택은 잠금이 아니라 약한 선호이며, 선택이 해제되는 두 가지 경우를 알아 두는 것이 좋습니다. 로테이션은 해당 계정을 사용할 수 없게 되면(비활성화, 쿼터 소진, 스로틀링) 이 선택을 버리고, 현재 계정보다 `priority` 값이 낮은(같은 값은 제외) 계정이 하나라도 사용 가능할 때도 버립니다. 우선순위가 더 높은 계정은 정상 상태인 현재 계정보다 앞서기 때문입니다. 트래픽을 전혀 받을 수 없는 계정으로 전환해도 TUI에서와 똑같이 기록은 되지만, 명령은 깔끔한 성공을 보고하는 대신 그 사실을 알려 줍니다:

```text
Switched to "me@example.com"
Warning: "me@example.com" is disabled, so requests will not route to it until that changes.
```

### TUI 키보드 단축키

| 키 | 동작 |
| --- | --- |
| `s` | 활성 계정 전환(`←`/`→`로 기본 계정 또는 특정 [라우트](routing.md#모델-라우트) 선택) |
| `d` | 계정 활성화/비활성화 |
| `p` | 모든 계정의 쿼터 새로 고침(쿼터를 쓰지 않는 사용량 엔드포인트를 한 번 프로브) |
| `R` | 설정에서 계정 다시 불러오기 |
| `g` | 설정(임계값, 쿼터 프로브, 라우팅, 계정 추가/제거/순서 변경, sx.org) |
| `q` | 종료 |

선택 모드에서는 `j`/`k` 또는 화살표 키로 이동하고, `Enter`로 확인하며, `Esc`로 취소합니다.

설정 화면은 문자 단축키 모음이 아니라 목록입니다. `↑`/`↓`로 행 사이를 이동하고, `←`/`→`로 그 자리에서 값을 바꿉니다(임계값은 1%씩, 프로브는 30초씩 바뀌고, 모드는 순환합니다). `Enter`는 입력이 필요한 행이나 하위 화면을 열고, `Esc`는 이전 화면으로 돌아갑니다.

**Reorder accounts**는 같은 두 쌍의 키를 그대로 쓰되 한 가지 역할을 더 맡긴 계정 목록을 엽니다. `↑`/`↓`로 계정을 고르고, `←`/`→`로 *그 계정*을 목록에서 위아래로 옮기며, `Enter`나 `Esc`로 돌아갑니다. 모든 이동은 즉시 적용되고 키 입력이 멈춘 직후(또는 화면을 떠날 때) 저장되므로, 따로 확인하거나 취소할 것이 없습니다. 계정은 같은 프로바이더의 계정들 사이에서만 움직입니다. Claude와 Codex가 섞인 계정 풀은 프로바이더별로 묶여 그려지므로, 다른 그룹으로 넘어가는 이동은 아무 효과가 없습니다. 이 순서는 목록이 **그려지는** 순서일 뿐 그 이상의 의미는 없습니다. 로테이션 순서는 [`priority`](routing.md#계정-선택)가 정하며, 이 화면은 그 값을 전혀 건드리지 않습니다. `aipool attach`도 같은 순서로 그립니다. `/aipool/status`의 각 계정에는 `displayOrder`가 들어 있습니다(배치되기 전까지는 `null`).

## 프록시를 거쳐 Claude Code 실행

```bash
aipool run
```

`run`은 먼저 프록시를 프로브합니다. 프록시가 떠 있으면 Claude Code를 프록시로 라우팅하고, 실행 중이 **아니면** `run`은 조용히 프록시를 우회하는 대신 오류를 내고 종료합니다. 우회하면 로테이션 없이 본인 쿼터를 소모하게 되기 때문입니다. 프록시가 내려가 있을 때 대신 `claude`를 직접 실행하게 하려면 `--auto-fallback`을 넘깁니다:

```bash
aipool run --auto-fallback
```

**1.1.0**부터 `run`은 기본적으로 [MITM 포워드 프록시 모드](proxy-modes.md#mitm-프록시-모드기본값)를 사용하므로, 하드코딩된 `api.anthropic.com` 엔드포인트까지 가로챕니다. 이전처럼 base URL만 쓰는 동작을 원하면 `--no-mitm`을 넘깁니다. 또는 설정에서 `defaultClientMode: "base-url"`을 지정하면(TUI 설정 화면의 **Client mode** 행) `run`과 `env` 모두 이 동작이 기본값이 되고, 실행할 때마다 `--mitm`으로 다시 MITM을 선택할 수 있습니다:

```bash
aipool run --no-mitm
```

`--` 뒤의 인수는 `claude`로 전달됩니다:

```bash
aipool run -- --model opus
```

`run`은 기본으로 `claude`에 `--dangerously-skip-permissions`를 붙여서, 프록시를 거쳐 띄운 세션은 권한 확인 없이 실행됩니다. 인수에 `--dangerously-skip-permissions`나 `--permission-mode`가 이미 있으면 붙이지 않으므로, 한 번만 일반 모드로 띄우려면 `aipool run -- --permission-mode manual`처럼 실행합니다. 항상 끄려면 설정에 `"skipPermissions": false`를 넣으세요([설정](configuration.md#필드)). root로 실행할 때는 Claude Code가 이 플래그를 거부하고 종료하므로 붙이지 않습니다(`IS_SANDBOX=1`이면 붙입니다).

### 환경 변수를 직접 설정하기

`aipool env`는 `run`이 사용하는 것과 같은 export 줄을 출력합니다:

```bash
eval "$(aipool env)"           # MITM: HTTPS_PROXY + NODE_EXTRA_CA_CERTS
eval "$(aipool env --no-mitm)" # base-URL: ANTHROPIC_BASE_URL만
eval "$(aipool env --mitm)"    # defaultClientMode와 관계없이 MITM
claude
```

stdout에는 export 줄만 출력되므로 `eval`해도 안전합니다. 짧은 요약과 힌트는 stderr로 나갑니다. `ANTHROPIC_API_KEY`는 출력하지 않습니다. 루프백 클라이언트는 프록시 키 검사에서 면제되며, 이 변수를 설정하면 Claude Code가 구독 모드에서 벗어나기 때문입니다. 원격(비루프백) 클라이언트는 프록시 키를 직접 추가해야 합니다.

**프록시 변수는 셸 전체에 적용됩니다.** MITM 모드에서 eval은 `HTTPS_PROXY` 등의 변수를 export하므로, 그 셸의 다른 모든 도구(`gh`, `git`, 패키지 매니저 등)도 이 변수를 따라 프로바이더 호스트하고만 통신하는 리스너로 연결됩니다. 샌드박스 셸에서는 이것이 관계없는 명령에서 인위적인 403으로 나타날 수 있습니다. 이런 셸을 쓴다면 `defaultClientMode: "base-url"`을 설정하세요(TUI 설정 화면의 **Client mode** 행). 그러면 `env`는 `ANTHROPIC_BASE_URL`만 출력하고, 다시 eval하면 이전 MITM eval이 이 프록시를 가리키도록 남겨 둔 프록시 변수를 해제합니다. 실제 사내 프록시 설정은 건드리지 않습니다. `aipool run`은 어느 모드에서든 변수를 `claude` 프로세스 안으로만 한정합니다.

**기존 `NO_PROXY` 값은 유지됩니다.** `run`과 `env`는 둘 다 `NO_PROXY=localhost,127.0.0.1,::1`을 설정하고, 실행한 셸에 이미 있던 값을 뒤에 덧붙입니다. 이는 로컬 개발에서 중요합니다. `app.test` 같은 이름의 개발 서버는 로컬 리졸버를 통해 127.0.0.1로 해석되는데, 루프백으로의 포워딩은 거부되므로 그 요청을 프록시로 보낸 클라이언트는 재시도할 때마다 403을 받게 됩니다. eval 전(또는 `run` 전)에 `export NO_PROXY=.test`를 실행하면, 실행된 클라이언트는 `localhost,127.0.0.1,::1,.test`를 받습니다. 제외되는 항목은 `*` 하나뿐입니다. 이 항목은 `api.anthropic.com`까지 프록시를 우회하게 만들어 로테이션을 소리 없이 끝내 버리기 때문입니다. 직접 실행하려면 `--no-mitm`을 사용하세요.

**에이전트 멀티플렉서나 `claude`를 스스로 띄우는 도구를 사용한다면?** 그 `claude` 인스턴스들을 실행하는 프로세스에서 이 환경을 export하세요. 예를 들어 멀티플렉서를 시작하는 셸에서 `eval "$(aipool env)"`를 실행합니다. 그러면 `aipool run`을 거치지 않아도, 실행되는 모든 `claude`가 같은 라우팅(그리고 하드코딩된 엔드포인트에 대한 MITM 가로채기)을 적용받습니다. 단점은 `run`의 프록시 가동 여부 확인이 `run`으로 실행할 때만 적용된다는 것입니다. 따라서 멀티플렉서보다 서버를 먼저 시작하세요.

### 일반 `claude`를 자동으로 라우팅하기

매번 `aipool run`을 입력하지 않아도 되도록, 일반 `claude` 명령을 프록시로 보내는 셸 별칭을 추가합니다:

```bash
aipool alias              # 사용 중인 셸용 별칭 출력
aipool alias --install    # 또는 셸 rc 파일에 기록(제거는 --uninstall)
```

이것은 대화형 셸 별칭이므로 프롬프트에 입력한 `claude`에만 적용되고, 에디터나 스크립트가 실행하는 `claude`에는 적용되지 않습니다. 별칭은 `aipool run`을 그대로 호출하는 얇은 래퍼이며, 프록시 가동 여부 확인 로직은 그쪽에 있습니다(따라서 프록시가 내려가 있으면 오류가 납니다. 대신 claude를 직접 실행하려면 `--auto-fallback`을 추가합니다).

## Claude와 Codex 세션 사이의 메시지

`aipool peer`는 같은 컴퓨터에서 열려 있는 Claude Code 세션과 Codex 세션이 서로 메시지를 주고받게 합니다. 터미널에 글자를 입력하는 방식이 아니라, 받는 쪽 세션의 다음 입력으로 바로 들어갑니다. 프록시 서버가 꺼져 있어도 동작합니다.

```bash
aipool peer install                         # 한 번만: Claude 세션을 깨우는 훅과 에이전트용 안내 설치
aipool peer list                            # 열려 있는 Claude 세션과 Codex 세션
aipool peer send <세션> "메시지"             # 보내기 (- 를 주면 stdin에서 읽음)
aipool peer send --wait <Codex 세션> "질문"  # Codex의 답이 올 때까지 기다렸다가 출력
aipool peer read                            # 이 Claude 세션에 온 메시지 읽기 (wait는 올 때까지 대기)
aipool peer name <스레드 id> <이름>          # Codex 세션에 이름 붙이기
aipool peer uninstall                       # 훅과 안내 제거
```

받는 쪽에 따라 전달 방식이 다릅니다.

- **Codex 세션으로:** `codex queue`로 넣습니다. 열려 있는 Codex 창에 일반 대화처럼 보이고, 진행 중인 턴이 있으면 끝난 뒤에 처리됩니다. Codex 공유 데몬이 켜져 있어야 합니다(`codex app-server daemon start`). 아직 한 번도 입력하지 않은 새 Codex 창도 스레드 id로 보낼 수 있습니다.
- **Claude 세션으로:** Claude Code에는 밖에서 메시지를 넣는 입구가 없어서, 그 세션의 우편함(`~/.config/aipool-peer/inbox/`)에 넣습니다. `aipool peer install`이 `~/.claude/settings.json`에 넣는 asyncRewake 훅(SessionStart, Stop)이 우편함을 1초마다 확인하다가, 메시지가 오면 쉬고 있던 세션도 깨워 그 메시지를 전달합니다. 훅은 Claude 세션이 시작될 때와 턴이 끝날 때마다 다시 걸리며, 세션마다 하나만 돕니다. 훅이 없으면 받는 쪽이 `aipool peer read`로 읽어야 합니다.

세션은 `aipool peer list`에 나오는 이름이나 id로 지정합니다. Claude 세션은 이름(`aipool-95` 같은), 세션 id, pid로, Codex 세션은 스레드 id나 이름으로 지정할 수 있습니다. 보내는 쪽이 누구인지는 자동으로 알아냅니다. Codex는 실행하는 명령에 `CODEX_THREAD_ID`를 넘겨 주고, Claude 세션은 셸의 상위 프로세스로 찾습니다. 어느 쪽도 아니면 `--from <이름>`이나 `AIPOOL_PEER_NAME`으로 지정합니다.

받는 쪽에는 `[peer from 보낸 세션]`으로 시작하는 메시지와 답장 명령이 함께 전달됩니다. 답장 명령은 보낸 세션의 id를 쓰므로, 세션 이름이 바뀌거나 이름에 공백이 있어도 그대로 동작합니다. `install`은 `~/.claude/CLAUDE.md`와 `~/.codex/AGENTS.md`에도 사용법 안내를 넣어서, 두 도구의 에이전트가 이 명령을 알고 쓰도록 합니다. 안내는 표시된 블록 안에만 쓰고, `uninstall`이 그 블록만 지웁니다.

훅은 `install`을 실행한 뒤 새로 연 Claude 세션부터 적용됩니다. 이미 열려 있던 세션에 적용하려면 세션을 다시 여세요.

## 명령어 레퍼런스

```bash
aipool login             # OAuth로 계정 추가(API 키는 --api)
aipool import            # Claude Code에서 자격 증명 가져오기
aipool server            # 프록시 시작(일반 로그는 --headless)
aipool run               # 프록시를 거쳐 Claude Code 실행
aipool env               # claude를 직접 라우팅하기 위한 export 줄 출력
aipool alias             # 프록시로 라우팅하는 `claude` 별칭 출력/설치
aipool accounts          # 구독 티어와 토큰 상태를 포함한 계정 목록
aipool status            # 실시간 프록시 상태를 계정당 한 행으로 표시(실행 중인 서버 필요)
aipool status -v         # ...계정별 전체 상세 내역 포함
aipool attach            # 실행 중인 서버에 연결해 라이브 대시보드 열기
aipool dashboard         # 브라우저에서 웹 대시보드 열기(서버 필요)
aipool service install   # 프록시를 로그인 서비스로 실행(uninstall/restart/status/print)
aipool restart           # 서비스 재시작(aipool service restart와 동일)
aipool switch [name]     # 계정을 우선 지정, 이름을 생략하면 목록 표시(서버 필요)
aipool remove <name>     # 계정 제거(이름 또는 이메일로 지정)
aipool disable <name>    # 계정을 로테이션에서 일시적으로 제외
aipool enable <name>     # 다시 활성화(멈춰 있는 오류 상태도 해제)
aipool priority <name> 1 # 로테이션 우선순위 설정(낮을수록 우선)
aipool route list        # 모델별 라우트 관리(add/rm)
aipool threshold 90      # 다음 계정으로 전환되는 사용률 임계값
aipool distribute on     # 새 세션을 우선순위가 같은 계정들에 분산
aipool expiry on         # 쓰지 않으면 만료될 주간 쿼터부터 먼저 사용
aipool probe 300         # 백그라운드 쿼터 갱신 활성화(기본값은 꺼짐)
aipool warmup 600        # keep-warm 활성화(기본값은 꺼짐, 쿼터 소모)
aipool warmup reset 15:30 --timezone Europe/Moscow
                             # 매일 목표 리셋 시각에 맞춰 워밍업 예약
aipool warmup rolling 15:30 --timezone Europe/Moscow
                             # 리셋 기준을 15:30에 맞추고 이후 5시간마다 이어감
aipool peer send <세션> "..."  # Claude·Codex 세션 사이 메시지(list/read/wait/install)
aipool api <path>        # 계정 자격 증명으로 API 엔드포인트 호출
aipool update            # 현재 버전 표시 (git 체크아웃은 git pull로 갱신)
aipool version           # 설치된 버전 출력
aipool help              # 전체 명령어 표시
```

`aipool status`는 계정 풀 상태를 사람이 읽기 좋은 텍스트로 한 번 출력합니다. 헤더는 작업을 계속할 수 있는지를 알려 줍니다. 지금 사용 가능한 계정 수(하나도 없으면 첫 계정이 언제 돌아오는지)와 활성 세션 수를 보여 주고, **Fleet weekly** 막대는 활성화된 계정들의 주간 창이 평균적으로 얼마나 찼는지 나타냅니다. 그 아래에는 계정별 카드가 가장 유용한 순서(사용 중, 준비됨, 소진됨(가장 빨리 돌아오는 계정부터), 고장, 비활성화)로 나옵니다. 각 카드에는 점과 **상태**(`in use · N active`, `ready`, `limit reached · back in 2d4h`, `rate limited · back in 3m`, `error`, `disabled`)가 표시되고, 이어서 쿼터 창마다 막대가 하나씩 사용률 및 리셋 시점과 함께 표시됩니다. 백분율은 여유가 있으면 녹색, 70%부터는 노란색, 계정의 전환 임계값(또는 막대에 표시되는 `maxUsage` 상한)에 도달하면 빨간색입니다. **Needs attention**은 주의가 필요한 항목이 있을 때만 나타납니다. 고장 난 계정, 초과 사용 과금, 갱신이 멈춘 쿼터 수치, 차단된 모델 등이 이에 해당합니다. 로테이션 설정(전환 임계값, 분산 모드)과 TUI가 보여 주는 계정별 상세 내역(모델별 사용 가능 여부, 사용량, 프로브 및 적응형 분산 상세, 클라이언트별 사용량)은 `aipool status -v`에서 볼 수 있습니다. SSH나 스크립트에서 쓰기 편리하며, 기계가 읽을 수 있는 출력이 필요하면 `--json`을 사용합니다. JSON의 `server.version`은 응답하는 프로세스의 버전으로, 시작할 때 한 번만 읽습니다. 따라서 `aipool update` 직후에는 재시작하기 전까지 여전히 이전 코드의 버전이 표시되지만, 설치된 CLI의 `aipool version`은 이미 새 버전을 표시합니다.

`aipool attach`는 이미 실행 중인 서버에 연결해 터미널 대시보드 자체를 엽니다. 프록시가 백그라운드 서비스로 실행될 때 대화형 조작을 되찾는 방법입니다. 같은 상태 엔드포인트를 1초마다 폴링하며, 원격 제어가 제공하는 두 가지 작업을 할 수 있습니다. `s`는 계정을 전환하고, `R`은 설정을 다시 불러옵니다. 브라우저 대시보드에는 이에 대응하는 **Reload config** 동작과 쿼터를 쓰지 않는 **Probe quotas** 동작이 추가로 있습니다. 설정 편집과 요청 활동 스트림은 서버 프로세스만 가진 상태가 필요하므로 여전히 서버 자체의 TUI에만 있습니다. 서버와의 연결이 끊기면 헤더 표시가 `▲`에서 `▼`로 바뀌며, 화면에 보이는 내용은 현재 상태가 아니라 마지막 스냅샷입니다.

`aipool service install`은 로그인할 때 시작되고 스스로 재시작하는 사용자 서비스로 프록시를 등록합니다. macOS에서는 LaunchAgent, Linux에서는 `systemd --user` 유닛입니다(`uninstall`, `restart`, `status`, `print`도 함께 제공되며, `print`는 아무것도 변경하지 않고 유닛을 stdout에 출력합니다). macOS에서 LaunchAgent는 `ProcessType` `Standard`로 실행됩니다. 이전에 쓰던 `Background` 클래스에는 QoS 제한이 걸려 있어, 호스트에 부하가 몰리면 프록시가 자원을 얻지 못했습니다(상태 조회 타임아웃, 수 초에 달하는 이벤트 루프 지연). 유닛은 설치할 때만 기록되므로, 기존 설치는 `aipool service install`을 다시 실행하기 전까지 설치 당시의 내용을 유지합니다. `aipool restart`(또는 `service restart`)는 유닛을 다시 쓰지 않고 서비스를 재시작한 뒤 프록시가 다시 응답할 때까지 기다립니다. `aipool update`나 그 밖에 리로드로는 적용되지 않는 변경 사항을 반영하는 방법입니다. 이때 처리 중이던 요청은 중단됩니다.

```
$ aipool status
AIPool · ● 2 of 2 accounts available
Fleet weekly [███████████████████████░░░░░░░] 75% used · average of 2 enabled accounts

○ work@example.com  ready
    5h      [█████████████░░░░░░░░░░░░░░░░░]  42%  resets in 30m
    Weekly  [█████████████████████████░░░░░]  83%  resets in 2d

○ side@example.com  ready
    5h      [████░░░░░░░░░░░░░░░░░░░░░░░░░░]  12%  resets in 20m
    Weekly  [████████████████████░░░░░░░░░░]  67%  resets in 4d

More detail: aipool status -v
```

## 상태 대시보드(브라우저)

`GET /aipool/dashboard`는 `aipool status`와 같은 데이터를 보여 주는 독립형 HTML 페이지를 제공합니다. 계정별 쿼터 막대(세션과 주간, 그리고 업스트림이 보고하는 모델별 주간 버킷마다 막대 하나씩), 로테이션 상태, 활성 세션이 표시되며 몇 초마다 갱신됩니다.

`aipool dashboard`는 실행 중인 서버를 대상으로 이 페이지를 시스템 브라우저에서 엽니다(서버를 시작하지는 않으므로, 서버는 `aipool server`나 `aipool service install`로 띄웁니다). 페이지의 **Reload config**와 **Probe quotas** 버튼은 메시지 쿼터를 쓰지 않고 TUI의 해당 동작과 같은 일을 합니다.

`proxy.usageDimensions`를 설정하면 차원마다 정렬 가능한 테이블이 따로 생깁니다. `proxy.sessionDetail`을 켜면 대화별 테이블이 나타나, 각 대화의 세션, 클라이언트, 프로젝트, 처리한 계정, 그리고 주간 버킷별 실제 사용량(캐시 읽기와 캐시 생성 포함)을 보여 주며, 프로젝트나 클라이언트로 필터링할 수 있습니다. 서브에이전트로 분기하는 클라이언트 세션은 에이전트마다 한 행씩 표시됩니다. 이 행들은 같은 **Session** 값을 가지며, 각 대화의 짧은 다이제스트인 **Conv**로 구분됩니다([세션 인식 라우팅](routing.md#세션-인식-라우팅) 참고). 이 테이블은 기본적으로 꺼져 있습니다. [설정](configuration.md#사용량-차원)을 참고하세요.

페이지 상단에는 **경고 배너**가 있으며, 문제가 없으면 비어 있습니다. 배너는 클라이언트 요청이 여러 번 연속으로 쓸 만한 결과 없이 돌아온 대화를 알려 줍니다. 이런 경우는 유휴 상태의 대화와 똑같이 토큰 0으로 보이기 때문에 배너가 없으면 알아챌 수 없습니다. 또한 사람이 손봐야 하는 계정(손상된 토큰이나 비활성화된 항목)도 알려 줍니다. **한** 계정의 쿼터 버킷 소진, 레이트 리밋 백오프, 업스트림 거부는 보고하지 **않습니다**. 이런 상황은 저절로 해소되며, 항상 켜져 있는 배너는 아무도 읽지 않기 때문입니다. *모든* 계정이 임계값을 넘었거나 보류 상태이면 대화가 실제로 처리되지 못하기 시작하는데, 이때 배너는 대화를 탓하는 대신 둘 중 어느 경우인지를 알려 줍니다. 초과 사용 비용도 보고하지 않습니다. 이 값은 월초부터 누적된 수치라서 한 달 대부분 동안 배너가 켜져 있게 되기 때문입니다. 이 금액은 계정 카드와 `aipool status`에 표시됩니다. `proxy.sessionDetail`이 꺼져 있어도 배너는 표시되지만, 세션이나 대화를 특정하지는 않습니다.

계정 목록 위의 **Routing** 테이블은 Fable, Sonnet, 그리고 설정된 각 라우트에 대해, 해당 모델 계열의 새 요청이 들어오면 로테이션이 어느 계정을 고를지와 그 요청을 처리할 수 있는 계정이 몇 개인지 보여 줍니다. 처리할 수 없는 계정에는 취소선이 그어지는데, 이것이 해당 계열이 다른 계정으로 라우팅되는 이유입니다. 고정된 라우트는 고정 대상을 표시하고, 그 대상이 지금 사용 가능하지 않으면 그 사실도 표시합니다. 마지막 행들은 자체 라우트가 없는 나머지 전부로, 계정 풀의 프로바이더마다 한 행씩("Claude default", "Codex default") 있습니다. 각 행은 해당 프로바이더에 대한 서버의 기본 대상을 표시합니다. 기본 대상은 그 프로바이더의 현재 계정이며, 현재 계정이 차단되었거나 더 높은 우선순위 계정에 밀린 경우에는 행에 그 이유가 표시됩니다. Claude 풀과 Codex 풀은 각자 독립된 커서를 유지하므로, 요약 줄과 각 카드의 `current` 배지도 프로바이더별로 표시됩니다. 대상은 페이지가 쿼터 막대에서 추론한 것이 아니라 서버가 직접 답한 값입니다(`/aipool/status`의 `routes[].target`, `defaultTargets`, `currentAccounts`. 단일 값 형식인 이전 필드 `defaultTarget`과 `currentAccount`도 계속 출력됩니다. `currentIndexes`는 `currentAccounts`를 위치로 나타낸 것으로, 프로바이더를 키로 하는 객체이며 값은 status `accounts` 배열에서 현재 계정의 0부터 시작하는 인덱스이고, 그 프로바이더를 처리할 수 있는 계정이 없으면 `null`입니다. 두 계정이 같은 이름을 쓰면 이름만으로는 모호하기 때문이며, 연결된 TUI가 각 `►`의 위치를 정할 때 이 값을 사용합니다). 이 대상들은 새 요청에 대한 것이며, 실행 중인 대화가 이미 다른 계정에 고정해 둔 요청에 대한 것이 아닙니다.

각 계정 카드에는 그 계정을 현재 계정으로 만드는 **switch** 버튼이 있습니다(CLI가 쓰는 것과 같은 `POST /aipool/switch`). 이는 고정이 아니라 가벼운 유도일 뿐이며, 일반 로테이션은 거기서부터 다시 진행됩니다. 이미 진행 중인 트래픽이 어떻게 되는지는 `distributeSessions`에 달려 있습니다. 이 옵션이 켜져 있으면 다른 계정에 고정된 대화는 유휴 상태가 될 때까지 그 계정을 유지하므로, 배지가 트래픽보다 먼저 이동합니다. 꺼져 있으면(기본값) 모든 트래픽이 다음 요청부터 전환된 계정을 따릅니다. 페이지는 로테이션이 실제로 대상 계정을 사용할지도 알려 줍니다. 비활성화되었거나, 오류 상태이거나, 레이트 리밋에 걸렸거나, 임계값을 넘은 계정, 또는 더 높은 우선순위 계정에 밀린 계정으로도 전환은 되지만, 페이지는 단순히 "done"이라고 보고하는 대신 그 사실과 이유를 알려 줍니다.


```
http://localhost:3456/aipool/dashboard
```

페이지 자체는 정적 에셋이라 키 없이 로드되지만, 데이터는 그렇지 않습니다. 페이지 스크립트는 먼저 `/aipool/status`를 가져오고, 서버가 키 없는 요청을 거부할 때만 프록시 키를 묻습니다. 루프백 브라우저는 다른 모든 곳에서와 마찬가지로 키가 면제되므로, 프록시가 실행되는 머신에서는 키 입력 창이 뜨지 않습니다. 입력한 키는 브라우저의 localStorage에 보관되며, 키를 교체한 뒤 401이 나면 입력 창이 다시 나타납니다. 프록시를 TLS 뒤에 두는 배포 환경에서는 원격으로도 사용할 수 있습니다: `https://your-proxy.example.com/aipool/dashboard`.

## MCP 엔드포인트

실행 중인 서버는 제어 평면을 Claude Code(또는 다른 MCP 클라이언트)에 도구로 노출할 수 있습니다. 그러면 에이전트가 세션 안에서 계정 풀의 쿼터를 확인하거나, 계정을 전환하거나, 로테이션 설정을 바꿀 수 있습니다. 설정에서 따로 지정하기 전까지는 꺼져 있습니다:

```json
{ "proxy": { "mcp": "read" } }
```

`"read"`는 `get_status`(계정 풀 개요: 서버 버전, 현재 계정, 그리고 계정마다 우선순위, 비활성화 여부, 로테이션이 사용할 수 있는지와 없다면 그 이유, 세션, 알려진 쿼터 창), `get_quota`, `get_settings`를 제공합니다. `"full"`은 CLI 관리 명령으로 할 수 있는 모든 것을 추가합니다: `switch_account`, `reload_config`, `probe_quota`, `set_account_enabled`, `set_account_priority`, `remove_account`, `set_threshold`, `set_distribution`, `set_probe_interval`, `set_warmup`, `set_route`, `remove_route`, `set_blocked_models`, `set_client_mode`. 계정을 추가하거나 자격 증명을 다루는 도구는 없으며, `proxy.mcp` 자체를 바꾸는 도구도 없습니다. 이 설정은 리로드로 반영되므로, 서버 실행 중에도 엔드포인트를 열거나, 범위를 좁히거나, 닫을 수 있습니다.

Claude Code에 이 엔드포인트를 한 번 등록하면 됩니다. `aipool run`과 `aipool env`는 이미 루프백을 프록시 변수에서 제외하므로, 연결은 서버로 곧장 가고 다른 루프백 호출자와 마찬가지로 키가 면제됩니다:

```bash
claude mcp add --transport http aipool http://localhost:3456/aipool/mcp
```

네트워크의 다른 곳에 있는 클라이언트는 CLI와 같은 방식으로 프록시 키를 제시합니다: `--header "x-api-key: tc-…"`.

이 엔드포인트는 또 하나의 `/aipool/` 라우트이며 다른 라우트와 같은 방식으로 접근이 제한됩니다. 프록시 키 또는 루프백이 필요하고, 크로스 오리진 요청은 받지 않으며, 키 없이 허용되는 호출자는 Host 헤더가 이 머신을 가리켜야 합니다. 여기서 세 가지가 따라 나옵니다. 첫째, 프록시 키를 가진 사람은 누구나 이 엔드포인트로 읽을 수 있지만, 이름이 붙은 `proxy.clientKeys` 키에는 설정이 `"full"`이어도 `"read"` 도구만 제공됩니다. 쓰기 도구(계정 제거 포함)는 공유 `proxy.apiKey`와 키가 면제된 루프백 호출자에게만 응답하므로, 클라이언트에 전용 키를 주더라도 계정 풀을 넘겨주는 일은 없습니다. 둘째, 프록시 키가 전혀 설정되어 있지 않으면 엔드포인트는 프록시와 같은 머신의 호출자(루프백 피어이고, `X-Forwarded-For`/`X-Real-IP`/`Forwarded` 헤더가 없으며, `proxy.trustLoopback`이 `false`로 설정되지 않은 경우)에게만 응답하고 나머지에게는 403을 반환합니다. 네트워크를 통해 접근하려면 `proxy.apiKey`를 설정하세요. 셋째, 브라우저 기반 MCP 클라이언트는 `Origin` 헤더를 보내 크로스 오리진으로 거부되므로 이 엔드포인트에 접근할 수 없습니다. 이 엔드포인트는 프로그램으로 실행되는 클라이언트를 위한 것입니다. 서버는 쓰기 작업마다 도구 이름과 인수를 담은 한 줄을 로그에 남깁니다.

프로토콜의 상태 비저장 2026-07-28 리비전과 그 이전의 핸드셰이크 기반 리비전을 모두 지원하므로, 어느 쪽 클라이언트든 동작합니다. 응답은 항상 일반 JSON이며 스트림으로 보내지 않습니다.

## 업데이트

AIPool은 git 체크아웃에서 실행하며 npm에 올라가 있지 않으므로, 자동으로 업데이트되는 것은 없습니다. 체크아웃을 pull한 뒤 서버를 재시작하세요(`aipool restart`). `aipool update`는 현재 버전을 알려 줄 뿐입니다.

## 요청 로깅

요청/응답 세부 내용을 디렉터리에 기록합니다. 기록되는 요청마다 파일 하나가 생성됩니다:

```bash
aipool server --log-to /tmp/requests
```

본문은 크기 상한을 넘으면 잘리고, 보존 기간보다 오래된 파일은 삭제됩니다. 이 제한을 늘리거나 끄려면 [`logLevel`, `logMaxBodyBytes`, `logRetentionHours`](configuration.md#필드)를 참고하세요. 업그레이드 후 처음 시작할 때 그 디렉터리에서 이미 보존 기간을 넘긴 파일을 정리합니다.

`--activity-log FILE`는 대신 TUI 활동 로그 줄을 파일에 덧붙이며, 헤드리스 모드에서도 동작합니다.

Claude Code의 텔레메트리(`/api/event_logging/*`)는 양이 많아 활동 로그의 노이즈가 되므로 기본적으로 로그에서 숨겨집니다. 대신 차단하거나 표시하려면 [`eventLogging`](configuration.md#필드)을 참고하세요.
