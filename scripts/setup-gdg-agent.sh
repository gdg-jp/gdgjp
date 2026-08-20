#!/usr/bin/env bash
# Install user Cursor hooks and /opt/gdg-agent copies of the Wiki gate.
# Ubuntu-only. uid isolation and sudoers belong to Stage 07.
# Lives in this monorepo because the agents-local submodule pin is not fetchable
# from CI; Stage 07 can copy or wrap this script into agents.git.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]] || [[ ! -r /etc/os-release ]]; then
  echo "scripts/setup-gdg-agent.sh supports Ubuntu only" >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "scripts/setup-gdg-agent.sh supports Ubuntu only" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="$ROOT/cli/internal/wiki/hooks"
AGENT_ROOT="${GDG_SETUP_AGENT_ROOT:-/opt/gdg-agent}"
CURSOR_HOME="${GDG_SETUP_CURSOR_HOME:-$HOME/.cursor}"

if [[ ! -f "$HOOKS_SRC/acl-gate.ts" || ! -f "$HOOKS_SRC/wk.ts" ]]; then
  echo "missing hook sources under $HOOKS_SRC" >&2
  exit 1
fi
if [[ ! -f "$HOOKS_SRC/acl.ts" ]]; then
  echo "missing $HOOKS_SRC/acl.ts; run pnpm build:acl first" >&2
  exit 1
fi

install -d -m 0755 "$AGENT_ROOT/lib" "$AGENT_ROOT/bin"
install -m 0444 "$HOOKS_SRC/package.json" "$AGENT_ROOT/package.json"
for f in acl-gate.ts wk.ts acl-core.ts shell-allowlist.ts commit-tripwire.ts acl-insert-core.ts acl.ts; do
  install -m 0444 "$HOOKS_SRC/$f" "$AGENT_ROOT/lib/$f"
done
cat > "$AGENT_ROOT/bin/wk" <<EOF
#!/bin/sh
exec node "$AGENT_ROOT/lib/wk.ts" "\$@"
EOF
chmod 0755 "$AGENT_ROOT/bin/wk"

install -d -m 0755 "$CURSOR_HOME"
cat > "$CURSOR_HOME/hooks.json" <<EOF
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "node $AGENT_ROOT/lib/acl-gate.ts $AGENT_ROOT/bin/wk",
        "timeout": 10,
        "failClosed": true
      }
    ]
  }
}
EOF
chmod 0644 "$CURSOR_HOME/hooks.json"

echo "Installed $CURSOR_HOME/hooks.json and $AGENT_ROOT"
