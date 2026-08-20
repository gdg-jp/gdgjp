#!/usr/bin/env bash
# Install the Stage 09 agents-index daemon on the self-hosted Ubuntu agent host.
#
# From a gdgjp checkout:
#   sudo ./agents-index/install.sh
#
# Prefix mode (layout only, no systemd, used by tests):
#   GDG_SETUP_PREFIX=/tmp/prefix GDG_SKIP_BUILD=1 ./agents-index/install.sh
#
# Does:
#   1. Resolve the gdgjp checkout that contains this script
#   2. pnpm install --filter @gdgjp/agents-index... (unless GDG_SKIP_BUILD=1)
#   3. Create /var/lib/agents-index (0700 gdgagent-svc) for index.db + HF cache
#   4. Install /opt/gdg-agent/bin/agents-index (node-native TypeScript launcher)
#   5. Install systemd system unit agents-index.service (gdgagent-svc + slot groups)
#   6. enable --now, unless GDG_SKIP_START=1
#
# Does not: create OS users, install index-proxy / slot mcp.json, or start xangi.
# Those come from agents-local/install.sh (Stage 07). This script fails live if
# gdgagent-svc is missing.
set -euo pipefail

SLOT_COUNT="${GDG_AGENT_SLOT_COUNT:-4}"
PREFIX="${GDG_SETUP_PREFIX:-}"
NODE_MAJOR_MIN=22
NODE_MINOR_MIN=18

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_ubuntu() {
  if [[ -n "$PREFIX" ]]; then
    return 0
  fi
  if [[ "$(uname -s)" != "Linux" ]] || [[ ! -r /etc/os-release ]]; then
    echo "install.sh supports Ubuntu only; no changes were made." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "install.sh supports Ubuntu only; no changes were made." >&2
    exit 1
  fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local ver major minor
  ver="$(node -v | sed 's/^v//')"
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  ((major > NODE_MAJOR_MIN || (major == NODE_MAJOR_MIN && minor >= NODE_MINOR_MIN)))
}

maybe_reexec_root() {
  if [[ -n "$PREFIX" || "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  echo "==> re-exec as root"
  exec sudo --preserve-env=GDGJP_ROOT,GDG_AGENT_SLOT_COUNT,GDG_SETUP_PREFIX,GDG_SKIP_BUILD,GDG_SKIP_START,GDG_INDEX_WIKI_ROOT,GDG_INDEX_RUN_ROOT,PATH \
    "$0" "$@"
}

resolve_gdgjp() {
  if [[ -n "${GDGJP_ROOT:-}" && -f "${GDGJP_ROOT}/agents-index/src/cli.ts" ]]; then
    cd "$GDGJP_ROOT" && pwd
    return
  fi
  if [[ -f "$here/src/cli.ts" && -f "$here/../pnpm-workspace.yaml" ]]; then
    cd "$here/.." && pwd
    return
  fi
  echo "GDGJP_ROOT must point at a gdgjp checkout (agents-index/src/cli.ts)." >&2
  exit 1
}

slot_groups() {
  local slot groups=""
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    groups+=" gdgagent-run-${slot}"
  done
  printf '%s\n' "${groups# }"
}

write_launcher() {
  local dest="$1"
  local pkg="$2"
  install -d -m 0755 "$(dirname "$dest")"
  cat > "$dest" <<EOF
#!/bin/sh
set -eu
cd "$pkg"
exec /usr/bin/node "$pkg/src/cli.ts" "\$@"
EOF
  chmod 0755 "$dest"
}

write_unit() {
  local dest="$1"
  local launcher="$2"
  local wiki="$3"
  local run_root="$4"
  local db="$5"
  local hf="$6"
  local groups
  groups="$(slot_groups)"
  install -d -m 0755 "$(dirname "$dest")"
  cat > "$dest" <<EOF
[Unit]
Description=GDG agents-index (ACL-filtered wiki search)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gdgagent-svc
Group=gdgagent-svc
SupplementaryGroups=gdgwiki ${groups}
WorkingDirectory=/
ExecStart=${launcher} watch --root ${wiki} --run-root ${run_root} --slots ${SLOT_COUNT} --db ${db}
Environment=HF_HOME=${hf}
Environment=HOME=/home/gdgagent-svc
Restart=on-failure
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$dest"
}

install_deps() {
  local root="$1"
  if [[ "${GDG_SKIP_BUILD:-}" == 1 ]]; then
    echo "    skip pnpm install (GDG_SKIP_BUILD=1)"
    return
  fi
  echo "==> pnpm install @gdgjp/agents-index"
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required to install agents-index dependencies." >&2
    exit 1
  fi
  (
    cd "$root"
    pnpm install --frozen-lockfile --filter @gdgjp/agents-index...
  )
}

require_layout() {
  if [[ -n "$PREFIX" ]]; then
    return 0
  fi
  if ! id gdgagent-svc >/dev/null 2>&1; then
    echo "gdgagent-svc does not exist. Run agents-local/install.sh first." >&2
    exit 1
  fi
  if [[ ! -x /opt/gdg-agent/bin/index-proxy ]]; then
    echo "missing /opt/gdg-agent/bin/index-proxy. Run agents-local/setup.sh first." >&2
    exit 1
  fi
}

create_db_dir() {
  local dir="$1"
  if [[ -n "$PREFIX" ]]; then
    install -d -m 0700 "$dir"
    return
  fi
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc "$dir"
  chmod 0700 "$dir"
  if [[ -e "$dir/index.db" ]]; then
    chown gdgagent-svc:gdgagent-svc "$dir/index.db"
    chmod 0600 "$dir/index.db"
  fi
}

add_svc_slot_groups() {
  [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]] || return 0
  local slot
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    getent group "gdgagent-run-${slot}" >/dev/null 2>&1 || continue
    usermod -aG "gdgagent-run-${slot}" gdgagent-svc || true
  done
  getent group gdgwiki >/dev/null 2>&1 && usermod -aG gdgwiki gdgagent-svc || true
}

enable_unit() {
  local unit_path="$1"
  if [[ -n "$PREFIX" || "${GDG_SKIP_START:-}" == 1 ]]; then
    echo "    skip systemd enable (prefix or GDG_SKIP_START=1)"
    return
  fi
  if [[ -d /run/gdg-agent ]] && [[ -f /etc/tmpfiles.d/gdg-agent.conf ]]; then
    systemd-tmpfiles --create /etc/tmpfiles.d/gdg-agent.conf || true
  fi
  systemctl daemon-reload
  systemctl enable --now "$(basename "$unit_path")"
}

main() {
  require_ubuntu
  maybe_reexec_root "$@"
  if ! node_ok; then
    echo "Node ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN}.0+ is required (found: $(command -v node >/dev/null && node -v || echo none))." >&2
    exit 1
  fi
  if ! [[ "$SLOT_COUNT" =~ ^[1-9][0-9]*$ ]] || ((SLOT_COUNT > 32)); then
    echo "GDG_AGENT_SLOT_COUNT must be an integer from 1 to 32." >&2
    exit 1
  fi

  local gdgjp pkg wiki run_root db_dir hf_dir launcher unit
  gdgjp="$(resolve_gdgjp)"
  pkg="$gdgjp/agents-index"
  wiki="${GDG_INDEX_WIKI_ROOT:-${PREFIX}/srv/gdg-agent/wiki}"
  run_root="${GDG_INDEX_RUN_ROOT:-${PREFIX}/run/gdg-agent}"
  db_dir="${PREFIX}/var/lib/agents-index"
  hf_dir="$db_dir/hf"
  launcher="${PREFIX}/opt/gdg-agent/bin/agents-index"
  unit="${PREFIX}/etc/systemd/system/agents-index.service"

  echo "==> gdgjp checkout $gdgjp"
  if [[ -z "$PREFIX" && "$gdgjp" == /home/* ]]; then
    echo "    warning: unit will ExecStart from an operator tree. Set GDGJP_ROOT=/opt/gdgjp after copying sources there if this is not intended."
  fi
  require_layout
  install_deps "$gdgjp"
  echo "==> database dir $db_dir"
  create_db_dir "$db_dir"
  create_db_dir "$hf_dir"
  echo "==> launcher $launcher"
  write_launcher "$launcher" "$pkg"
  if [[ -z "$PREFIX" ]]; then
    chown root:root "$launcher"
    chmod 0755 "$launcher"
  fi
  echo "==> systemd unit $unit"
  write_unit "$unit" "$launcher" "$wiki" "$run_root" "$db_dir/index.db" "$hf_dir"
  add_svc_slot_groups
  enable_unit "$unit"
  echo
  echo "Installed agents-index."
  echo "  wiki     $wiki"
  echo "  db       $db_dir/index.db"
  echo "  sockets  $run_root/<slot>/index.sock"
  echo "  unit     $unit"
}

main "$@"
