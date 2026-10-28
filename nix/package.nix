{
  lib,
  stdenvNoCC,
  nodejs_24,
  makeWrapper,
}:

let
  packageJson = lib.importJSON ../package.json;
in
stdenvNoCC.mkDerivation {
  pname = "aipool";
  version = packageJson.version;

  src = lib.cleanSource ../.;

  nativeBuildInputs = [ makeWrapper ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/share/aipool
    cp -R package.json src LICENSE README.md config.example.json $out/share/aipool/
    chmod +x $out/share/aipool/src/index.js

    makeWrapper ${lib.getExe nodejs_24} $out/bin/aipool \
      --add-flags "$out/share/aipool/src/index.js" \
      --set-default AIPOOL_DISABLE_AUTOUPDATE 1

    runHook postInstall
  '';

  meta = {
    description = packageJson.description;
    homepage = packageJson.homepage;
    license = lib.licenses.mit;
    mainProgram = "aipool";
    platforms = nodejs_24.meta.platforms;
  };
}
