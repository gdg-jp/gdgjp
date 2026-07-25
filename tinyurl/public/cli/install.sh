#!/bin/sh
set -eu

repo="gdg-jp/gdgjp"
api="https://api.github.com/repos/$repo/releases?per_page=100"
tag=$(curl -fsSL "$api" | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"cli/v[0-9]+\.[0-9]+\.[0-9]+"' | head -n 1 | cut -d '"' -f 4)
[ -n "$tag" ] || { echo "No gdg CLI release found." >&2; exit 1; }

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  darwin|linux) ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac
arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU architecture: $arch" >&2; exit 1 ;;
esac

version=${tag#cli/v}
archive="gdg_${version}_${os}_${arch}.zip"
base="https://github.com/$repo/releases/download/$tag"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"
expected=$(awk "\$2 == \"$archive\" || \$2 == \"*$archive\" { print \$1 }" "$tmp/checksums.txt")
[ -n "$expected" ] || { echo "Checksum missing for $archive" >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$tmp/$archive" | awk '{print $1}');
elif command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/$archive" | awk '{print $1}');
else echo "sha256 utility is required" >&2; exit 1; fi
[ "$actual" = "$expected" ] || { echo "Checksum verification failed" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required" >&2; exit 1; }
unzip -q "$tmp/$archive" -d "$tmp/extract"
install_dir="$HOME/.local/bin"
mkdir -p "$install_dir"
install -m 0755 "$tmp/extract/gdg" "$install_dir/gdg"
echo "Installed gdg $version to $install_dir/gdg"
case ":$PATH:" in *":$install_dir:"*) ;; *) echo "Add $install_dir to PATH, then open a new shell.";; esac
