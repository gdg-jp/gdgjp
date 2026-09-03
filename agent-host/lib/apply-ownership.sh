#!/usr/bin/env bash
# Live-path chown/chmod for Stage 07. Root only. Idempotent.
# Sourced by install.sh and setup.sh (not executed).
gdg_agent_apply_ownership() {
  local here spec_file slot_count agent_root wiki_root run_root
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  spec_file="${GDG_SPEC:-$here/../agent-host.json}"
  slot_count="${1:-${GDG_AGENT_SLOT_COUNT:-${SPEC_SLOT_COUNT:-}}}"
  agent_root="${GDG_SETUP_AGENT_ROOT:-${SPEC_AGENT_ROOT:-}}"
  wiki_root="${GDG_SETUP_WIKI_ROOT:-${SPEC_WORKSPACE:-}}"
  run_root="${GDG_SETUP_RUN_ROOT:-${SPEC_RUN_ROOT:-}}"

  if [[ -z "$slot_count" || -z "$agent_root" || -z "$wiki_root" || -z "$run_root" ]]; then
    if [[ ! -f "$spec_file" ]]; then
      echo "spec file not found: $spec_file" >&2
      exit 1
    fi
    eval "$(node -e '
      const fs = require("fs");
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (typeof s.slotCount !== "number" || !s.paths?.agentRoot || !s.paths?.workspace || !s.paths?.runRoot) {
        console.error("Invalid spec at " + process.argv[1]);
        process.exit(1);
      }
      process.stdout.write(`spec_slots=${s.slotCount}\nspec_agent=${JSON.stringify(s.paths.agentRoot)}\nspec_wiki=${JSON.stringify(s.paths.workspace)}\nspec_run=${JSON.stringify(s.paths.runRoot)}\n`);
    ' "$spec_file")"
    slot_count="${slot_count:-$spec_slots}"
    agent_root="${agent_root:-$spec_agent}"
    wiki_root="${wiki_root:-$spec_wiki}"
    run_root="${run_root:-$spec_run}"
  fi

  if [[ -n "${GDG_SETUP_PREFIX:-}" || "$(id -u)" -ne 0 ]]; then
    return 0
  fi
  echo "==> ownership + linger"
  chown -R root:root "$agent_root"
  find "$agent_root/lib" "$agent_root/package.json" -type f -exec chmod 0444 {} +
  chmod 0755 "$agent_root" "$agent_root/bin" "$agent_root/lib"
  chmod 0755 "$agent_root/bin/wk" "$agent_root"/bin/spawn-slot-* "$agent_root/bin/index-proxy" \
    2>/dev/null || true
  install -d -m 2770 -o gdgagent-svc -g gdgwiki "$wiki_root"
  chgrp -R gdgwiki "$wiki_root"
  find "$wiki_root" -type d -exec chmod 2770 {} +
  install -d -m 0755 -o gdgagent-svc -g gdgagent-svc "$run_root"
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
    chown root:root "/home/gdgagent-run-${slot}/.cursor"/{hooks,sandbox,mcp,permissions}.json
    chmod 0444 "/home/gdgagent-run-${slot}/.cursor"/{hooks,sandbox,mcp,permissions}.json
    chown "gdgagent-run-${slot}:gdgagent-run-${slot}" \
      "/home/gdgagent-run-${slot}/.cursor/cli-config.json"
    chmod 0644 "/home/gdgagent-run-${slot}/.cursor/cli-config.json"
    install -d -m 0750 -o gdgagent-svc -g "gdgagent-run-${slot}" "${run_root}/${slot}"
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
