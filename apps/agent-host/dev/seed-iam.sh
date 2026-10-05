#!/usr/bin/env bash
# Run as root inside the Lima VM after provision.sh and before activate.sh.
set -euo pipefail

readonly config_dir=/home/gdgagent-svc/.config/xangi
readonly iam_file="$config_dir/iam.json"
readonly secrets="$config_dir/secrets.json"
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly fixture="$script_dir/iam-fixture.json"
readonly wiki_dir=/srv/gdg-agent/wiki
readonly check4_page="$wiki_dir/pages/test-chapter-restricted/page.md"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo inside the VM." >&2
  exit 1
fi
if [[ -s "$secrets" ]] && grep -q 'DISCORD_TOKEN' "$secrets"; then
  echo "Refusing to seed: the local VM must not contain a Discord bot token." >&2
  exit 1
fi
[[ -f "$fixture" ]] || { echo "Missing IAM fixture: $fixture" >&2; exit 1; }

install -d -m 0700 -o gdgagent-svc -g gdgagent-svc "$config_dir"
install -m 0600 -o gdgagent-svc -g gdgagent-svc "$fixture" "$iam_file"

if [[ -f "$wiki_dir/.gdgwiki/config.json" || -d "$wiki_dir/.git" || -f "$wiki_dir/.git" ]]; then
  install -d -m 2770 -o gdgagent-svc -g gdgwiki "$(dirname "$check4_page")"
  cat >"$check4_page" <<'PAGE'
---
visibility: restricted
chapter_id: test-chapter
---

# Test chapter-restricted page

Local-only fixture for IAM E2E check 4. Never commit or push this file.
PAGE
  chown gdgagent-svc:gdgwiki "$check4_page"
  chmod 0640 "$check4_page"
  exclude_file="$wiki_dir/.git/info/exclude"
  if [[ -d "$wiki_dir/.git" ]] && ! grep -qxF 'pages/test-chapter-restricted/' "$exclude_file" 2>/dev/null; then
    mkdir -p "$(dirname "$exclude_file")"
    echo 'pages/test-chapter-restricted/' >>"$exclude_file"
  fi
  echo "Check-4 specimen placed at $check4_page and excluded from git."
else
  echo "Skipping check-4 specimen: $wiki_dir is not a wiki clone yet (run activate.sh, then re-run this script)."
fi

svc_uid=$(id -u gdgagent-svc)
if sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user is-active --quiet xangi.service; then
  sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user restart xangi.service
  echo "IAM fixture installed and xangi.service restarted."
else
  echo "IAM fixture installed. activate.sh will start xangi.service."
fi
