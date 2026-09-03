#!/usr/bin/env bash
# Host verification checks relocated from setup.sh (Stage 04 -> Stage 07 Go verify).
set -euo pipefail

PREFIX="${GDG_SETUP_PREFIX:-}"
if [[ -n "$PREFIX" ]]; then
  echo "verify.sh: prefix mode active ($PREFIX); skipping live host checks."
  exit 0
fi

echo "==> Verification (expect fail/success as labelled)"
run_check() {
  local expect="$1"
  shift
  if "$@"; then
    if [[ "$expect" == ok ]]; then echo "    OK  $*"; else echo "    FAIL expected failure: $*" >&2; return 1; fi
  else
    if [[ "$expect" == fail ]]; then echo "    OK  (failed as required) $*"; else echo "    FAIL expected success: $*" >&2; return 1; fi
  fi
}
if id gdgagent-run-0 >/dev/null 2>&1; then
  run_check fail sudo -u gdgagent-run-0 cat /home/gdgagent-svc/.config/gdg/credentials.json
  run_check ok sudo -u gdgagent-run-0 test -w /srv/gdg-agent/wiki
  run_check ok sudo -u gdgagent-svc test -w /srv/gdg-agent/wiki
  if [[ -e /run/gdg-agent/1/authz.sock ]]; then
    run_check fail sudo -u gdgagent-run-0 test -r /run/gdg-agent/1/authz.sock
  fi
  run_check fail sudo -u gdgagent-run-0 test -w /opt/gdg-agent/bin/wk
  run_check fail sudo -u gdgagent-run-0 test -w /opt/gdg-agent/lib/wk.ts
  run_check fail sudo -u gdgagent-run-0 test -w /opt/gdg-agent/package.json
  run_check ok sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/projects
  run_check fail sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/mcp.json
  run_check ok sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/cli-config.json
  run_check fail sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/sandbox.json
  run_check fail sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/hooks.json
  data_dir="${DATA_DIR:-/home/gdgagent-svc/.local/share/xangi}"
  if [[ -d "$data_dir" ]]; then
    run_check fail sudo -u gdgagent-run-0 test -r "$data_dir"
  fi
  if [[ -d /srv/gdg-agent/wiki/.xangi ]]; then
    echo "    FAIL dataDir must not live under the wiki worktree" >&2
    exit 1
  fi
  if [[ -d /srv/gdg-agent/wiki/speech || -d /srv/gdg-agent/wiki/logs/sessions ]]; then
    echo "    FAIL conversation logs must not live under the wiki worktree" >&2
    exit 1
  fi
else
  echo "    skip live uid checks until OS users exist"
fi
