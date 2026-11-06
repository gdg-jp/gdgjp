#!/bin/sh
# Install the gdg CLI on the runner VM, from a release or from a local build.
#   sudo sh install-gdg.sh 0.7.0          # GitHub release cli/v0.7.0 (linux_arm64)
#   sudo sh install-gdg.sh ./gdg          # a binary built with GOOS=linux GOARCH=arm64
set -eu
target=/usr/local/bin/gdg
case "${1:?usage: install-gdg.sh <version|path>}" in
  */*|gdg)
    install -m 0755 "$1" "$target" ;;
  *)
    tmp=$(mktemp -d)
    base="https://github.com/gdg-jp/gdgjp/releases/download/cli/v$1"
    curl -fsSL -o "$tmp/gdg.zip" "$base/gdg_$1_linux_arm64.zip"
    curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
    (cd "$tmp" && grep "gdg_$1_linux_arm64.zip" checksums.txt | sed "s/gdg_$1_linux_arm64.zip/gdg.zip/" | sha256sum -c -)
    unzip -o -q "$tmp/gdg.zip" -d "$tmp"
    install -m 0755 "$tmp/gdg" "$target"
    rm -rf "$tmp" ;;
esac
# git finds the gdg-wiki transport through this name; the runner user cannot write here.
ln -sf "$target" /usr/local/bin/git-remote-gdg-wiki
"$target" --version
