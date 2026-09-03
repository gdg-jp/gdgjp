#!/usr/bin/env bash
# Run inside the Lima VM as root on a TTY after provision.sh.
set -euo pipefail

readonly secrets=/home/gdgagent-svc/.config/xangi/secrets.json

[[ $EUID -eq 0 ]] || { echo "Run with sudo inside the VM." >&2; exit 1; }
[[ -t 0 ]] || { echo "activate.sh must run on a TTY for gdg login --device." >&2; exit 1; }
if [[ -s "$secrets" ]] && grep -q 'DISCORD_TOKEN' "$secrets"; then
  echo "Refusing to activate: the local VM must not contain a Discord bot token." >&2
  exit 1
fi

SUDO_USER=root /opt/gdgjp/agent-host/install.sh --activate

svc_uid=$(id -u gdgagent-svc)
sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user daemon-reload
sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user start xangi.service
for _ in {1..5}; do
  sleep 1
  if ! sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user is-active --quiet xangi.service; then
    sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user status xangi.service >&2 || true
    exit 1
  fi
done
