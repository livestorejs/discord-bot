{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        pkgsUnstable = import nixpkgsUnstable {
          inherit system;
        };
        corepack = pkgs.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${pkgs.nodejs_24}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {
        devShell = with pkgs; pkgs.mkShell {
          buildInputs = [
            nodejs_24
            corepack
            pkgsUnstable.bun
          ];
        };
      });
}
