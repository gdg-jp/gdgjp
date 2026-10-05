#!/bin/sh
# Fixed privileged launcher. Slot number is baked in at install time.
# Takes no arguments: sudoers must not use wildcards.
set -eu
SLOT="__SLOT__"
if [ "$#" -ne 0 ]; then
  echo "spawn-slot-${SLOT} takes no arguments" >&2
  exit 1
fi
export GDG_AGENT_SLOT="$SLOT"
export HOME="/home/gdgagent-run-${SLOT}"
export PATH="__AGENT_ROOT__/bin:/usr/bin:/bin"
# Cursor always rewrite-saves cli-config.json (caches / --trust). Keep the
# live file slot-owned, and restore sandbox policy from the root template.
cp __AGENT_ROOT__/lib/cli-config.json "$HOME/.cursor/cli-config.json"
exec /usr/bin/node __AGENT_ROOT__/lib/exec-spawn.ts
