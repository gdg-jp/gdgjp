#!/usr/bin/env bash
# Run inside the Lima VM as root. This deliberately invokes the normal host installer.
set -euo pipefail

readonly source_root=/mnt/gdgjp-src
readonly target_root=/opt/gdgjp
readonly xangi_source=/mnt/xangi-src
readonly xangi_target=/opt/xangi
readonly cursor_version=2026.08.11-e8db854
readonly cursor_url="https://downloads.cursor.com/lab/${cursor_version}/linux/arm64/agent-cli-package.tar.gz"

[[ $EUID -eq 0 ]] || { echo "Run with sudo inside the VM." >&2; exit 1; }
[[ -f "$source_root/agent-host/install.sh" ]] || { echo "Missing read-only gdgjp mount: $source_root" >&2; exit 1; }
[[ -f "$xangi_source/package.json" && -d "$xangi_source/.git" ]] || {
  echo "Missing read-only xangi checkout mount: $xangi_source" >&2
  exit 1
}
source_mount_options="$(findmnt -no OPTIONS -T "$source_root")"
[[ ",$source_mount_options," == *,ro,* ]] || { echo "Expected read-only source mount: $source_root" >&2; exit 1; }
xangi_mount_options="$(findmnt -no OPTIONS -T "$xangi_source")"
[[ ",$xangi_mount_options," == *,ro,* ]] || { echo "Expected read-only xangi mount: $xangi_source" >&2; exit 1; }
mkdir -p "$target_root"
write_probe=$(mktemp "$target_root/.provision-write-probe.XXXXXX")
rm -f "$write_probe"
rsync -a --delete --exclude .git --exclude node_modules --exclude /agent-host/wiki "$source_root/" "$target_root/"
rsync -a --delete --exclude node_modules "$xangi_source/" "$xangi_target/"

tmp_archive=$(mktemp)
trap 'rm -f "$tmp_archive"' EXIT
curl -fsSL "$cursor_url" -o "$tmp_archive"
rm -rf /opt/cursor-agent
mkdir -p /opt/cursor-agent
tar -xzf "$tmp_archive" -C /opt/cursor-agent --strip-components=1
ln -sfn /opt/cursor-agent/cursor-agent /usr/bin/cursor-agent
[[ "$(cursor-agent --version)" == *"$cursor_version"* ]] || { echo "Pinned cursor-agent version check failed." >&2; exit 1; }

slot_count="${GDG_AGENT_SLOT_COUNT:-2}"
[[ "$slot_count" =~ ^[1-9][0-9]*$ ]] || { echo "GDG_AGENT_SLOT_COUNT must be a positive integer." >&2; exit 1; }
# Deliberately suppress operator-secret copying: this VM must never log in as the production bot.
SUDO_USER=root GDG_AGENT_SLOT_COUNT="$slot_count" "$target_root/agent-host/install.sh"
if [[ -s /home/gdgagent-svc/.config/xangi/secrets.json ]] &&
  grep -q 'DISCORD_TOKEN' /home/gdgagent-svc/.config/xangi/secrets.json; then
  echo "Refusing to start: the local VM must not contain a Discord bot token." >&2
  exit 1
fi
install -d -m 0755 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/systemd/user/xangi.service.d
install -m 0644 -o gdgagent-svc -g gdgagent-svc /dev/stdin /home/gdgagent-svc/.config/systemd/user/xangi.service.d/harness.conf <<EOF
[Service]
Environment=GDG_AGENT_HARNESS=true
Environment=SCHEDULER_ENABLED=false
Environment=XANGI_AGENT_SLOT_COUNT=${slot_count}
Environment=GDG_WIKI_LOCK_OWNER=lima-gdg-agent
EOF
svc_uid=$(id -u gdgagent-svc)
sudo -u gdgagent-svc XDG_RUNTIME_DIR="/run/user/$svc_uid" systemctl --user daemon-reload
echo "==> Provisioning complete. Run /opt/gdgjp/agent-host/dev/activate.sh on a TTY to authenticate and start xangi."
