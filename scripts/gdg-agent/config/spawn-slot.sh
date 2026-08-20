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
export PATH="/opt/gdg-agent/bin:/usr/bin:/bin"
exec /usr/bin/node /opt/gdg-agent/lib/exec-spawn.ts
