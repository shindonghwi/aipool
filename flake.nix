{
  description = "AIPool packaged as a dependency-free Node application";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        builtins.listToAttrs (
          map (system: {
            name = system;
            value = f system;
          }) systems
        );
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          aipool = pkgs.callPackage ./nix/package.nix { };
        in
        {
          inherit aipool;
          default = aipool;
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # `nix flake check` builds the package on every system.
          package = self.packages.${system}.aipool;
        }
        # The NixOS VM test only runs on Linux (nixosTest requires a Linux host).
        // nixpkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          nixos-module = import ./nix/tests/module.nix { inherit pkgs self system; };
        }
      );

      apps = forAllSystems (system: {
        aipool = {
          type = "app";
          program = "${self.packages.${system}.aipool}/bin/aipool";
          meta = {
            inherit (self.packages.${system}.aipool.meta) description;
          };
        };
        default = self.apps.${system}.aipool;
      });

      nixosModules = {
        aipool = import ./nix/module.nix;
        default = self.nixosModules.aipool;
      };

      homeManagerModules = {
        aipool = import ./nix/home-manager-module.nix;
        default = self.homeManagerModules.aipool;
      };
    };
}
