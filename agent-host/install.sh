#!/usr/bin/env bash
# Zero-from-scratch Ubuntu host install for the self-hosted GDG agent.
#
# Bootstrap URL (returns in Stage 08):
#   curl -fsSL https://raw.githubusercontent.com/gdg-jp/gdgjp/main/scripts/install-gdg-agent-host.sh | sudo bash (Stage 08)
#
# From a checkout:
#   sudo ./agent-host/install.sh
#
# Does:
#   1. Clone or reuse the gdgjp monorepo (xangi's file: gdg-lib lives there; Stage 13 removes this)
#   2. Ensure Node 22.18+ (xangi runtime + spec parsing — not hook builds) and git
#   3. Create gdgwiki / gdgagent-svc / gdgagent-run-* (live root only)
#   4. Generate /opt/gdg-agent layout via `gdg agent-host emit-layout` (embedded hooks)
#   5. chown / linger / tmpfiles (`emit-layout --apply-ownership`)
#   6. Place gdg, Cursor CLI, Harineko0/xangi, runtime secrets, and systemd user unit
#   7. Activate when credentials are available (or on a TTY): login as svc, clone and seed wiki,
#      apply xangi configuration, and conditionally start the service
#
# Interactive only when secrets are missing (gdg device login, Discord token,
# Cursor auth). Discord Developer Portal intents cannot be set from this host.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC="${GDG_SPEC:-$here/agent-host.json}"
PREFIX="${GDG_SETUP_PREFIX:-}"
GDGJP_REPO="${GDGJP_REPO:-https://github.com/gdg-jp/gdgjp.git}"
GDGJP_REF="${GDGJP_REF:-main}"
ACTIVATE_ONLY=0
RELOAD_CONFIG_ONLY=0
VERIFY_ONLY=0

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

bootstrap_node_version() {
  local ver=""
  if command -v node >/dev/null 2>&1; then
    ver="$(node -e 'const p=require(process.argv[1]).pins.node;process.stdout.write(p.major+"."+p.minMinor)' "$SPEC" 2>/dev/null || true)"
  fi
  if [[ -z "$ver" ]] && command -v python3 >/dev/null 2>&1; then
    ver="$(python3 -c 'import json, sys; p=json.load(open(sys.argv[1]))["pins"]["node"]; print(f"{p[\"major\"]}.{p[\"minMinor\"]}")' "$SPEC" 2>/dev/null || true)"
  fi
  if [[ -z "$ver" ]]; then
    local major minor
    major="$(sed -n '/"node"/,/}/p' "$SPEC" | grep -o '"major"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' || true)"
    minor="$(sed -n '/"node"/,/}/p' "$SPEC" | grep -o '"minMinor"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' || true)"
    if [[ -n "$major" && -n "$minor" ]]; then
      ver="${major}.${minor}"
    fi
  fi
  if [[ -z "$ver" ]]; then
    echo "Cannot determine pins.node version from $SPEC to bootstrap Node" >&2
    exit 1
  fi
  echo "$ver"
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local ver major minor
  ver="$(node -v | sed 's/^v//')"
  major="${ver%%.*}"
  minor="${ver#*.}"
  minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  local want_major="${NODE_MAJOR_MIN:-}"
  local want_minor="${NODE_MINOR_MIN:-}"
  if [[ -z "$want_major" || -z "$want_minor" ]]; then
    local boot_ver
    boot_ver="$(bootstrap_node_version)"
    want_major="${boot_ver%%.*}"
    want_minor="${boot_ver#*.}"
  fi
  ((major > want_major || (major == want_major && minor >= want_minor)))
}

resolve_layout_dir() {
  if [[ -f "$here/lib/verify.sh" && -f "$here/agent-host.json" ]]; then
    printf '%s\n' "$here"
  elif [[ -f "$here/../agent-host/lib/verify.sh" ]]; then
    cd "$here/../agent-host" && pwd
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

# Clone is retained solely so xangi can resolve @gdgjp/gdg-lib via
# file:../gdgjp/gdg-lib → /opt/gdgjp/gdg-lib. Hook layout no longer reads this
# tree. Remove ensure_gdgjp in Stage 13 once xangi consumes a published package.
ensure_gdgjp() {
  local detected
  detected="$(resolve_gdgjp)"
  if [[ -n "$detected" ]]; then
    printf '%s\n' "$detected"
    return
  fi
  if [[ "${GDG_SKIP_CLONE:-}" == 1 ]]; then
    echo "GDGJP_ROOT must point at a gdgjp checkout (xangi's file: gdg-lib)." >&2
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
  apt-get install -y -qq git ca-certificates curl unzip sudo
}

# Node remains for xangi and for parsing agent-host.json in this script.
# Hook placement (acl.ts / emit-layout) does not use host node. Stage 13 can
# drop this once xangi no longer needs a Node runtime on the host.
install_node_if_needed() {
  if node_ok; then
    echo "    node $(node -v)"
    return
  fi
  local boot_ver bootstrap_major
  if [[ -n "${NODE_MAJOR_MIN:-}" ]]; then
    bootstrap_major="$NODE_MAJOR_MIN"
  else
    boot_ver="$(bootstrap_node_version)"
    bootstrap_major="${boot_ver%%.*}"
  fi
  if [[ "${GDG_SKIP_NODE_INSTALL:-}" == 1 || -n "$PREFIX" || "$(id -u)" -ne 0 ]]; then
    echo "Node ${bootstrap_major}.0+ is required (found: $(command -v node >/dev/null && node -v || echo none))." >&2
    exit 1
  fi
  echo "==> Node.js (nodesource ${bootstrap_major}.x)"
  curl -fsSL "https://deb.nodesource.com/setup_${bootstrap_major}.x" | bash -
  apt-get install -y -qq nodejs
  node_ok || {
    echo "Node ${bootstrap_major} is still missing after install." >&2
    exit 1
  }
}

load_spec() {
  [[ -f "$SPEC" ]] || {
    echo "spec file not found: $SPEC" >&2
    exit 1
  }
  node -e '
    const fs = require("fs");
    const specPath = process.argv[1];
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    } catch (e) {
      console.error("Failed to parse spec at " + specPath + ": " + e.message);
      process.exit(1);
    }

    function requireType(val, path, expectedType) {
      if (typeof val !== expectedType) {
        console.error(`Invalid or missing spec field: ${path} (expected ${expectedType}, got ${typeof val})`);
        process.exit(1);
      }
    }

    function requireNonEmptyString(val, path) {
      requireType(val, path, "string");
      if (val.trim().length === 0) {
        console.error(`Spec field ${path} must not be empty`);
        process.exit(1);
      }
    }

    function requireRegex(val, path, regex) {
      requireNonEmptyString(val, path);
      if (!regex.test(val)) {
        console.error(`Spec field ${path} ("${val}") does not match pattern ${regex}`);
        process.exit(1);
      }
    }

    requireType(spec.slotCount, "slotCount", "number");
    if (spec.slotCount < 1 || !Number.isInteger(spec.slotCount)) {
      console.error("spec.slotCount must be a positive integer");
      process.exit(1);
    }

    requireType(spec.backend, "backend", "object");
    requireNonEmptyString(spec.backend.name, "backend.name");
    if (spec.backend.name !== "cursor") {
      console.error(`Unsupported backend: "${spec.backend.name}". Only "cursor" is supported at this stage.`);
      process.exit(1);
    }
    requireNonEmptyString(spec.backend.model, "backend.model");

    requireType(spec.discord, "discord", "object");
    requireType(spec.discord.showThinking, "discord.showThinking", "boolean");
    requireType(spec.discord.streaming, "discord.streaming", "boolean");
    if (!["off", "always", "failure"].includes(spec.discord.completionNotify)) {
      console.error("spec.discord.completionNotify must be off, always, or failure");
      process.exit(1);
    }

    requireType(spec.pins, "pins", "object");
    requireType(spec.pins.cursorAgent, "pins.cursorAgent", "object");
    requireNonEmptyString(spec.pins.cursorAgent.version, "pins.cursorAgent.version");
    requireRegex(spec.pins.cursorAgent.sha256?.x86_64, "pins.cursorAgent.sha256.x86_64", /^[0-9a-f]{64}$/);
    requireRegex(spec.pins.cursorAgent.sha256?.aarch64, "pins.cursorAgent.sha256.aarch64", /^[0-9a-f]{64}$/);

    requireType(spec.pins.xangi, "pins.xangi", "object");
    requireNonEmptyString(spec.pins.xangi.repo, "pins.xangi.repo");
    requireRegex(spec.pins.xangi.ref, "pins.xangi.ref", /^[0-9a-f]{40}$/);

    requireType(spec.pins.gws, "pins.gws", "object");
    requireNonEmptyString(spec.pins.gws.version, "pins.gws.version");
    requireRegex(spec.pins.gws.sha256?.x86_64, "pins.gws.sha256.x86_64", /^[0-9a-f]{64}$/);
    requireRegex(spec.pins.gws.sha256?.aarch64, "pins.gws.sha256.aarch64", /^[0-9a-f]{64}$/);

    requireType(spec.pins.gdgCli, "pins.gdgCli", "object");
    requireNonEmptyString(spec.pins.gdgCli.version, "pins.gdgCli.version");
    requireNonEmptyString(spec.pins.gdgCli.assetTemplate, "pins.gdgCli.assetTemplate");
    requireRegex(spec.pins.gdgCli.sha256?.x86_64, "pins.gdgCli.sha256.x86_64", /^[0-9a-f]{64}$/);
    requireRegex(spec.pins.gdgCli.sha256?.aarch64, "pins.gdgCli.sha256.aarch64", /^[0-9a-f]{64}$/);

    requireType(spec.pins.node, "pins.node", "object");
    requireType(spec.pins.node.major, "pins.node.major", "number");
    requireType(spec.pins.node.minMinor, "pins.node.minMinor", "number");

    requireType(spec.paths, "paths", "object");
    requireNonEmptyString(spec.paths.agentRoot, "paths.agentRoot");
    requireNonEmptyString(spec.paths.workspace, "paths.workspace");
    requireNonEmptyString(spec.paths.runRoot, "paths.runRoot");

    const out = [
      `SPEC_SLOT_COUNT=${spec.slotCount}`,
      `BACKEND_NAME=${JSON.stringify(spec.backend.name)}`,
      `AGENT_MODEL=${JSON.stringify(spec.backend.model)}`,
      `DISCORD_SHOW_THINKING=${spec.discord.showThinking}`,
      `DISCORD_STREAMING=${spec.discord.streaming}`,
      `DISCORD_COMPLETION_NOTIFY=${JSON.stringify(spec.discord.completionNotify)}`,
      `CURSOR_VERSION=${JSON.stringify(spec.pins.cursorAgent.version)}`,
      `CURSOR_SHA256_X86_64_LINUX=${JSON.stringify(spec.pins.cursorAgent.sha256.x86_64)}`,
      `CURSOR_SHA256_AARCH64_LINUX=${JSON.stringify(spec.pins.cursorAgent.sha256.aarch64)}`,
      `XANGI_PIN_REPO=${JSON.stringify(spec.pins.xangi.repo)}`,
      `XANGI_PIN_REF=${JSON.stringify(spec.pins.xangi.ref)}`,
      `GWS_VERSION=${JSON.stringify(spec.pins.gws.version)}`,
      `GWS_SHA256_X86_64_LINUX=${JSON.stringify(spec.pins.gws.sha256.x86_64)}`,
      `GWS_SHA256_AARCH64_LINUX=${JSON.stringify(spec.pins.gws.sha256.aarch64)}`,
      `GDG_CLI_VERSION=${JSON.stringify(spec.pins.gdgCli.version)}`,
      `GDG_CLI_ASSET_TEMPLATE=${JSON.stringify(spec.pins.gdgCli.assetTemplate)}`,
      `GDG_CLI_SHA256_X86_64_LINUX=${JSON.stringify(spec.pins.gdgCli.sha256.x86_64)}`,
      `GDG_CLI_SHA256_AARCH64_LINUX=${JSON.stringify(spec.pins.gdgCli.sha256.aarch64)}`,
      `NODE_MAJOR_MIN=${spec.pins.node.major}`,
      `NODE_MINOR_MIN=${spec.pins.node.minMinor}`,
      `SPEC_AGENT_ROOT=${JSON.stringify(spec.paths.agentRoot)}`,
      `SPEC_WORKSPACE=${JSON.stringify(spec.paths.workspace)}`,
      `SPEC_RUN_ROOT=${JSON.stringify(spec.paths.runRoot)}`,
    ];
    process.stdout.write(out.join("\n") + "\n");
  ' "$SPEC"
}

ensure_node_and_load_spec() {
  if ! node_ok; then
    if [[ -z "$PREFIX" ]]; then
      install_apt_packages
      install_node_if_needed
    else
      echo "Node is required to read spec at $SPEC" >&2
      exit 1
    fi
  fi
  eval "$(load_spec)"
  SLOT_COUNT="${GDG_AGENT_SLOT_COUNT:-$SPEC_SLOT_COUNT}"
  node_ok || {
    echo "Node ${NODE_MAJOR_MIN}.${NODE_MINOR_MIN}.0+ is required by $SPEC (found: $(node -v))." >&2
    exit 1
  }
}


ensure_gws() {
  local dest="${SPEC_AGENT_ROOT}/bin/gws-bin"
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

create_users() {
  [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]] || return 0
  echo "==> OS users (gdg agent-host apply --only user)"
  resolve_emit_layout_gdg
  "$EMIT_LAYOUT_GDG" agent-host apply --spec "$SPEC" --slot-count "$SLOT_COUNT" --only user
}

# Prefer a gdg that already has both agent-host apply and emit-layout:
# GDG_BIN, a pinned /usr/local/bin/gdg (once pins.gdgCli ships these subcommands),
# PATH, or a binary built from this checkout. Fresh hosts therefore do not
# require a manually supplied GDG_BIN.
gdg_supports_converger() {
  local bin="$1"
  [[ -x "$bin" ]] && "$bin" agent-host emit-layout --help >/dev/null 2>&1 && "$bin" agent-host apply --help >/dev/null 2>&1
}

gdg_supports_emit_layout() {
  gdg_supports_converger "$@"
}

build_gdg_from_checkout() {
  local dest="$1"
  if [[ ! -f "$gdgjp/cli/cmd/gdg/main.go" ]]; then
    echo "cannot build gdg: missing $gdgjp/cli/cmd/gdg" >&2
    exit 1
  fi
  if ! command -v go >/dev/null 2>&1; then
    if [[ -z "$PREFIX" && "$(id -u)" -eq 0 ]]; then
      echo "==> golang-go (build agent-host converger gdg from checkout)"
      apt-get install -y -qq golang-go
    fi
  fi
  command -v go >/dev/null 2>&1 || {
    echo "go is required to build gdg agent-host converger from $gdgjp/cli" >&2
    exit 1
  }
  echo "==> go build gdg from $gdgjp/cli -> $dest"
  mkdir -p "$(dirname "$dest")"
  (cd "$gdgjp/cli" && go build -o "$dest" ./cmd/gdg)
  gdg_supports_converger "$dest" || {
    echo "built $dest but it has no agent-host apply/emit-layout" >&2
    exit 1
  }
}

resolve_emit_layout_gdg() {
  if [[ -n "${GDG_BIN:-}" && -x "${GDG_BIN}" ]]; then
    gdg_supports_converger "$GDG_BIN" || {
      echo "GDG_BIN=$GDG_BIN has no agent-host apply/emit-layout" >&2
      exit 1
    }
    EMIT_LAYOUT_GDG="$GDG_BIN"
    return
  fi
  if [[ -z "$PREFIX" ]]; then
    ensure_gdg_system
    if gdg_supports_converger /usr/local/bin/gdg; then
      EMIT_LAYOUT_GDG=/usr/local/bin/gdg
      return
    fi
  fi
  if command -v gdg >/dev/null 2>&1 && gdg_supports_converger "$(command -v gdg)"; then
    EMIT_LAYOUT_GDG="$(command -v gdg)"
    return
  fi
  local built="$gdgjp/.gdg-built/gdg"
  if [[ -x "$built" ]] && gdg_supports_converger "$built"; then
    EMIT_LAYOUT_GDG="$built"
    return
  fi
  build_gdg_from_checkout "$built"
  EMIT_LAYOUT_GDG="$built"
}

maybe_reexec_root() {
  if [[ -n "$PREFIX" || "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  echo "==> re-exec as root"
  exec sudo --preserve-env=GDGJP_ROOT,GDGJP_REPO,GDGJP_REF,GDG_AGENT_SLOT_COUNT,GDG_SETUP_PREFIX,GDG_BIN,GDG_SPEC,GDG_SKIP_CLONE,GDG_SKIP_XANGI_INSTALL,GDG_SKIP_NODE_INSTALL,GDG_SKIP_GDG_INSTALL,XANGI_REPO,PATH \
    "$0" "$@"
}

wiki_root() {
  printf '%s\n' "${PREFIX}${SPEC_WORKSPACE}"
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

agent_host_src() {
  if [[ -f "$layout_dir/workspace/AGENTS.md" ]]; then
    printf '%s\n' "$layout_dir"
  elif [[ -f "$gdgjp/agent-host/workspace/AGENTS.md" ]]; then
    printf '%s\n' "$gdgjp/agent-host"
  else
    echo "cannot find agent-host/workspace/AGENTS.md" >&2
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
  local workspace="$src"
  if [[ -d "$src/workspace" ]]; then
    workspace="$src/workspace"
  fi
  local extra_mcp=""
  if [[ -f "$src/config/extra-mcp.json" ]]; then
    extra_mcp="$src/config/extra-mcp.json"
  elif [[ -f "$src/.cursor/mcp.json" ]]; then
    extra_mcp="$src/.cursor/mcp.json"
  fi

  if [[ -z "$extra_mcp" || ! -f "$workspace/AGENTS.md" ]]; then
    echo "missing extra-mcp.json or $workspace/AGENTS.md" >&2
    exit 1
  fi
  echo "==> seed $wiki/.cursor from $src"
  install -d -m 2770 "$wiki/.cursor/rules"
  install -m 0660 "$extra_mcp" "$wiki/.cursor/mcp.json"
  {
    printf '%s\n' "---" "alwaysApply: true" "---" ""
    cat "$workspace/AGENTS.md"
  } > "$wiki/.cursor/rules/local.mdc"
  chmod 0660 "$wiki/.cursor/rules/local.mdc"
  local dir
  for dir in .agents .claude .codex; do
    if [[ -d "$workspace/$dir" ]]; then
      rm -rf "$wiki/$dir"
      cp -a "$workspace/$dir" "$wiki/$dir"
    fi
  done
  if [[ -z "$PREFIX" ]] && id gdgagent-svc >/dev/null 2>&1 && getent group gdgwiki >/dev/null 2>&1; then
    refresh_wiki_ownership "$wiki"
  fi
}

ensure_gdg_system() {
  echo "==> gdg CLI (/usr/local/bin)"
  local dest="/usr/local/bin/gdg"
  local want="gdg version $GDG_CLI_VERSION"
  if [[ -x "$dest" ]]; then
    local have
    have="$("$dest" --version 2>/dev/null | head -n1 || true)"
    if [[ "$have" == "$want" ]]; then
      echo "    gdg already installed: $have"
      ln -sfn /usr/local/bin/gdg /usr/local/bin/git-remote-gdg-wiki
      return
    fi
    echo "    gdg at $dest reports '$have', not the pinned '$want'; reinstalling"
  fi
  if [[ -n "$PREFIX" || "$(id -u)" -ne 0 ]]; then
    echo "gdg $want is required at $dest; install it or unset GDG_SETUP_PREFIX to let install.sh fetch it." >&2
    exit 1
  fi
  local arch arch_name sha256
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      arch_name="amd64"
      sha256="$GDG_CLI_SHA256_X86_64_LINUX"
      ;;
    aarch64|arm64)
      arch_name="arm64"
      sha256="$GDG_CLI_SHA256_AARCH64_LINUX"
      ;;
    *)
      echo "unsupported architecture for gdg: $arch" >&2
      exit 1
      ;;
  esac
  local asset
  asset="${GDG_CLI_ASSET_TEMPLATE//\{version\}/$GDG_CLI_VERSION}"
  asset="${asset//\{arch\}/$arch_name}"
  echo "==> install gdg $GDG_CLI_VERSION ($arch) from GitHub Releases ($asset)"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$asset" \
    "https://github.com/gdg-jp/gdgjp/releases/download/cli/v${GDG_CLI_VERSION}/${asset}"
  echo "$sha256  $tmp/$asset" | sha256sum -c -
  unzip -q -o "$tmp/$asset" -d "$tmp"
  install -d -m 0755 "$(dirname "$dest")"
  install -m 0755 "$tmp/gdg" "$dest"
  rm -rf "$tmp"
  local installed
  installed="$("$dest" --version 2>/dev/null | head -n1 || true)"
  [[ "$installed" == "$want" ]] || {
    echo "gdg did not install correctly at $dest (got '$installed', want '$want')" >&2
    exit 1
  }
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
  src="$(agent_host_src)"
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
  local dest="/opt/cursor-agent/cursor-agent"
  local symlink="/usr/bin/cursor-agent"
  local want="$CURSOR_VERSION"
  if [[ -x "$dest" || -x "$symlink" ]]; then
    local have
    have="$("$symlink" --version 2>/dev/null | head -n1 || true)"
    if [[ "$have" == *"$want"* ]]; then
      echo "    cursor-agent already installed: $have"
      return 0
    fi
    echo "    cursor-agent reports '$have', not the pinned '$want'; reinstalling"
  fi
  if [[ -n "$PREFIX" || "$(id -u)" -ne 0 ]]; then
    echo "cursor-agent $want is required at $symlink; install it or unset GDG_SETUP_PREFIX to let install.sh fetch it." >&2
    exit 1
  fi
  local arch cursor_arch sha256
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      cursor_arch="x64"
      sha256="$CURSOR_SHA256_X86_64_LINUX"
      ;;
    aarch64|arm64)
      cursor_arch="arm64"
      sha256="$CURSOR_SHA256_AARCH64_LINUX"
      ;;
    *)
      echo "unsupported architecture for cursor-agent: $arch" >&2
      exit 1
      ;;
  esac
  echo "==> install cursor-agent $CURSOR_VERSION ($arch) from downloads.cursor.com"
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/agent-cli-package.tar.gz" \
    "https://downloads.cursor.com/lab/${CURSOR_VERSION}/linux/${cursor_arch}/agent-cli-package.tar.gz"
  echo "$sha256  $tmp/agent-cli-package.tar.gz" | sha256sum -c -
  rm -rf /opt/cursor-agent
  mkdir -p /opt/cursor-agent
  tar -xzf "$tmp/agent-cli-package.tar.gz" -C /opt/cursor-agent --strip-components=1
  install -d -m 0755 "$(dirname "$symlink")"
  ln -sfn /opt/cursor-agent/cursor-agent "$symlink"
  rm -rf "$tmp"
  local installed
  installed="$("$symlink" --version 2>/dev/null | head -n1 || true)"
  [[ "$installed" == *"$want"* ]] || {
    echo "cursor-agent did not install correctly at $symlink (got '$installed', want '$want')" >&2
    exit 1
  }
}

ensure_xangi_fork() {
  local repo="${XANGI_REPO:-$XANGI_PIN_REPO}"
  local want_ref="${XANGI_REF:-$XANGI_PIN_REF}"
  echo "==> xangi ($want_ref) -> /opt/xangi"
  if [[ ! -d /opt/xangi/.git ]]; then
    git clone "$repo" /opt/xangi
  else
    echo "==> updating existing /opt/xangi checkout"
    git -c safe.directory=/opt/xangi -C /opt/xangi fetch origin
  fi
  git -c safe.directory=/opt/xangi -C /opt/xangi checkout --detach "$want_ref"
  local head
  head="$(git -c safe.directory=/opt/xangi -C /opt/xangi rev-parse HEAD)"
  [[ "$head" == "$want_ref" ]] || {
    echo "xangi HEAD ($head) does not match pinned ref ($want_ref)" >&2
    exit 1
  }
  (
    cd /opt/xangi
    if [[ ! -f package-lock.json ]]; then
      echo "missing package-lock.json in /opt/xangi; lockfile is required for deterministic install" >&2
      exit 1
    fi
    if ! npm ci; then
      echo "npm ci failed; retrying once with a clean node_modules directory." >&2
      rm -rf /opt/xangi/node_modules
      npm ci
    fi
    chmod -R a+rX node_modules
  )
  ln -sfn /opt/xangi/bin/xangi /usr/local/bin/xangi
}

ensure_langfuse_forwarder() {
  echo "==> langfuse-forwarder -> /opt/langfuse-forwarder"
  rm -rf /opt/langfuse-forwarder
  cp -a "$layout_dir/langfuse-forwarder" /opt/langfuse-forwarder
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
Environment=DATA_DIR=/home/gdgagent-svc/.local/share/xangi
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

prompt_langfuse_credentials() {
  local cred="/home/gdgagent-svc/.config/langfuse/credentials.json"
  [[ -s "$cred" ]] && return 0
  [[ -t 0 ]] || return 0

  echo
  local reply
  read -r -p "==> Set up Langfuse observability now? (optional; bot works without it) [y/N] " reply
  case "$reply" in
    [yY] | [yY][eE][sS]) ;;
    *) return 0 ;;
  esac

  local public_key secret_key host id_salt
  read -r -p "    LANGFUSE_PUBLIC_KEY (pk-lf-...): " public_key
  read -r -s -p "    LANGFUSE_SECRET_KEY (sk-lf-..., input hidden): " secret_key
  echo
  read -r -p "    LANGFUSE_HOST [https://jp.cloud.langfuse.com]: " host
  host="${host:-https://jp.cloud.langfuse.com}"
  read -r -p "    idSalt (random string for hashing ids; blank = auto-generate): " id_salt
  if [[ -z "$id_salt" ]]; then
    id_salt="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    echo "    (generated idSalt)"
  fi

  if [[ -z "$public_key" || -z "$secret_key" ]]; then
    echo "==> Skipping Langfuse setup (LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required)."
    return 0
  fi

  install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/langfuse
  local tmp
  tmp="$(mktemp)"
  # Written via node -e (not printf/heredoc) so a key containing a quote or
  # backslash can't produce invalid or injected JSON.
  LF_PUBLIC_KEY="$public_key" LF_SECRET_KEY="$secret_key" LF_HOST="$host" LF_ID_SALT="$id_salt" \
    node -e '
      const fs = require("fs");
      fs.writeFileSync(
        process.argv[1],
        JSON.stringify(
          {
            LANGFUSE_PUBLIC_KEY: process.env.LF_PUBLIC_KEY,
            LANGFUSE_SECRET_KEY: process.env.LF_SECRET_KEY,
            LANGFUSE_HOST: process.env.LF_HOST,
            idSalt: process.env.LF_ID_SALT,
          },
          null,
          2
        ) + "\n"
      );
    ' "$tmp"
  install -m 0600 -o gdgagent-svc -g gdgagent-svc "$tmp" "$cred"
  rm -f "$tmp"
  echo "==> Wrote $cred"
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
    --backend "$BACKEND_NAME" \
    --workspace "$SPEC_WORKSPACE" \
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
  if [[ -s "$op_home/.config/langfuse/credentials.json" ]]; then
    echo "==> copy langfuse credentials.json from ${SUDO_USER}"
    install -d -m 0700 -o gdgagent-svc -g gdgagent-svc /home/gdgagent-svc/.config/langfuse
    install -m 0600 -o gdgagent-svc -g gdgagent-svc \
      "$op_home/.config/langfuse/credentials.json" /home/gdgagent-svc/.config/langfuse/credentials.json
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
  cat > "$drop_in/model.conf" <<EOF
[Service]
Environment=AGENT_MODEL=${AGENT_MODEL}
Environment=DISCORD_SHOW_THINKING=${DISCORD_SHOW_THINKING}
Environment=DISCORD_STREAMING=${DISCORD_STREAMING}
Environment=DISCORD_COMPLETION_NOTIFY=${DISCORD_COMPLETION_NOTIFY}
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
    echo "- (optional) Langfuse observability was skipped or ran non-interactively."
    echo "  Re-run 'sudo ./agent-host/install.sh --activate' on a TTY to be prompted, or put"
    echo "  LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY/LANGFUSE_HOST/idSalt in $langfuse_creds (0600)"
    echo "  yourself, then:"
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
    echo "sudo /opt/gdgjp/agent-host/install.sh --activate"
  fi
}

activate_live_host() {
  [[ -z "$PREFIX" ]] || return 0
  ensure_gdg_system
  ensure_svc_gdg_login
  ensure_wiki_clone_and_seed
  ensure_xangi_setup
  start_xangi_service
  prompt_langfuse_credentials
  start_langfuse_forwarder
  print_remaining
}

reload_config() {
  [[ -z "$PREFIX" ]] || return 0
  ensure_xangi_fork
  write_xangi_user_unit
  write_langfuse_forwarder_unit
  if as_svc systemctl --user is-active --quiet xangi.service; then
    echo "==> restart xangi.service"
    as_svc systemctl --user restart xangi.service
  else
    echo "==> skip xangi.service restart (not currently active)"
  fi
  if as_svc systemctl --user is-active --quiet langfuse-forwarder.timer; then
    echo "==> restart langfuse-forwarder.timer"
    as_svc systemctl --user restart langfuse-forwarder.timer
  fi
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
    --reload-config) RELOAD_CONFIG_ONLY=1 ;;
    --verify) VERIFY_ONLY=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done
maybe_reexec_root "$@"

ensure_node_and_load_spec

layout_dir="$(resolve_layout_dir)"
gdgjp="$(ensure_gdgjp)"
if [[ -z "$layout_dir" && -f "$gdgjp/agent-host/lib/verify.sh" ]]; then
  layout_dir="$gdgjp/agent-host"
fi
if [[ -z "$layout_dir" || ! -f "$layout_dir/lib/verify.sh" ]]; then
  echo "cannot find agent-host next to $here or under $gdgjp" >&2
  exit 1
fi

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  "$layout_dir/lib/verify.sh"
  exit 0
fi

if [[ "$ACTIVATE_ONLY" -eq 1 ]]; then
  activate_live_host
  exit 0
fi

if [[ "$RELOAD_CONFIG_ONLY" -eq 1 ]]; then
  reload_config
  exit 0
fi

echo "==> gdgjp checkout: $gdgjp"
echo "==> agent-host: $layout_dir"

if [[ -z "$PREFIX" ]]; then
  install_apt_packages
  install_node_if_needed
fi

resolve_emit_layout_gdg
create_users

echo "==> layout (gdg agent-host emit-layout)"
layout_args=(agent-host emit-layout --spec "$SPEC" --slot-count "$SLOT_COUNT" --apply-ownership)
if [[ -n "$PREFIX" ]]; then
  layout_args+=(--prefix "$PREFIX")
fi
"$EMIT_LAYOUT_GDG" "${layout_args[@]}"
if [[ -n "$PREFIX" ]]; then
  ensure_wiki_clone_and_seed
else
  place_live_host
fi
