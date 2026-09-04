#!/usr/bin/env bash
set -euo pipefail

# (a) Ubuntu only
[[ -r /etc/os-release ]] || { echo "Ubuntu only" >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "Ubuntu only" >&2; exit 1; }
[[ -n "${UBUNTU_CODENAME:-}" ]] || { echo "Ubuntu only" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

# (b) Minimal prerequisites
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates unzip

# (c) Pinned gdg CLI from GitHub Releases
GDG_VERSION="0.3.0"
GDG_ASSET_TEMPLATE="gdg_{version}_linux_{arch}.zip"
GDG_SHA256_X86_64="88a073fe18ff3351645d508e53bb0187640c5153c659c96d13918bd2c3e2791a"
GDG_SHA256_AARCH64="15a29a28cf485e3493030ad8756a10f8022137bd4e243f89ae208a050b004517"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch_name="amd64"; sha256="$GDG_SHA256_X86_64" ;;
  aarch64|arm64) arch_name="arm64"; sha256="$GDG_SHA256_AARCH64" ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="${GDG_ASSET_TEMPLATE//\{version\}/$GDG_VERSION}"
asset="${asset//\{arch\}/$arch_name}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$asset" "https://github.com/gdg-jp/gdgjp/releases/download/cli/v${GDG_VERSION}/${asset}"
echo "$sha256  $tmp/$asset" | sha256sum -c -
unzip -q -o "$tmp/$asset" -d "$tmp"
install -d -m 0755 /usr/local/bin
install -m 0755 "$tmp/gdg" /usr/local/bin/gdg
ln -sfn /usr/local/bin/gdg /usr/local/bin/git-remote-gdg-wiki
rm -rf "$tmp"
trap - EXIT

# (d) Execute gdg converger
exec /usr/local/bin/gdg agent-host apply "$@"

