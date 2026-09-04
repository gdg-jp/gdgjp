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
GDG_VERSION="0.3.1"
GDG_ASSET_TEMPLATE="gdg_{version}_linux_{arch}.zip"
GDG_SHA256_X86_64="521302e1837bb5023b2574c03e59db4f9a7e6cb9a28f55fc70b42660768fdc53"
GDG_SHA256_AARCH64="87b641f470f74d1ac3c6324500197ceb51f2807e5773723a47a38ca76444030b"

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

