# Nix 패키징과 모듈

이 디렉터리에는 AIPool의 Nix 패키지, NixOS 모듈, Home Manager 모듈이 들어
있습니다.

## Flake 출력

`flake.nix`는 지원하는 각 시스템마다 다음을 내보냅니다.

- `packages.${system}.aipool`
- `packages.${system}.default`
- `apps.${system}.aipool`
- `apps.${system}.default`

이 밖에도 다음을 내보냅니다.

- `nixosModules.aipool`
- `nixosModules.default`
- `homeManagerModules.aipool`
- `homeManagerModules.default`
- `checks.${system}.package` (패키지 빌드)
- `checks.${system}.nixos-module` (NixOS VM 테스트, Linux 전용)

패키지를 지원하는 시스템은 다음과 같습니다.

- `x86_64-linux`
- `aarch64-linux`
- `x86_64-darwin`
- `aarch64-darwin`

## 패키지

`package.nix`는 AIPool을 Node로 바로 실행하는 애플리케이션으로 패키징합니다.

- `version`은 `package.json`에서 가져옵니다.
- `src`는 `lib.cleanSource ../.`로 가져온 저장소 체크아웃입니다.
- 설치 단계에서 런타임 파일을 `$out/share/aipool`로 복사합니다.
- 래퍼는 고정된 Nixpkgs `nodejs_24`로 `src/index.js`를 실행합니다.
- 빌드 과정에서 `npm install`을 실행하거나, Bun을 호출하거나, 패키지
  레지스트리에서 의존성을 받아 오지 않습니다. AIPool은 현재 런타임에 Node
  내장 모듈과 로컬 소스 파일을 사용합니다.
- 래퍼는 기본으로 `AIPOOL_DISABLE_AUTOUPDATE=1`을 설정합니다. 그래서 Nix
  패키지로 실행할 때는 npm을 확인하지 않고, 전역 설치를 변경하는 자체
  업데이트도 시도하지 않습니다.

이 저장소에서 패키지를 빌드합니다.

```sh
nix build --no-update-lock-file .#aipool
```

패키징된 CLI를 실행합니다.

```sh
nix run --no-update-lock-file .#aipool -- help
```

서버를 수동으로 실행합니다.

```sh
nix run --no-update-lock-file .#aipool -- server --headless
```

이 패키지는 의도적으로 저장소 소스를 감싸기만 하는 깔끔한 래퍼로
만들었습니다. `package.nix`에는 별도의 소스 tarball 해시가 없으며, AIPool
소스의 상태는 Git 이력으로 고정됩니다.

## NixOS 모듈

모듈을 가져온 뒤 `services.aipool`을 활성화합니다.

```nix
{
  inputs.aipool.url = "path:/path/to/aipool";   # 이 체크아웃

  outputs =
    { nixpkgs, aipool, ... }:
    {
      nixosConfigurations.host = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          aipool.nixosModules.default
          ({ config, ... }: {
            services.aipool = {
              enable = true;
              host = "0.0.0.0";
              port = 3456;
              openFirewall = true;
              configSource = config.sops.secrets.aipool-config.path;
            };

            sops.secrets.aipool-config = {
              owner = "aipool";
              group = "aipool";
              mode = "0400";
            };
          })
        ];
      };
    };
}
```

NixOS 모듈은 `aipool.service`, 기본값인 `aipool` 시스템 사용자/그룹,
비공개 `/var/lib/aipool` 상태 디렉터리를 만들고, 필요하면 CLI를
`environment.systemPackages`에 설치합니다.

주요 옵션은 다음과 같습니다.

- `services.aipool.package`: 실행할 패키지입니다.
- `services.aipool.installPackage`: CLI를 시스템 전역에 설치합니다.
- `services.aipool.configFile`: 변경 가능한 AIPool 설정 파일 경로입니다.
  기본값은 `/var/lib/aipool/aipool.json`입니다.
- `services.aipool.configSource`: `configFile`이 아직 없을 때만 복사되는
  선택적 시드 설정입니다.
- `services.aipool.host`: `AIPOOL_HOST`를 덮어쓰는 선택적 값입니다. LAN에서
  접근하려면 `0.0.0.0`을 사용합니다.
- `services.aipool.port`: 방화벽을 열 때 쓰는 포트입니다. 실제로 리슨할
  포트는 AIPool이 설정 파일에서 읽습니다.
- `services.aipool.openFirewall`: NixOS 방화벽에서 `port`를 엽니다.
- `services.aipool.logDirectory`: 선택적인 `--log-to` 디렉터리입니다.
- `services.aipool.environment`: 서비스에 추가할 환경 변수입니다.
- `services.aipool.serviceConfig`: 추가 systemd 설정입니다.

모듈은 `aipool server --headless`를 실행합니다. AIPool은 갱신된 OAuth 토큰,
계정 변경 사항, 라우트, 쿼터 설정, 런타임 상태를 설정 옆에 저장하므로 설정
파일은 계속 변경 가능한 상태여야 합니다.

## Home Manager 모듈

AIPool을 사용자 서비스로 실행하려면 Home Manager 모듈을 가져옵니다.

```nix
{ config, inputs, ... }:

{
  imports = [
    inputs.aipool.homeManagerModules.default
  ];

  services.aipool = {
    enable = true;
    configSource = config.sops.secrets.aipool-config.path;
  };

  sops.secrets.aipool-config = {
    mode = "0400";
  };
}
```

Home Manager 모듈은 `systemd.user.services.aipool`을 만들고, 필요하면 CLI를
`home.packages`에 추가하며, 변경 가능한 설정 파일 경로의 기본값을
`${XDG_CONFIG_HOME}/aipool.json`으로 둡니다.

주요 옵션은 다음과 같습니다.

- `services.aipool.package`: 실행할 패키지입니다.
- `services.aipool.installPackage`: CLI를 `home.packages`에 설치합니다.
- `services.aipool.configFile`: 변경 가능한 AIPool 설정 파일 경로입니다.
- `services.aipool.configSource`: `configFile`이 아직 없을 때만 복사되는,
  사용자가 읽을 수 있는 선택적 시드 설정입니다.
- `services.aipool.stateDirectory`: 사용자 서비스의 작업 디렉터리입니다.
  기본값은 `${XDG_STATE_HOME}/aipool`입니다.
- `services.aipool.host`: `AIPOOL_HOST`를 덮어쓰는 선택적 값입니다.
- `services.aipool.logDirectory`: 선택적인 `--log-to` 디렉터리입니다.
- `services.aipool.environment`: 사용자 서비스에 추가할 환경 변수입니다.
- `services.aipool.serviceConfig`: 추가 systemd 사용자 서비스 설정입니다.

사용자 서비스를 시작하거나 상태를 확인하려면 다음을 실행합니다.

```sh
systemctl --user start aipool.service
systemctl --user status aipool.service
```

## 시크릿, LAN 접근, MITM CA

AIPool 설정에는 민감한 데이터가 들어 있습니다. `proxy.apiKey`, OAuth 리프레시
토큰, 액세스 토큰, 선택적인 API 키 계정, 계정 라우팅, sx.org 설정이 여기에
해당합니다. 시드 설정은 sops-nix나 그에 준하는 시크릿 관리 시스템에
보관합니다.

LAN에서 접근하게 하려면 다음과 같이 합니다.

- `services.aipool.host = "0.0.0.0"`을 설정하거나 설정 파일에서
  `proxy.host`를 지정합니다.
- 설정 파일에 강력한 `proxy.apiKey`를 지정합니다.
- 의도한 네트워크 경로에만 방화벽을 엽니다.
- 클라이언트에 프록시 URL과 `proxy.apiKey`를 모두 전달합니다.

일반적인 base URL 방식 클라이언트는 다음과 같이 사용합니다.

```sh
ANTHROPIC_BASE_URL=http://aipool-host:3456 \
ANTHROPIC_API_KEY='<proxy.apiKey>' \
claude -p 'Reply with exactly: ok'
```

MITM/포워드 프록시 모드에서는 클라이언트에 AIPool이 생성한 CA 인증서도
필요합니다. AIPool은 MITM 파일을 `AIPOOL_CONFIG` 옆에 저장합니다.

- `aipool-ca.pem`: 클라이언트가 신뢰해야 하는 CA 인증서입니다.
- `aipool-leaf.pem`: 생성된 서버 리프 인증서입니다.
- `aipool-leaf.key`: 생성된 서버 리프 개인 키입니다.

CA 개인 키는 저장되지 않습니다. MITM 파일이 없거나 더 이상 업스트림 호스트를
포함하지 않으면 AIPool이 인증서 체인을 다시 생성하며, 그러면 클라이언트가
신뢰해야 하는 CA 인증서도 바뀝니다.

sops 운용에 관한 실무 지침은 다음과 같습니다.

- 초기 `aipool.json` 시드에는 `proxy.apiKey`와 계정 자격 증명이 들어 있으므로
  sops에 저장합니다.
- 클라이언트가 포워드 프록시 모드를 써야 한다면, MITM을 처음 실행한 뒤
  `aipool-ca.pem`을 sops-nix로 클라이언트 머신에 배포합니다.
- 서비스 상태를 교체하거나 호스트를 옮긴 뒤에도 CA 신뢰 앵커가 유지되어야
  한다면 `aipool-ca.pem`, `aipool-leaf.pem`, `aipool-leaf.key`를 백업하거나
  따로 관리합니다.
- 이 파일들은 Nix 스토어에 넣지 않습니다.

MITM 모드에서 쓰는 클라이언트 측 환경 예시는 다음과 같습니다.

```sh
HTTPS_PROXY=http://<proxy.apiKey>@aipool-host:3456 \
NODE_EXTRA_CA_CERTS=/run/secrets/aipool-ca.pem \
claude -p 'Reply with exactly: ok'
```

curl로 검증하려면 다음을 실행합니다.

```sh
curl --proxy http://<proxy.apiKey>@aipool-host:3456 \
  --cacert /run/secrets/aipool-ca.pem \
  https://www.example.org/
```

## 테스트

flake가 테스트를 `checks`로 노출하므로 `nix flake check` 한 번으로 모든
테스트가 실행됩니다.

```sh
nix flake check --no-update-lock-file -L
```

- `checks.${system}.package`는 지원하는 모든 시스템에서 패키지를 빌드합니다.
- `checks.${system}.nixos-module`(Linux 전용)은 완전한 NixOS VM
  테스트(`nix/tests/module.nix`)입니다. `services.aipool`을 활성화하고 시드
  설정을 넣은 VM을 부팅한 뒤, 유닛과 그 포트가 준비되기를 기다렸다가
  `/aipool/status`가 시드로 넣은 계정을 담아 응답하는지 확인합니다. 패키지,
  모듈 연결, 설정 시딩을 엔드투엔드로 검증하는 테스트입니다. 시작할 때
  네트워크 호출이 일어나지 않도록 `apikey` 계정을 사용합니다(VM 테스트에는
  네트워크가 없습니다).

VM 테스트를 돌리려면 러너에 KVM이 있어야 합니다(GitHub 호스팅 러너인
`ubuntu-latest`는 `/dev/kvm`을 제공합니다).

## CI

`CI` 워크플로는 `master`에 대한 푸시와 풀 리퀘스트에서 실행되며, 수동으로
실행할 수도 있습니다. Node 테스트/lint 매트릭스와 함께 다음을 실행합니다.

- `nix flake check`(러너 시스템에서의 패키지 빌드 + NixOS VM 테스트)
- `nix run --no-update-lock-file .#aipool -- help`로 CLI 래퍼를 확인하는
  스모크 테스트
- 브랜치 보호 규칙에서 필수로 지정할 수 있는, 이름이 고정된 집계용 `test` 잡

## flake 잠금 파일 업데이트

패키지가 저장소 체크아웃을 `src`로 쓰기 때문에 따로 관리할 업스트림 소스
해시가 없습니다. AIPool 소스는 Git 커밋 자체로 고정됩니다. 관여하는 Nix
해시는 `flake.lock`에 있는 nixpkgs 잠금뿐이며, 더 새로운 nixpkgs로 고정하고
싶을 때 `nix flake update`로 갱신합니다.
