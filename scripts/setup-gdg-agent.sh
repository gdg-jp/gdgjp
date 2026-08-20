#!/usr/bin/env bash
# Install /opt/gdg-agent copies of the Wiki gate and the Stage 07 layout.
# Ubuntu-only for the live paths. Prefix mode is used from tests on any OS.
# Lives in this monorepo because the agents-local submodule pin is not always
# fetchable from CI; agents.git keeps the same scripts.
set -euo pipefail

if [[ -z "${GDG_SETUP_PREFIX:-}" ]]; then
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
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="${GDG_SETUP_HOOKS_SRC:-$ROOT/cli/internal/wiki/hooks}"
LAYOUT="$ROOT/agents-local/lib/install-layout.sh"
if [[ ! -x "$LAYOUT" ]]; then
  echo "missing $LAYOUT" >&2
  exit 1
fi

GDG_SETUP_HOOKS_SRC="$HOOKS_SRC" \
  GDG_SETUP_INDEX_PROXY_SRC="${GDG_SETUP_INDEX_PROXY_SRC:-$ROOT/agents-index/src/proxy.ts}" \
  "$LAYOUT"
