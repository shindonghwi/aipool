# 프록시 모드

트래픽이 물리적으로 어떻게 이동하는지에 관한, 서로 독립적인 두 가지를 다룹니다. `claude`가 AIPool에 도달하는 방식과, AIPool이 Anthropic에 도달하는 방식입니다.

## MITM 프록시 모드(기본값)

일반 리버스 프록시는 `ANTHROPIC_BASE_URL`이 적용되는 범위만 가로챕니다. 일부 Claude Code 기능(예: **Claude Design MCP**)은 이 변수를 무시하는 **하드코딩된** `https://api.anthropic.com` URL을 사용하므로 프록시를 우회합니다. MITM 프록시 모드는 이런 요청까지 잡아내며, 그래서 `aipool run`(과 셸 별칭)의 기본값입니다.

```bash
aipool run -- <claude args...>
```

이를 끄고 `ANTHROPIC_BASE_URL`로만 라우팅하려면 `--no-mitm`을 전달합니다.

```bash
aipool run --no-mitm -- <claude args...>
```

MITM 모드는 claude가 AIPool을 **HTTPS 포워드 프록시**(`HTTPS_PROXY`)로 사용하도록 실행하고, 로컬에서 생성한 CA(`NODE_EXTRA_CA_CERTS`)를 신뢰하게 합니다. 가로채는 호스트에 대해 AIPool은 로컬 리프 인증서를 제시하는 실제 HTTP/2 서버로 터널을 **종료**하고(HTTP/1.1 클라이언트도 처리합니다), **버퍼링과 재시도를 수행하는 클라이언트로 각 요청을 전달**합니다 — base URL 모드가 사용하는 것과 같은 경로입니다. AIPool은 각 요청마다 다음을 수행합니다.

- 클라이언트의 `x-api-key`는 버리고 활성 계정의 실제 자격 증명을 주입합니다. OAuth 계정에는 `authorization: Bearer …`를, API 키 계정에는 `x-api-key`를 넣습니다.
- `metadata.user_id` 안의 **`account_uuid`를** 활성 계정의 UUID로 다시 씁니다(본문이 주입된 토큰과 일치하도록).
- 요청의 **`model` 값**에 따라 라우팅합니다(Fable 쿼터가 소진된 계정은 Fable 요청에서는 건너뛰지만 다른 모델은 계속 처리합니다).
- 쿼터를 파악하기 위해 응답의 `anthropic-ratelimit-*`를 읽습니다.
- 어떤 계정이 쿼터 `429`를 반환하면 **다른 계정으로 요청을 다시 보내므로**, 다른 계정에 여유가 있는 한 "you've reached your limit"이 사용자에게 드러나지 않습니다.

요청이 버퍼링되므로 claude는 재시도를 알아차리지 못합니다. 클라이언트 토큰 갱신(`/v1/oauth/token`), Remote Control(`/v1/code/*`), claude.ai 첨부 파일 전송(`/api/oauth/files/*`, `/api/oauth/file_upload`)은 페어링된 신원에 묶여 있어 로테이션으로 바뀐 토큰으로는 403이 나므로, 클라이언트 자신의 자격 증명으로 그대로 통과시킵니다. 업스트림 이외의 호스트는 내용을 보지 않고 그대로 터널링합니다. 서버는 base URL 클라이언트와 프록시 클라이언트를 *둘 다* 동시에 받으므로, `--no-mitm`을 붙여 실행한 인스턴스와 붙이지 않고 실행한 인스턴스가 한 서버를 공유할 수 있습니다.

Codex 계정이 있는 풀은 `chatgpt.com`도 가로채는데, 이곳은 ChatGPT Desktop이 통신하는 곳이기도 합니다. 이 앱을 실행하는 머신에서는 `proxy.terminalOnly`를 `true`로 설정해 이 호스트를 건드리지 않고 터널링하세요. 그러면 터미널의 Codex CLI는 명시적인 `/backend-api/codex` base URL을 통해 계속 풀에 접근하고, 데스크톱 앱은 자체 로그인을 유지합니다.

### 신뢰 모델

- CA는 로컬에서 생성되어 설정 디렉터리에 저장되며, `aipool run`으로 실행한 claude 프로세스**만**(`NODE_EXTRA_CA_CERTS`를 통해) 이를 신뢰합니다 — 시스템 신뢰 저장소에는 **절대** 추가되지 않습니다. 리프 인증서의 개인 키는 `0600` 권한이며, CA 개인 키는 디스크에 기록되지 않습니다.
- AIPool은 업스트림 구간에서 여전히 **실제** Anthropic 인증서를 검증합니다.

자격 증명 없이도 프록시와 CA를 확인할 수 있습니다 — 프록시는 내장 테스트 호스트에 항상 응답합니다.

```bash
# (서버가 실행 중이고 인증서가 생성된 상태에서. 예: `aipool run`을 한 번 실행한 뒤)
curl --proxy http://localhost:3456 --cacert ~/.config/aipool-ca.pem https://www.example.org/
# → {"aipool":"mitm-proxy-ok","host":"www.example.org",...}
```

## 업스트림 프록시

**인터넷으로 직접 나가는 경로가 없는** 호스트를 위한 기능입니다. 모든 아웃바운드 연결이 HTTP 프록시를 거쳐야 하는 기업 환경이 대표적인 경우입니다. 이 설정이 없으면 Claude Code 자체는 동작하더라도 AIPool은 첫 업스트림 요청에서 `connect ETIMEDOUT`으로 실패합니다.

```json
{ "upstreamProxy": "http://user:pass@proxy.corp.example:3128" }
```

스킴 없이 `"proxy.corp.example:3128"`만 적어도 동작합니다. TUI 설정 화면(**Network → Upstream proxy**)에서 실행 중에 바로 설정할 수 있으며, 재시작 없이 다음 요청부터 적용됩니다.

- Anthropic으로 가는 **모든** 트래픽을 포괄합니다: 요청 전달, OAuth 로그인, 토큰 갱신, 프로필 및 사용량 조회. 이 중 일부만 포괄하는 프록시라면 계정을 갱신할 수는 있어도 추가할 수는 없거나, 그 반대가 될 것입니다.
- 설정에 아무 값도 없으면 `HTTPS_PROXY` / `ALL_PROXY`를 자동으로 사용하므로, 이미 다른 도구를 위해 설정된 머신에서는 추가 설정이 필요 없습니다. 이 경우 서버는 시작할 때 이를 알리고, TUI는 해당 행에 값의 출처를 표시합니다 — 아무도 설정에 입력하지 않은 프록시가 조용히 적용되는 일은 없어야 하기 때문입니다.
- `NO_PROXY`(또는 `noProxy`)는 접미사 기준으로 호스트를 제외하며, `"upstreamProxy": false`는 환경 변수를 완전히 무시합니다.
- **이 서버 자신을 가리키는 프록시는 거부됩니다.** `aipool env`는 AIPool을 가리키는 `HTTPS_PROXY`를 export하므로, 그 셸에서 시작한 서버나 CLI는 자기 자신을 egress 프록시로 물려받게 됩니다 — 그러면 모든 업스트림 호출이 프록시로 다시 들어가, 프록시가 선택한 아무 계정으로 조용히 응답을 받게 됩니다(그 결과 사용량 프로브는 그 한 계정의 쿼터를 모든 계정의 쿼터로 저장하게 됩니다). 주소가 자신의 리스너인 값은 환경 변수에서 왔든 설정에서 왔든 버려지며, 시작 시 출력되는 줄과 TUI 행에 그 사실이 표시됩니다.
- **TLS는 종단 간으로 유지됩니다.** 터널은 단순한 `CONNECT`이므로 프록시는 암호문만 보며, 인증서 검증도 그대로입니다. TLS를 가로채는 프록시라면 그 CA를 `NODE_EXTRA_CA_CERTS`에 넣어야 합니다.
- SOCKS 프록시는 지원하지 않으며, HTTP `CONNECT`만 지원합니다. `socks5://` 값은 나중에 연결 시점에 실패하는 대신 시작할 때 거부됩니다. `https://` 프록시 URL도 마찬가지입니다. AIPool은 프록시*와는* TLS로 통신하지 않으므로, 이 스킴을 받아들이면 `CONNECT`(자격 증명 포함)를 443 포트로 평문 전송하게 됩니다. `http://host:port`로 작성하세요 — 그래도 이를 통과하는 터널은 종단 간 TLS입니다.

이것은 라우팅 정책이 아니라 **네트워크**의 속성입니다. 설정되어 있다면 그것이 곧 이 머신이 Anthropic에 도달하는 방식입니다. 바로 이 점이 아래의 sx.org와 다른 점인데, sx.org는 요청마다 선택되는 특정 egress *제공자*입니다. 둘 다 설정된 경우 sx.org로 라우팅된 요청은 sx.org를 사용하고, 나머지는 모두 업스트림 프록시를 사용합니다. 둘 다 Claude Code가 **접속하는** 로컬 포트인 `proxy.port`와는 관계가 없습니다.

## sx.org 프록시 모드

기본값은 꺼짐입니다. 일부 일시적인 `429`는 계정이 아니라 프록시의 **아웃바운드 IP**를 기준으로 하므로, 계정을 전환해도 소용이 없습니다. 이를 피하기 위해 AIPool은 [sx.org](https://sx.org)의 주거용 프록시를 거쳐 업스트림 요청을 라우팅해 다른 egress IP를 사용할 수 있습니다.

TUI를 열고 **`g`** 키를 눌러 설정 화면으로 들어간 뒤, **sx.org API key** 행에 sx.org API 키를 입력합니다(`config.sx.apiKey`에 저장됩니다). AIPool은 sx.org 계정에 이미 있는 활성 프록시 포트를 재사용하거나 미국 주거용 프록시 포트를 자동으로 생성하고, 리버스 프록시 경로와 MITM 경로 **양쪽 모두**에서 HTTP `CONNECT`로 이를 거쳐 업스트림에 연결합니다.

**sx.org mode** 행은 `←`/`→`로 순환합니다.

| 모드 | 동작 |
| --- | --- |
| always | **모든** 업스트림 요청을 sx.org를 통해 터널링합니다. |
| on 429 only | 직접 연결하다가 (IP 기반인) `429`가 오면, 기다리지 않고 즉시 그 요청을 sx.org의 새 egress IP로 재시도합니다. MITM 경로에서는 최근에 `429`가 발생했다면 짧은 시간 동안 새 터널을 sx.org로 라우팅합니다. |
| off | sx.org를 사용하지 않지만, 즉시 다시 켤 수 있도록 **API 키는 유지**합니다. |

TLS는 **터널 위에서 `api.anthropic.com`과 종단 간으로 수립**되므로, sx.org 프록시는 암호문만 중계하며 실제 Anthropic 인증서도 그대로 검증됩니다. 모드와 키 변경은 즉시 적용됩니다(재시작 불필요). 키가 설정되면 **Clear sx.org key** 행이 나타나며, 이를 통해 키를 완전히 삭제할 수 있습니다.

> **비용:** **always** 모드에서는 *모든* Claude 트래픽이 주거용 프록시를 거치며, sx.org는 이를 대역폭 기준으로 과금합니다 — GB당 실제 비용이 발생한다고 보아야 합니다. **on 429 only**는 실제로 스로틀링될 때만 프록시를 사용하므로, 레이트 리밋을 버텨 내는 더 저렴한 방법입니다.
