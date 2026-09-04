#!/usr/bin/env bash
# Run inside the Lima VM as root. Invokes the declarative Go converger with the dev overlay.
set -euo pipefail

readonly source_root=/mnt/gdgjp-src
readonly target_root=/opt/gdgjp
readonly xangi_source=/mnt/xangi-src
readonly xangi_target=/opt/xangi

[[ $EUID -eq 0 ]] || { echo "Run with sudo inside the VM." >&2; exit 1; }
[[ -f "$source_root/scripts/install-gdg-agent-host.sh" ]] || { echo "Missing read-only gdgjp mount: $source_root" >&2; exit 1; }
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

readonly spec="$target_root/agent-host/agent-host.json"
readonly overlay="$target_root/agent-host/agent-host.dev.json"

# Ensure gdg binary exists
if ! command -v gdg >/dev/null 2>&1; then
  "$target_root/scripts/install-gdg-agent-host.sh" --spec "$spec" --overlay "$overlay" --dry-run || true
fi

# Apply declarative state with dev overlay
gdg agent-host apply --spec "$spec" --overlay "$overlay"

# Verify that local VM does not contain production bot token
if [[ -s /home/gdgagent-svc/.config/xangi/secrets.json ]] &&
  grep -q 'DISCORD_TOKEN' /home/gdgagent-svc/.config/xangi/secrets.json; then
  echo "Refusing to start: the local VM must not contain a Discord bot token." >&2
  exit 1
fi

# Run verification checks
gdg agent-host verify --spec "$spec" --overlay "$overlay"

# Verify that local VM does not contain production bot token
if [[ -s /home/gdgagent-svc/.config/xangi/secrets.json ]] &&
  grep -q 'DISCORD_TOKEN' /home/gdgagent-svc/.config/xangi/secrets.json; then
  echo "Refusing to start: the local VM must not contain a Discord bot token." >&2
  exit 1
fi

echo "==> Provisioning complete. Run /opt/gdgjp/agent-host/dev/activate.sh on a TTY to authenticate and start xangi."
