# 시작하기

AIPool을 처음 설치해서 Claude Code와 Codex CLI에 붙여 쓰기까지의 과정을 순서대로 정리했습니다. 위에서부터 따라 하면 됩니다.

## 준비물

- macOS 또는 Linux, Node.js 20 이상 (`node --version`으로 확인)
- Claude Code(`claude`): Claude 계정을 쓸 경우
- Codex CLI(`codex`): Codex 계정을 쓸 경우
- 풀에 넣을 구독 계정: Claude Pro/Max/Team/Enterprise, ChatGPT Plus/Pro/Team

## 1. 설치

```bash
git clone https://github.com/shindonghwi/aipool.git ~/aipool
echo "alias aipool='node $HOME/aipool/src/index.js'" >> ~/.zshrc   # bash라면 ~/.bashrc
source ~/.zshrc
aipool version
```

의존성이 없어서 `npm install` 없이 클론하자마자 실행됩니다. 설정 파일(`~/.config/aipool.json`)은 처음 실행할 때 자동으로 만들어집니다.

## 2. 계정 추가

```bash
aipool login
```

어떤 계정을 추가할지 묻습니다.

```
  1. Claude subscription  (Pro, Max, Team, Enterprise)
  2. Anthropic API key    (Console API billing)
  3. Codex subscription   (ChatGPT Plus, Pro, Team)
```

번호를 고르면 브라우저가 열리고, 로그인을 마치면 계정이 추가됩니다. 풀에 넣을 계정마다 한 번씩 반복하세요. Codex 계정은 `aipool login --codex`로 메뉴 없이 바로 추가할 수도 있습니다.

- **두 번째 계정부터는 브라우저 로그인 상태를 확인하세요.** 브라우저가 이미 로그인된 계정으로 바로 넘어가면 같은 계정이 다시 로그인되고, 이때는 새 계정이 추가되지 않고 기존 계정의 자격 증명만 갱신됩니다. 브라우저에서 로그아웃한 뒤 다른 계정으로 로그인하세요.
- Claude Code에 이미 로그인되어 있다면 `aipool import`로 그 계정을 바로 가져올 수 있습니다.
- 브라우저가 없는 서버에서는 `aipool login --token`으로 URL과 코드를 복사해 붙여 넣는 방식으로 로그인합니다.

추가한 계정을 확인합니다.

```bash
aipool accounts
```

## 3. 프록시 서버 켜기

둘 중 하나를 고르세요.

**계속 켜 두기 (권장).** 컴퓨터에 로그인하면 자동으로 시작되고, 프로세스가 죽어도 스스로 다시 뜹니다. macOS는 LaunchAgent, Linux는 `systemd --user` 서비스로 등록됩니다.

```bash
aipool service install
aipool status     # 계정별 쿼터 확인
aipool attach     # 실행 중인 서버의 TUI 보기 (q로 나가도 서버는 계속 실행)
```

**필요할 때만 켜기.** 터미널 하나를 열어 두고 실행하면 쿼터 막대와 활동 로그가 있는 TUI가 뜹니다. 이 터미널을 닫으면 프록시도 꺼집니다.

```bash
aipool server
```

## 4. Claude Code 연결

```bash
aipool alias --install
source ~/.zshrc   # 또는 새 터미널 열기
```

이제 `claude`를 실행하면 AIPool을 거치고, 기본으로 `--dangerously-skip-permissions` 모드(권한 확인 없이 실행)로 뜹니다. 플래그를 따로 붙이지 않아도 됩니다.

```bash
claude                              # 권한 확인 없이 실행 (기본)
claude --permission-mode manual     # 이번만 일반 모드로 실행
```

항상 일반 모드로 쓰고 싶다면 `~/.config/aipool.json`에 `"skipPermissions": false`를 넣으세요. root 계정에서는 Claude Code가 이 플래그를 거부하고 종료하기 때문에 붙이지 않습니다.

별칭은 `claude`를 `aipool run --`으로 바꿔 주는 것이고, `--` 뒤의 인수는 그대로 `claude`에 전달됩니다. 별칭 없이 쓰려면 `aipool run`을 실행하세요.

## 5. Codex 연결

`~/.codex/config.toml`에 아래 내용을 넣으세요. 파일이 없으면 새로 만드세요. Codex가 OpenAI 대신 AIPool로 요청을 보내고, 기본으로 `--yolo` 모드(승인과 샌드박스 없이 실행)로 뜨게 됩니다.

```toml
model_provider = "aipool"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.aipool]
name = "aipool"
base_url = "http://127.0.0.1:3456/backend-api/codex"
wire_api = "responses"
requires_openai_auth = true
```

위의 세 줄(`model_provider`, `approval_policy`, `sandbox_mode`)은 파일 맨 위, 첫 번째 `[...]` 섹션보다 앞에 두세요. TOML에서는 섹션 아래에 적은 키가 그 섹션에 속하게 되어 설정이 적용되지 않습니다.

`requires_openai_auth = true`는 이미지 생성(`$imagegen`)에 필요합니다. 이 줄이 없거나 Codex 자체 로그인이 안 되어 있으면 Codex가 이미지 도구를 빼고 요청을 보냅니다. 그러니 `codex login`도 한 번 해 두세요. Codex가 보내는 인증 정보는 AIPool이 풀 계정의 것으로 바꿔서 보내므로, 요청은 그대로 풀 계정으로 처리됩니다.

그다음은 그냥 실행하면 됩니다.

```bash
codex                                   # 승인과 샌드박스 없이 실행 (기본, --yolo와 같음)
codex -a on-request -s workspace-write  # 이번만 일반 모드로 실행
```

권한 확인 없이 실행하는 두 모드는 에이전트가 묻지 않고 파일을 고치고 명령을 실행하게 하는 Claude Code와 Codex 자체의 기능입니다. AIPool은 네트워크 요청만 중계하므로 어느 모드로 실행하든 똑같이 동작합니다.

## 6. 제대로 붙었는지 확인

`claude`나 `codex`에서 아무 질문이나 하나 보낸 다음 확인합니다.

```bash
aipool status
```

요청을 받은 계정의 쿼터 막대에 사용량이 표시되면 정상입니다. TUI(`aipool server` 또는 `aipool attach`)의 활동 로그에는 요청마다 어느 계정으로 갔는지 한 줄씩 찍힙니다. Claude 요청은 `/v1/messages`, Codex 요청은 `/backend-api/codex/responses`로 보입니다.

## 자주 겪는 문제

**`claude`를 실행하면 `Proxy not running on port 3456`이 뜹니다.**
프록시가 꺼져 있습니다. `aipool server`를 실행하거나 `aipool service install`로 서비스를 등록하세요. AIPool을 거치지 않고 원래 `claude`를 쓰려면 `\claude`처럼 앞에 역슬래시를 붙이면 별칭을 건너뜁니다.

**`codex`가 연결 오류로 멈춥니다.**
마찬가지로 프록시가 꺼져 있는 경우입니다. 서버를 켜세요. 프록시 없이 Codex를 쓰려면 `config.toml`의 `model_provider = "aipool"` 줄을 주석 처리하면 되는데, 이때는 Codex 자체 로그인이 필요합니다.

**계정을 두 개 추가했는데 `aipool accounts`에 하나만 보입니다.**
같은 계정으로 두 번 로그인한 것입니다. 브라우저에서 로그아웃하고 다른 계정으로 `aipool login`을 다시 실행하세요.

**에디터나 스크립트에서 띄운 `claude`는 AIPool을 거치지 않습니다.**
별칭은 터미널에서 직접 입력한 `claude`에만 적용됩니다. 이런 경우는 [환경 변수를 직접 설정하기](usage.md#환경-변수를-직접-설정하기)를 참고하세요.

**모든 계정의 쿼터를 다 썼습니다.**
기본값에서는 429가 그대로 전달됩니다. `holdSeconds`를 설정하면 쿼터가 초기화될 때까지 요청을 붙잡고 기다립니다. [소진 시 대기](quota.md#소진-시-대기)를 참고하세요.

## 업데이트

```bash
cd ~/aipool && git pull
aipool restart   # 서비스로 돌리는 경우. aipool server로 켰다면 껐다가 다시 실행
```

## 제거

```bash
aipool alias --uninstall
aipool peer uninstall      # aipool peer install을 했다면
aipool service uninstall
rm -rf ~/aipool
```

셸 rc 파일의 `alias aipool=...` 줄과 `~/.codex/config.toml`에 넣은 aipool 설정도 지우세요. 계정 토큰이 담긴 설정 파일은 `~/.config/aipool.json`, `aipool.state.json`, `aipool-ca.pem`, `aipool-leaf.pem`, `aipool-leaf.key`로 `~/.config`에 남아 있으니 필요 없으면 함께 지우세요. `aipool peer`의 우편함은 `~/.config/aipool-peer`에 있습니다.

## 더 보기

- [계정](accounts.md): API 키, 여러 조직, 서드파티 백엔드
- [사용법](usage.md): 전체 명령어, 브라우저 대시보드, MCP 엔드포인트
- [라우팅](routing.md): 계정을 고르고 전환하는 규칙
- [설정](configuration.md): 설정 파일의 모든 필드
