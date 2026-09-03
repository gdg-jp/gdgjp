#!/usr/bin/env bash
# Live-path chown/chmod for Stage 07. Root only. Idempotent.
# Sourced by install.sh and setup.sh (not executed).
gdg_agent_apply_ownership() {
  local slot_count="${1:-${GDG_AGENT_SLOT_COUNT:-4}}"
  if [[ -n "${GDG_SETUP_PREFIX:-}" || "$(id -u)" -ne 0 ]]; then
    return 0
  fi
  echo "==> ownership + linger"
  chown -R root:root /opt/gdg-agent
  find /opt/gdg-agent/lib /opt/gdg-agent/package.json -type f -exec chmod 0444 {} +
  chmod 0755 /opt/gdg-agent /opt/gdg-agent/bin /opt/gdg-agent/lib
  chmod 0755 /opt/gdg-agent/bin/wk /opt/gdg-agent/bin/spawn-slot-* /opt/gdg-agent/bin/index-proxy \
    2>/dev/null || true
  install -d -m 2770 -o gdgagent-svc -g gdgwiki /srv/gdg-agent/wiki
  chgrp -R gdgwiki /srv/gdg-agent/wiki
  find /srv/gdg-agent/wiki -type d -exec chmod 2770 {} +
  install -d -m 0755 -o gdgagent-svc -g gdgagent-svc /run/gdg-agent
  local slot
  for slot in $(seq 0 $((slot_count - 1))); do
    install -d -m 0750 -o root -g "gdgagent-run-${slot}" "/home/gdgagent-run-${slot}"
    # Cursor's device-login flow writes auth.json itself. Provision the parent
    # even when there is no operator auth.json to copy (as in the Lima VM).
    install -d -m 0700 -o "gdgagent-run-${slot}" -g "gdgagent-run-${slot}" \
      "/home/gdgagent-run-${slot}/.config/cursor"
    install -d -m 0700 -o "gdgagent-run-${slot}" -g "gdgagent-run-${slot}" \
      "/home/gdgagent-run-${slot}/.cache" \
      "/home/gdgagent-run-${slot}/.local/share"
    install -d -m 1775 -o root -g "gdgagent-run-${slot}" "/home/gdgagent-run-${slot}/.cursor"
    install -d -m 0755 -o "gdgagent-run-${slot}" -g "gdgagent-run-${slot}" \
      "/home/gdgagent-run-${slot}/.cursor/projects"
    chown root:root /home/gdgagent-run-${slot}/.cursor/{hooks,sandbox,mcp,permissions}.json
    chmod 0444 /home/gdgagent-run-${slot}/.cursor/{hooks,sandbox,mcp,permissions}.json
    chown "gdgagent-run-${slot}:gdgagent-run-${slot}" \
      "/home/gdgagent-run-${slot}/.cursor/cli-config.json"
    chmod 0644 "/home/gdgagent-run-${slot}/.cursor/cli-config.json"
    install -d -m 0750 -o gdgagent-svc -g "gdgagent-run-${slot}" "/run/gdg-agent/${slot}"
  done
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/gdg
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/xangi
  chmod 0440 /etc/sudoers.d/gdg-agent
  visudo -c -f /etc/sudoers.d/gdg-agent
  systemd-tmpfiles --create /etc/tmpfiles.d/gdg-agent.conf
  local apparmor_src apparmor_dst
  apparmor_src="$(cd "$(dirname "${BASH_SOURCE[0]}")/../config" && pwd)/apparmor.d-cursor-agent-cursorsandbox"
  apparmor_dst=/etc/apparmor.d/cursor-agent-cursorsandbox
  if [[ -f "$apparmor_src" ]]; then
    install -m 0444 "$apparmor_src" "$apparmor_dst"
    if command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser -r "$apparmor_dst"
    fi
  fi
  loginctl enable-linger gdgagent-svc
}
