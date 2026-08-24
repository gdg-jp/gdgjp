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
#   7. Place gdg, Cursor CLI, Harineko0/xangi, runtime secrets, and systemd user unit
#   8. Activate when credentials are available (or on a TTY): login as svc, clone and seed wiki,
#      apply xangi configuration, and conditionally start the service
#
# Interactive only when secrets are missing (gdg device login, Discord token,
# Cursor auth). Discord Developer Portal intents cannot be set from this host.
set -euo pipefail

SLOT_COUNT="${GDG_AGENT_SLOT_COUNT:-4}"
PREFIX="${GDG_SETUP_PREFIX:-}"
GDGJP_REPO="${GDGJP_REPO:-https://github.com/gdg-jp/gdgjp.git}"
GDGJP_REF="${GDGJP_REF:-main}"
NODE_MAJOR_MIN=22
NODE_MINOR_MIN=18
ACTIVATE_ONLY=0

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
  apt-get install -y -qq git ca-certificates curl unzip
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

GWS_VERSION="v0.22.5"
GWS_SHA256_X86_64_LINUX="de78ecdbd2f1a84cca0063a7ecbc440240fc14b6ebccbb17f4646b792a8c5c1f"
GWS_SHA256_AARCH64_LINUX="94490295d9580e1e88574e715a0a162991747d12d62f8c7b8dcc8268b6c1cea0"

ensure_gws() {
  local dest="/opt/gdg-agent/bin/gws-bin"
  # gws prints exactly "gws <CARGO_PKG_VERSION>" for --version (no "v" prefix,
  # unlike the release tag): verified against crates/google-workspace-cli/src/main.rs.
  local want="gws ${GWS_VERSION#v}"
  if [[ -x "$dest" ]]; then
    local have
    have="$("$dest" --version 2>/dev/null | head -n1 || true)"
    if [[ "$have" == "$want" ]]; then
      echo "    gws already installed: $have"
      return
    fi
    echo "    gws at $dest reports '$have', not the pinned '$want'; reinstalling"
  fi
  if [[ -n "$PREFIX" || "$(id -u)" -ne 0 ]]; then
    echo "gws $want is required at $dest; install it or unset GDG_SETUP_PREFIX to let install.sh fetch it." >&2
    exit 1
  fi
  local arch asset sha256
  arch="$(uname -m)"
  case "$arch" in
    x86_64)
      asset="google-workspace-cli-x86_64-unknown-linux-gnu.tar.gz"
      sha256="$GWS_SHA256_X86_64_LINUX"
      ;;
    aarch64)
      asset="google-workspace-cli-aarch64-unknown-linux-gnu.tar.gz"
      sha256="$GWS_SHA256_AARCH64_LINUX"
      ;;
    *)
      echo "unsupported architecture for gws: $arch" >&2
      exit 1
      ;;
  esac
  echo "==> install gws $GWS_VERSION ($arch) from GitHub Releases"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/gws.tar.gz" \
    "https://github.com/googleworkspace/cli/releases/download/${GWS_VERSION}/${asset}"
  echo "$sha256  $tmp/gws.tar.gz" | sha256sum -c -
  # Release members are stored as "./gws"; match by suffix since GNU tar's
  # default (anchored) extraction pattern won't match the "./" prefix.
  tar -xzf "$tmp/gws.tar.gz" -C "$tmp" --wildcards '*gws'
  install -d -m 0755 "$(dirname "$dest")"
  install -m 0755 "$tmp/gws" "$dest"
  rm -rf "$tmp"
  local installed
  installed="$("$dest" --version 2>/dev/null | head -n1 || true)"
  [[ "$installed" == "$want" ]] || {
    echo "gws did not install correctly at $dest (got '$installed', want '$want')" >&2
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
  # tmpfiles and private dirs use owner:group gdgagent-svc:gdgagent-svc.
  # --gid gdgwiki would skip creating that group (systemd-tmpfiles then fails).
  groupadd --system gdgwiki || true
  groupadd --system gdgagent-svc || true
  if ! id gdgagent-svc >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /home/gdgagent-svc --gid gdgagent-svc \
      --groups gdgwiki --shell /usr/sbin/nologin gdgagent-svc
  else
    usermod -g gdgagent-svc gdgagent-svc || true
    usermod -aG gdgwiki gdgagent-svc || true
  fi
  local slot
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    groupadd --system "gdgagent-run-${slot}" || true
    id "gdgagent-run-${slot}" >/dev/null 2>&1 ||
      useradd --system --create-home --home-dir "/home/gdgagent-run-${slot}" \
        --gid "gdgagent-run-${slot}" --groups gdgwiki --shell /usr/sbin/nologin \
        "gdgagent-run-${slot}"
    usermod -aG gdgwiki "gdgagent-run-${slot}" || true
  done
  local slot_groups=""
  for slot in $(seq 0 $((SLOT_COUNT - 1))); do
    slot_groups="${slot_groups},gdgagent-run-${slot}"
  done
  usermod -aG "${slot_groups#,}" gdgagent-svc || true
}

apply_ownership() {
  local src="$layout_dir/lib/apply-ownership.sh"
  if [[ ! -f "$src" ]]; then
    echo "missing $src" >&2
    return 1
  fi
  # shellcheck source=lib/apply-ownership.sh
  . "$src"
  gdg_agent_apply_ownership "$SLOT_COUNT"
}

maybe_reexec_root() {
  if [[ -n "$PREFIX" || "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  echo "==> re-exec as root"
  exec sudo --preserve-env=GDGJP_ROOT,GDGJP_REPO,GDGJP_REF,GDG_AGENT_SLOT_COUNT,GDG_SETUP_PREFIX,GDG_SETUP_HOOKS_SRC,GDG_SETUP_INDEX_PROXY_SRC,GDG_SKIP_BUILD,GDG_SKIP_CLONE,GDG_SKIP_XANGI_INSTALL,GDG_SKIP_NODE_INSTALL,GDG_SKIP_GDG_INSTALL,XANGI_REPO,PATH \
    "$0" "$@"
}

wiki_root() {
  printf '%s\n' "${PREFIX}/srv/gdg-agent/wiki"
}

operator_home() {
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    getent passwd "$SUDO_USER" | cut -d: -f6
  fi
}

svc_credentials_available() {
  local op_home
  [[ -s /home/gdgagent-svc/.config/gdg/credentials.json ]] && return 0
  op_home="$(operator_home)"
  [[ -n "$op_home" && -s "$op_home/.config/gdg/credentials.json" ]]
}

as_svc() {
  # runuser keeps the caller's cwd. sudo ./install.sh from an operator home
  # (typically 750) leaves gdgagent-svc in a directory it cannot chdir to;
  # tsx then spawn()s esbuild with that cwd and Node reports EACCES.
  local uid
  uid="$(id -u gdgagent-svc)"
  runuser -u gdgagent-svc -- env \
    HOME=/home/gdgagent-svc \
    USER=gdgagent-svc \
    LOGNAME=gdgagent-svc \
    PATH=/usr/local/bin:/usr/bin:/bin \
    TMPDIR=/tmp \
    XDG_CONFIG_HOME=/home/gdgagent-svc/.config \
    XDG_DATA_HOME=/home/gdgagent-svc/.local/share \
    XDG_RUNTIME_DIR="/run/user/${uid}" \
    bash -c 'cd "$HOME" && exec "$@"' bash "$@"
}

agents_local_src() {
  if [[ -f "$layout_dir/.cursor/mcp.json" && -f "$layout_dir/AGENTS.md" ]]; then
    printf '%s\n' "$layout_dir"
  elif [[ -f "$gdgjp/agents-local/.cursor/mcp.json" && -f "$gdgjp/agents-local/AGENTS.md" ]]; then
    printf '%s\n' "$gdgjp/agents-local"
  else
    echo "cannot find agents-local/.cursor/mcp.json and AGENTS.md" >&2
    exit 1
  fi
}

wiki_is_clone() {
  local wiki="$1"
  [[ -f "$wiki/.gdgwiki/config.json" || -d "$wiki/.git" || -f "$wiki/.git" ]]
}

refresh_wiki_ownership() {
  local wiki="$1"
  [[ -z "$PREFIX" ]] || return 0
  chown -R gdgagent-svc:gdgwiki "$wiki"
  find "$wiki" -type d -exec chmod 2770 {} +
}

seed_wiki_cursor_files() {
  local wiki="$1"
  local src="$2"
  if [[ ! -f "$src/.cursor/mcp.json" || ! -f "$src/AGENTS.md" ]]; then
    echo "missing $src/.cursor/mcp.json or $src/AGENTS.md" >&2
    exit 1
  fi
  echo "==> seed $wiki/.cursor from $src"
  install -d -m 2770 "$wiki/.cursor/rules"
  install -m 0660 "$src/.cursor/mcp.json" "$wiki/.cursor/mcp.json"
  {
    printf '%s\n' "---" "alwaysApply: true" "---" ""
    cat "$src/AGENTS.md"
  } > "$wiki/.cursor/rules/local.mdc"
  chmod 0660 "$wiki/.cursor/rules/local.mdc"
  local dir
  for dir in .agents .claude .codex; do
    if [[ -d "$src/$dir" ]]; then
      rm -rf "$wiki/$dir"
      cp -a "$src/$dir" "$wiki/$dir"
    fi
  done
  if [[ -z "$PREFIX" ]] && id gdgagent-svc >/dev/null 2>&1 && getent group gdgwiki >/dev/null 2>&1; then
    refresh_wiki_ownership "$wiki"
  fi
}

ensure_gdg_system() {
  echo "==> gdg CLI (/usr/local/bin)"
  local src=""
  if [[ -x /usr/local/bin/gdg ]]; then
    echo "    already /usr/local/bin/gdg"
  else
    if command -v gdg >/dev/null 2>&1; then
      src="$(command -v gdg)"
    else
      echo "    installing gdg CLI from url.gdgs.jp/cli/install.sh"
      curl -fsSL https://url.gdgs.jp/cli/install.sh | sh
      if [[ -x "${HOME}/.local/bin/gdg" ]]; then
        src="${HOME}/.local/bin/gdg"
      elif command -v gdg >/dev/null 2>&1; then
        src="$(command -v gdg)"
      fi
    fi
    if [[ -z "$src" || ! -x "$src" ]]; then
      echo "gdg CLI install did not produce a binary to copy to /usr/local/bin" >&2
      exit 1
    fi
    install -m 0755 "$src" /usr/local/bin/gdg
  fi
  ln -sfn /usr/local/bin/gdg /usr/local/bin/git-remote-gdg-wiki
}

ensure_svc_gdg_login() {
  local cred="/home/gdgagent-svc/.config/gdg/credentials.json"
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/gdg
  if [[ -s "$cred" ]]; then
    echo "==> gdg credentials already present for gdgagent-svc"
    return 0
  fi
  local op_home src
  op_home="$(operator_home)"
  src="${op_home:+$op_home/.config/gdg/credentials.json}"
  if [[ -n "$src" && -s "$src" ]]; then
    echo "==> copy gdg credentials from ${SUDO_USER} to gdgagent-svc"
    install -m 0600 -o gdgagent-svc -g gdgagent-svc "$src" "$cred"
    return 0
  fi
  echo "==> gdg login --device (gdgagent-svc)"
  if [[ ! -t 0 ]]; then
    echo "gdg login is required and stdin is not a TTY." >&2
    echo "Re-run from a terminal, or place credentials at $cred" >&2
    exit 1
  fi
  as_svc /usr/local/bin/gdg login --device
  if [[ ! -s "$cred" ]]; then
    echo "gdg login did not write $cred" >&2
    exit 1
  fi
}

ensure_wiki_clone_and_seed() {
  local wiki src
  wiki="$(wiki_root)"
  src="$(agents_local_src)"
  if [[ -n "$PREFIX" ]]; then
    seed_wiki_cursor_files "$wiki" "$src"
    return
  fi
  ensure_gdg_system
  ensure_svc_gdg_login
  if ! wiki_is_clone "$wiki"; then
    echo "==> gdg wiki clone $wiki"
    if ! as_svc /usr/local/bin/gdg wiki clone "$wiki"; then
      echo "gdg wiki clone failed." >&2
      exit 1
    fi
    refresh_wiki_ownership "$wiki"
  fi
  seed_wiki_cursor_files "$wiki" "$src"
}

ensure_cursor_cli() {
  if command -v cursor-agent >/dev/null 2>&1 || [[ -x /usr/bin/cursor-agent ]]; then
    echo "==> cursor-agent already installed"
    return 0
  fi
  echo "==> install Cursor CLI"
  curl -fsSL https://github.com/karaage0703/xangi/releases/latest/download/setup-ai-tools.sh | bash -s -- cursor
  command -v cursor-agent >/dev/null 2>&1 || [[ -x /usr/bin/cursor-agent ]] || {
    echo "cursor-agent is still missing after setup-ai-tools.sh" >&2
    exit 1
  }
}

ensure_xangi_fork() {
  local repo="${XANGI_REPO:-https://github.com/Harineko0/xangi.git}"
  echo "==> Harineko0/xangi -> /opt/xangi"
  if [[ ! -d /opt/xangi/.git ]]; then
    git clone "$repo" /opt/xangi
  fi
  (
    cd /opt/xangi
    if [[ -f package-lock.json ]]; then
      if ! npm ci; then
        echo "npm ci failed; retrying once with a clean node_modules directory." >&2
        rm -rf /opt/xangi/node_modules
        npm ci
      fi
    else
      npm install
    fi
    chmod -R a+rX node_modules
  )
  ln -sfn /opt/xangi/bin/xangi /usr/local/bin/xangi
}

ensure_langfuse_forwarder() {
  echo "==> lib/langfuse-forwarder -> /opt/langfuse-forwarder"
  rm -rf /opt/langfuse-forwarder
  cp -a "$layout_dir/lib/langfuse-forwarder" /opt/langfuse-forwarder
  (
    cd /opt/langfuse-forwarder
    if [[ -f package-lock.json ]]; then
      if ! npm ci; then
        echo "npm ci failed; retrying once with a clean node_modules directory." >&2
        rm -rf /opt/langfuse-forwarder/node_modules
        npm ci
      fi
    else
      npm install
    fi
    chmod -R a+rX node_modules
  )
}

write_langfuse_forwarder_unit() {
  local unit_dir uid
  uid="$(id -u gdgagent-svc)"
  unit_dir="/home/gdgagent-svc/.config/systemd/user"
  install -d -m 0755 -o gdgagent-svc -g gdgagent-svc "$unit_dir"
  cat > "$unit_dir/langfuse-forwarder.service" <<'EOF'
[Unit]
Description=langfuse-forwarder (GDG agent observability)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/langfuse-forwarder
ExecStart=/usr/bin/node /opt/langfuse-forwarder/node_modules/tsx/dist/cli.mjs /opt/langfuse-forwarder/src/index.ts
Environment=DATA_DIR=/srv/gdg-agent/wiki/.xangi
Environment=LANGFUSE_CREDENTIALS_PATH=/home/gdgagent-svc/.config/langfuse/credentials.json
Environment=LANGFUSE_FORWARDER_STATE_DIR=/home/gdgagent-svc/.local/share/langfuse-forwarder
EOF
  cat > "$unit_dir/langfuse-forwarder.timer" <<'EOF'
[Unit]
Description=Run langfuse-forwarder every 5 minutes

[Timer]
OnUnitActiveSec=5min
OnBootSec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  chown gdgagent-svc:gdgagent-svc "$unit_dir/langfuse-forwarder.service" "$unit_dir/langfuse-forwarder.timer"
  loginctl enable-linger gdgagent-svc
  as_svc systemctl --user daemon-reload
  as_svc systemctl --user enable langfuse-forwarder.timer
}

start_langfuse_forwarder() {
  if [[ -s /home/gdgagent-svc/.config/langfuse/credentials.json ]]; then
    echo "==> start langfuse-forwarder.timer"
    as_svc systemctl --user start langfuse-forwarder.timer
  else
    echo "==> skip langfuse-forwarder.timer start (no /home/gdgagent-svc/.config/langfuse/credentials.json)"
  fi
}

ensure_xangi_setup() {
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/xangi
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.local/share
  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.local/share/xangi
  echo "==> xangi setup --apply"
  as_svc /usr/local/bin/xangi setup --apply \
    --backend cursor \
    --workspace /srv/gdg-agent/wiki \
    --workspace-mode existing \
    --web-chat-access local
}

copy_operator_runtime_secrets() {
  local op_home slot
  op_home="$(operator_home)"
  [[ -n "$op_home" ]] || return 0
  if [[ -s "$op_home/.config/xangi/secrets.json" ]]; then
    echo "==> copy xangi secrets.json from ${SUDO_USER}"
    install -m 0600 -o gdgagent-svc -g gdgagent-svc \
      "$op_home/.config/xangi/secrets.json" /home/gdgagent-svc/.config/xangi/secrets.json
  fi
  if [[ -s "$op_home/.config/cursor/auth.json" ]]; then
    echo "==> copy Cursor auth.json onto slot homes"
    for slot in $(seq 0 $((SLOT_COUNT - 1))); do
      install -d -m 0700 -o "gdgagent-run-${slot}" -g "gdgagent-run-${slot}" \
        "/home/gdgagent-run-${slot}/.config/cursor"
      install -m 0600 -o "gdgagent-run-${slot}" -g "gdgagent-run-${slot}" \
        "$op_home/.config/cursor/auth.json" "/home/gdgagent-run-${slot}/.config/cursor/auth.json"
    done
  fi
}

write_xangi_user_unit() {
  local unit_dir drop_in uid
  uid="$(id -u gdgagent-svc)"
  unit_dir="/home/gdgagent-svc/.config/systemd/user"
  drop_in="$unit_dir/xangi.service.d"
  install -d -m 0755 -o gdgagent-svc -g gdgagent-svc "$unit_dir" "$drop_in"
  cat > "$unit_dir/xangi.service" <<'EOF'
[Unit]
Description=xangi (GDG agent)
After=network-online.target

[Service]
WorkingDirectory=/opt/xangi
ExecStart=/usr/bin/node /opt/xangi/node_modules/tsx/dist/cli.mjs /opt/xangi/src/index.ts
Environment=XANGI_SETUP_CONFIG_PATH=/home/gdgagent-svc/.config/xangi/xangi.json
Environment=XANGI_SETUP_STATE_DIR=/home/gdgagent-svc/.local/share/xangi
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  cat > "$drop_in/model.conf" <<'EOF'
[Service]
Environment=AGENT_MODEL=gpt-5.3-codex-low
Environment=DISCORD_SHOW_THINKING=false
Environment=DISCORD_STREAMING=false
Environment=DISCORD_COMPLETION_NOTIFY=off
EOF
  chown gdgagent-svc:gdgagent-svc "$unit_dir/xangi.service" "$drop_in/model.conf"
  loginctl enable-linger gdgagent-svc
  as_svc systemctl --user daemon-reload
  as_svc systemctl --user enable xangi.service
}

start_xangi_service() {
  if [[ -s /home/gdgagent-svc/.config/xangi/secrets.json ]] &&
    grep -q DISCORD_TOKEN /home/gdgagent-svc/.config/xangi/secrets.json; then
    echo "==> start xangi.service"
    as_svc systemctl --user start xangi.service
  else
    echo "==> skip xangi.service start (no DISCORD_TOKEN in secrets.json)"
  fi
}

print_remaining() {
  local cred="/home/gdgagent-svc/.config/gdg/credentials.json"
  local secrets="/home/gdgagent-svc/.config/xangi/secrets.json"
  local slot0_auth="/home/gdgagent-run-0/.config/cursor/auth.json"
  local langfuse_creds="/home/gdgagent-svc/.config/langfuse/credentials.json"
  local need=0
  echo
  echo "==> Remaining (secrets / Discord Portal only):"
  if [[ ! -s "$cred" ]]; then
    echo "1. gdg credentials missing for gdgagent-svc (unexpected after login)."
    need=1
  fi
  if [[ ! -s "$secrets" ]] || ! grep -q DISCORD_TOKEN "$secrets" 2>/dev/null; then
    echo "- Put DISCORD_TOKEN in /home/gdgagent-svc/.config/xangi/secrets.json (0600),"
    echo "  then: sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/$(id -u gdgagent-svc) systemctl --user start xangi.service"
    need=1
  fi
  if [[ ! -s "$slot0_auth" ]]; then
    echo "- Copy Cursor auth.json onto /home/gdgagent-run-<N>/.config/cursor/ (0600, slot uid)."
    need=1
  fi
  if [[ ! -s "$langfuse_creds" ]]; then
    echo "- (optional) Put LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY/LANGFUSE_HOST/idSalt in"
    echo "  $langfuse_creds (0600), then:"
    echo "  sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/$(id -u gdgagent-svc) systemctl --user start langfuse-forwarder.timer"
  fi
  echo "- Discord Developer Portal: enable Server Members Intent and Message Content Intent."
  if [[ "$need" -eq 0 ]]; then
    echo "Host install finished. If Gateway rejects intents, fix the Portal then restart xangi.service."
  fi
}

place_live_host() {
  [[ -z "$PREFIX" ]] || return 0
  ensure_gdg_system
  ensure_gws
  ensure_cursor_cli
  ensure_xangi_fork
  ensure_langfuse_forwarder
  copy_operator_runtime_secrets
  write_xangi_user_unit
  write_langfuse_forwarder_unit
  if svc_credentials_available || [[ -t 0 ]]; then
    activate_live_host
  else
    echo
    echo "==> Placement complete. To activate after authenticating:"
    echo "sudo /opt/gdgjp/agents-local/install.sh --activate"
  fi
}

activate_live_host() {
  [[ -z "$PREFIX" ]] || return 0
  ensure_gdg_system
  ensure_svc_gdg_login
  ensure_wiki_clone_and_seed
  ensure_xangi_setup
  start_xangi_service
  start_langfuse_forwarder
  print_remaining
}

if [[ -n "$PREFIX" ]]; then
  GDG_SKIP_GDG_INSTALL="${GDG_SKIP_GDG_INSTALL:-1}"
  GDG_SKIP_XANGI_INSTALL="${GDG_SKIP_XANGI_INSTALL:-1}"
  GDG_SKIP_NODE_INSTALL="${GDG_SKIP_NODE_INSTALL:-1}"
fi

require_ubuntu
for arg in "$@"; do
  case "$arg" in
    --activate) ACTIVATE_ONLY=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done
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

if [[ "$ACTIVATE_ONLY" -eq 1 ]]; then
  activate_live_host
  exit 0
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

if [[ ! -f "$hooks_src/acl-gate.ts" || ! -f "$hooks_src/wk.ts" || ! -f "$hooks_src/gws.ts" ]]; then
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
  GDG_SETUP_SKIP_REMAINING=1 \
  "$layout_dir/setup.sh"

apply_ownership
if [[ -n "$PREFIX" ]]; then
  ensure_wiki_clone_and_seed
else
  place_live_host
fi
