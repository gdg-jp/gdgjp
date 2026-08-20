#!/usr/bin/env bash
# Zero-from-scratch Ubuntu host install for the self-hosted GDG agent.
#
# Canonical entry (gdgjp is a real file, not a submodule gitlink):
#   curl -fsSL https://raw.githubusercontent.com/gdg-jp/gdgjp/main/scripts/install-gdg-agent-host.sh | sudo bash
#
# From a checkout:
#   sudo ./agents-local/install.sh
#   sudo ./scripts/install-gdg-agent-host.sh
#
# Does:
#   1. Clone or reuse the gdgjp monorepo (hooks live there, not in agents.git)
#   2. Ensure Node 22.18+, pnpm, git
#   3. pnpm --filter @gdgjp/gdg-lib build:acl
#   4. Create gdgwiki / gdgagent-svc / gdgagent-run-* (live root only)
#   5. Run setup.sh for /opt/gdg-agent layout
#   6. chown / linger / tmpfiles
#
# Does not (interactive / policy):
#   - Switch xangi to harineko0/xangi
#   - gdg login, wiki clone into /srv, xangi setup, Discord token
set -euo pipefail

SLOT_COUNT="${GDG_AGENT_SLOT_COUNT:-4}"
PREFIX="${GDG_SETUP_PREFIX:-}"
GDGJP_REPO="${GDGJP_REPO:-https://github.com/gdg-jp/gdgjp.git}"
GDGJP_REF="${GDGJP_REF:-main}"
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

resolve_layout_dir() {
  if [[ -x "$here/setup.sh" && -f "$here/lib/install-layout.sh" ]]; then
    printf '%s\n' "$here"
  elif [[ -x "$here/../agents-local/setup.sh" ]]; then
    cd "$here/../agents-local" && pwd
  else
    printf '%s\n' ""
  fi
}

resolve_gdgjp() {
  if [[ -n "${GDGJP_ROOT:-}" && -f "${GDGJP_ROOT}/cli/internal/wiki/hooks/acl-gate.ts" ]]; then
    cd "$GDGJP_ROOT" && pwd
    return
  fi
  if [[ -f "$here/../cli/internal/wiki/hooks/acl-gate.ts" ]]; then
    cd "$here/.." && pwd
    return
  fi
  printf '%s\n' ""
}

ensure_gdgjp() {
  local detected
  detected="$(resolve_gdgjp)"
  if [[ -n "$detected" ]]; then
    printf '%s\n' "$detected"
    return
  fi
  if [[ "${GDG_SKIP_CLONE:-}" == 1 ]]; then
    echo "GDGJP_ROOT must point at a gdgjp checkout (cli/internal/wiki/hooks)." >&2
    exit 1
  fi
  if [[ -n "$PREFIX" ]]; then
    echo "prefix mode cannot clone; set GDGJP_ROOT or run from a gdgjp checkout." >&2
    exit 1
  fi
  local dest="${GDGJP_ROOT:-/opt/gdgjp}"
  if [[ ! -f "$dest/cli/internal/wiki/hooks/acl-gate.ts" ]]; then
    echo "==> clone $GDGJP_REPO ($GDGJP_REF) -> $dest"
    if [[ ! -d "$dest/.git" ]]; then
      git clone --depth 1 --branch "$GDGJP_REF" "$GDGJP_REPO" "$dest"
    fi
    git -C "$dest" submodule update --init agents-local
  fi
  if [[ ! -f "$dest/cli/internal/wiki/hooks/acl-gate.ts" ]]; then
    echo "clone at $dest is missing cli/internal/wiki/hooks" >&2
    exit 1
  fi
  printf '%s\n' "$dest"
}

install_apt_packages() {
  [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]] || return 0
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates curl
}

install_node_if_needed() {
  if node_ok; then
    echo "    node $(node -v)"
    return
  fi
  if [[ "${GDG_SKIP_NODE_INSTALL:-}" == 1 || -n "$PREFIX" || "$(id -u)" -ne 0 ]]; then
    echo "Node ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN}.0+ is required (found: $(command -v node >/dev/null && node -v || echo none))." >&2
    exit 1
  fi
  echo "==> install Node.js 22.x"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  node_ok || {
    echo "Node ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN}.0+ is still missing after install." >&2
    exit 1
  }
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    echo "    pnpm $(pnpm --version)"
    return
  fi
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
  command -v pnpm >/dev/null 2>&1 || {
    echo "pnpm is not on PATH after corepack prepare." >&2
    exit 1
  }
}

build_acl() {
  local root="$1"
  if [[ "${GDG_SKIP_BUILD:-}" == 1 ]]; then
    echo "    skip build:acl"
    return
  fi
  echo "==> pnpm build:acl"
  (
    cd "$root"
    ensure_pnpm
    pnpm install --frozen-lockfile --filter @gdgjp/gdg-lib...
    pnpm --filter @gdgjp/gdg-lib build:acl
  )
  if [[ ! -f "$root/cli/internal/wiki/hooks/acl.ts" ]]; then
    echo "build:acl did not write cli/internal/wiki/hooks/acl.ts" >&2
    exit 1
  fi
}

create_users() {
  [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]] || return 0
  echo "==> OS users"
  groupadd --system gdgwiki || true
  id gdgagent-svc >/dev/null 2>&1 ||
    useradd --system --create-home --home-dir /home/gdgagent-svc --gid gdgwiki \
      --shell /usr/sbin/nologin gdgagent-svc
  usermod -aG gdgwiki gdgagent-svc || true
  local slot
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    groupadd --system "gdgagent-run-${slot}" || true
    id "gdgagent-run-${slot}" >/dev/null 2>&1 ||
      useradd --system --create-home --home-dir "/home/gdgagent-run-${slot}" \
        --gid "gdgagent-run-${slot}" --groups gdgwiki --shell /usr/sbin/nologin \
        "gdgagent-run-${slot}"
    usermod -aG gdgwiki "gdgagent-run-${slot}" || true
  done
}

apply_ownership() {
  [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]] || return 0
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
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    install -d -m 0750 -o root -g "gdgagent-run-${slot}" "/home/gdgagent-run-${slot}"
    install -d -m 0755 -o root -g "gdgagent-run-${slot}" "/home/gdgagent-run-${slot}/.cursor"
    chown root:root /home/gdgagent-run-${slot}/.cursor/{hooks,cli-config,sandbox,mcp}.json
    chmod 0444 /home/gdgagent-run-${slot}/.cursor/{hooks,cli-config,sandbox,mcp}.json
    install -d -m 0750 -o gdgagent-svc -g "gdgagent-run-${slot}" "/run/gdg-agent/${slot}"
  done
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/gdg
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/xangi
  chmod 0440 /etc/sudoers.d/gdg-agent
  visudo -c -f /etc/sudoers.d/gdg-agent
  systemd-tmpfiles --create /etc/tmpfiles.d/gdg-agent.conf
  loginctl enable-linger gdgagent-svc
}

maybe_reexec_root() {
  if [[ -n "$PREFIX" || "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  echo "==> re-exec as root"
  exec sudo --preserve-env=GDGJP_ROOT,GDGJP_REPO,GDGJP_REF,GDG_AGENT_SLOT_COUNT,GDG_SETUP_PREFIX,GDG_SETUP_HOOKS_SRC,GDG_SETUP_INDEX_PROXY_SRC,GDG_SKIP_BUILD,GDG_SKIP_CLONE,GDG_SKIP_XANGI_INSTALL,GDG_SKIP_NODE_INSTALL,GDG_SKIP_GDG_INSTALL,PATH \
    "$0" "$@"
}

print_remaining() {
  cat <<EOF

==> Remaining (not automated):

1. Install the harineko0/xangi fork (not karaage0703/xangi). This script does not
   replace an existing /usr/bin or ~/.local/bin xangi.
2. sudo -u gdgagent-svc gdg login --device
3. sudo -u gdgagent-svc gdg wiki clone /srv/gdg-agent/wiki   # if empty
4. sudo -u gdgagent-svc xangi setup
     workspace : /srv/gdg-agent/wiki
     backend   : cursor
     model     : composer-2.5
     chat      : discord
5. sudo -u gdgagent-svc xangi service start

Wiki Cloudflare deploy (inline source API + D1 migration) is separate from this host.
EOF
}

if [[ -n "$PREFIX" ]]; then
  GDG_SKIP_GDG_INSTALL="${GDG_SKIP_GDG_INSTALL:-1}"
  GDG_SKIP_XANGI_INSTALL="${GDG_SKIP_XANGI_INSTALL:-1}"
  GDG_SKIP_NODE_INSTALL="${GDG_SKIP_NODE_INSTALL:-1}"
fi

require_ubuntu
maybe_reexec_root "$@"

layout_dir="$(resolve_layout_dir)"
gdgjp="$(ensure_gdgjp)"
if [[ -z "$layout_dir" && -x "$gdgjp/agents-local/setup.sh" ]]; then
  layout_dir="$gdgjp/agents-local"
fi
if [[ -z "$layout_dir" || ! -x "$layout_dir/setup.sh" ]]; then
  echo "cannot find agents-local/setup.sh next to $here or under $gdgjp" >&2
  exit 1
fi

hooks_src="${GDG_SETUP_HOOKS_SRC:-$gdgjp/cli/internal/wiki/hooks}"
index_proxy="${GDG_SETUP_INDEX_PROXY_SRC:-$gdgjp/agents-index/src/proxy.ts}"

echo "==> gdgjp checkout: $gdgjp"
echo "==> agents-local: $layout_dir"

if [[ -z "$PREFIX" ]]; then
  install_apt_packages
  install_node_if_needed
fi
build_acl "$gdgjp"

if [[ ! -f "$hooks_src/acl-gate.ts" || ! -f "$hooks_src/wk.ts" ]]; then
  echo "GDG_SETUP_HOOKS_SRC must point at cli/internal/wiki/hooks ($hooks_src)" >&2
  exit 1
fi
if [[ ! -f "$hooks_src/acl.ts" ]]; then
  echo "missing $hooks_src/acl.ts; build:acl failed or GDG_SKIP_BUILD=1 without a bundle." >&2
  exit 1
fi
if [[ ! -f "$index_proxy" ]]; then
  echo "GDG_SETUP_INDEX_PROXY_SRC must point at agents-index/src/proxy.ts ($index_proxy)" >&2
  exit 1
fi

create_users

echo "==> setup.sh (layout)"
GDG_AGENT_SLOT_COUNT="$SLOT_COUNT" \
  GDG_SETUP_PREFIX="$PREFIX" \
  GDG_SETUP_HOOKS_SRC="$hooks_src" \
  GDG_SETUP_INDEX_PROXY_SRC="$index_proxy" \
  GDG_SKIP_XANGI_INSTALL="${GDG_SKIP_XANGI_INSTALL:-1}" \
  GDG_SKIP_GDG_INSTALL="${GDG_SKIP_GDG_INSTALL:-}" \
  "$layout_dir/setup.sh"

apply_ownership
print_remaining
