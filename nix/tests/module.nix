# End-to-end test of the NixOS module: boot a VM, enable services.aipool
# with a seeded config, and assert the service starts, binds its port, and the
# app answers on /aipool/status with the seeded account. Uses an apikey
# account so startup performs no OAuth refresh or other network call (NixOS test
# VMs have no network) — the key is never exercised, only parsed.
{
  pkgs,
  self,
  system,
}:

let
  seedConfig = pkgs.writeText "aipool-seed.json" (builtins.toJSON {
    proxy = {
      port = 3456;
      apiKey = "tc-test-secret";
    };
    upstream = "https://api.anthropic.com";
    accounts = [
      {
        name = "test-apikey";
        type = "apikey";
        apiKey = "sk-ant-api03-dummy-not-used";
      }
    ];
  });
in
pkgs.testers.runNixOSTest {
  name = "aipool-module";

  nodes.machine =
    { ... }:
    {
      imports = [ self.nixosModules.aipool ];

      environment.systemPackages = [ pkgs.curl ];

      services.aipool = {
        enable = true;
        package = self.packages.${system}.aipool;
        # configSource is typed `str`; interpolate the derivation to its
        # store-path string (which also pulls it into the VM's closure).
        configSource = "${seedConfig}";
      };
    };

  testScript = ''
    machine.wait_for_unit("aipool.service")
    machine.wait_for_open_port(3456)

    # Loopback is exempt from the proxy-key gate, so this needs no api key.
    # A 200 proves the server is up and routing; the seeded account name in the
    # body proves configSource was copied and parsed by the app.
    status = machine.succeed("curl -sf http://127.0.0.1:3456/aipool/status")
    assert "test-apikey" in status, f"seeded account missing from status: {status}"

    # The mutable config was materialized at the module's default path.
    machine.succeed("test -f /var/lib/aipool/aipool.json")
  '';
}
