#!/usr/bin/env bash
# Bootstrap the self-hosted Ubuntu agent host (Stage 00–07).
#
# Automated:
#   1. Install gdg CLI if missing
#   2. Install Cursor CLI + xangi if missing
#   3. Generate /opt/gdg-agent, per-slot ~/.cursor, sudoers, tmpfiles (needs root
#      for the live paths; prefix mode is used by tests)
#
# Not automated (printed at the end, even when this script is root):
#   - OS user/group creation (`useradd` / `groupadd`) and live-path chown
#   - `xangi setup` / `xangi service start` as gdgagent-svc
#   - linger for the systemd --user session
# For a zero-from-scratch host, run install.sh instead — it clones gdgjp,
# builds acl.ts, creates users, then calls this script.
# Root only auto-runs visudo + systemd-tmpfiles when gdgagent-svc already exists.
set -euo pipefail

PREFIX="${GDG_SETUP_PREFIX:-}"
if [[ -z "$PREFIX" ]]; then
  if [ "$(uname -s)" != "Linux" ] || ! grep -qs '^ID=ubuntu$' /etc/os-release; then
    echo "agent-host/setup.sh supports Ubuntu only; no changes were made." >&2
    exit 1
  fi
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"
SLOT_COUNT="${GDG_AGENT_SLOT_COUNT:-4}"

echo "==> [1/3] gdg CLI"
if command -v gdg >/dev/null 2>&1; then
  echo "    gdg already installed: $(command -v gdg)"
elif [[ "${GDG_SKIP_GDG_INSTALL:-}" == 1 ]]; then
  echo "    skipping gdg install (GDG_SKIP_GDG_INSTALL=1)"
else
  echo "    installing gdg CLI from url.gdgs.jp/cli/install.sh"
  curl -fsSL https://url.gdgs.jp/cli/install.sh | sh
  install_dir="$HOME/.local/bin"
  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      echo "    adding $install_dir to PATH for this script"
      export PATH="$install_dir:$PATH"
      ;;
  esac
  command -v gdg >/dev/null 2>&1 || {
    echo "gdg CLI install did not put 'gdg' on PATH; add $install_dir to PATH and re-run." >&2
    exit 1
  }
fi

echo "==> [2/3] xangi prerequisites + binary"
if command -v xangi >/dev/null 2>&1; then
  echo "    xangi already installed: $(command -v xangi)"
elif [[ "${GDG_SKIP_XANGI_INSTALL:-}" == 1 ]]; then
  echo "    skipping xangi install (GDG_SKIP_XANGI_INSTALL=1); use harineko0/xangi"
else
  echo "    installing Cursor CLI + upstream xangi (not the GDG fork)"
  curl -fsSL https://github.com/karaage0703/xangi/releases/latest/download/setup-ai-tools.sh | bash -s -- cursor
  curl -fsSL https://github.com/karaage0703/xangi/releases/latest/download/install.sh | bash
fi

echo "==> [3/3] uid-isolation layout"
hooks_src="${GDG_SETUP_HOOKS_SRC:-}"
if [[ -z "$hooks_src" ]]; then
  if [[ -f "$script_dir/../cli/internal/wiki/hooks/acl-gate.ts" ]]; then
    hooks_src="$(cd "$script_dir/../cli/internal/wiki/hooks" && pwd)"
  elif [[ -f /opt/gdg-agent/lib/acl-gate.ts ]]; then
    hooks_src=/opt/gdg-agent/lib
  else
    echo "Set GDG_SETUP_HOOKS_SRC to cli/internal/wiki/hooks (after pnpm build:acl)." >&2
    exit 1
  fi
fi
index_proxy="${GDG_SETUP_INDEX_PROXY_SRC:-}"
if [[ -z "$index_proxy" && -f "$script_dir/../agents-index/src/proxy.ts" ]]; then
  index_proxy="$(cd "$script_dir/../agents-index/src" && pwd)/proxy.ts"
fi

GDG_AGENT_SLOT_COUNT="$SLOT_COUNT" \
  GDG_SETUP_PREFIX="$PREFIX" \
  GDG_SETUP_HOOKS_SRC="$hooks_src" \
  GDG_SETUP_INDEX_PROXY_SRC="$index_proxy" \
  "$script_dir/lib/install-layout.sh"

# shellcheck source=lib/apply-ownership.sh
. "$script_dir/lib/apply-ownership.sh"

if [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]]; then
  visudo -c -f /etc/sudoers.d/gdg-agent
  if id gdgagent-svc >/dev/null 2>&1 && getent group gdgagent-svc >/dev/null 2>&1; then
    systemd-tmpfiles --create /etc/tmpfiles.d/gdg-agent.conf
  else
    echo "    skip systemd-tmpfiles until user and group gdgagent-svc exist (run install.sh)"
  fi
  if id gdgagent-run-0 >/dev/null 2>&1 && getent group gdgwiki >/dev/null 2>&1; then
    gdg_agent_apply_ownership "$SLOT_COUNT"
  fi
fi

echo
echo "==> Privileged OS steps (printed only; this script never runs useradd/chown)."
cat <<EOF
groupadd --system gdgwiki || true
groupadd --system gdgagent-svc || true
id gdgagent-svc >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/gdgagent-svc --gid gdgagent-svc --groups gdgwiki --shell /usr/sbin/nologin gdgagent-svc
usermod -g gdgagent-svc gdgagent-svc || true
usermod -aG gdgwiki gdgagent-svc || true
for slot in \$(seq 0 $((SLOT_COUNT - 1))); do
  groupadd --system "gdgagent-run-\${slot}" || true
  id "gdgagent-run-\${slot}" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/gdgagent-run-\${slot}" --gid "gdgagent-run-\${slot}" --groups gdgwiki --shell /usr/sbin/nologin "gdgagent-run-\${slot}"
  usermod -aG gdgwiki "gdgagent-run-\${slot}" || true
done
chown -R root:root /opt/gdg-agent
find /opt/gdg-agent/lib /opt/gdg-agent/package.json -type f -exec chmod 0444 {} +
chmod 0755 /opt/gdg-agent /opt/gdg-agent/bin /opt/gdg-agent/lib
chmod 0755 /opt/gdg-agent/bin/wk /opt/gdg-agent/bin/spawn-slot-* /opt/gdg-agent/bin/index-proxy 2>/dev/null || true
install -d -m 2770 -o gdgagent-svc -g gdgwiki /srv/gdg-agent/wiki
chgrp -R gdgwiki /srv/gdg-agent/wiki
find /srv/gdg-agent/wiki -type d -exec chmod 2770 {} +
install -d -m 0755 -o gdgagent-svc -g gdgagent-svc /run/gdg-agent
for slot in \$(seq 0 $((SLOT_COUNT - 1))); do
  install -d -m 0750 -o root -g "gdgagent-run-\${slot}" "/home/gdgagent-run-\${slot}"
  install -d -m 0700 -o "gdgagent-run-\${slot}" -g "gdgagent-run-\${slot}" "/home/gdgagent-run-\${slot}/.config/cursor"
  install -d -m 0700 -o "gdgagent-run-\${slot}" -g "gdgagent-run-\${slot}" "/home/gdgagent-run-\${slot}/.cache" "/home/gdgagent-run-\${slot}/.local/share"
  install -d -m 1775 -o root -g "gdgagent-run-\${slot}" "/home/gdgagent-run-\${slot}/.cursor"
  install -d -m 0755 -o "gdgagent-run-\${slot}" -g "gdgagent-run-\${slot}" "/home/gdgagent-run-\${slot}/.cursor/projects"
  chown root:root /home/gdgagent-run-\${slot}/.cursor/{hooks,sandbox,mcp}.json
  chmod 0444 /home/gdgagent-run-\${slot}/.cursor/{hooks,sandbox,mcp}.json
  chown "gdgagent-run-\${slot}:gdgagent-run-\${slot}" /home/gdgagent-run-\${slot}/.cursor/cli-config.json
  chmod 0644 /home/gdgagent-run-\${slot}/.cursor/cli-config.json
  install -d -m 0750 -o gdgagent-svc -g "gdgagent-run-\${slot}" "/run/gdg-agent/\${slot}"
done
install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/gdg
install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/xangi
chmod 0440 /etc/sudoers.d/gdg-agent
visudo -c -f /etc/sudoers.d/gdg-agent
systemd-tmpfiles --create /etc/tmpfiles.d/gdg-agent.conf
loginctl enable-linger gdgagent-svc
EOF

if [[ -z "$PREFIX" ]]; then
  echo
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
    echo "    skip live uid checks until the useradd commands above have been run"
  fi
fi

if [[ "${GDG_SETUP_SKIP_REMAINING:-}" == 1 ]]; then
  :
else
  cat <<EOF

==> Remaining host activation:

1. sudo -u gdgagent-svc gdg login --device
2. sudo ./install.sh --activate

The activation stage clones /srv/gdg-agent/wiki when empty, seeds the Cursor
files, applies the xangi configuration, and starts xangi only when secrets.json
contains DISCORD_TOKEN.

Cursor sandbox (mode=enabled, readBoundary=workspace) is an undocumented
setting. Pin the cursor-agent version and re-run ingest after upgrades.

Workdir-internal ACL is not an OS sandbox boundary. The preToolUse gate and
wk remain required even after uid isolation.
EOF
fi
