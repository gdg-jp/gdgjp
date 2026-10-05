#!/usr/bin/env bash
# Start a test-only stand-in for the authz socket's /resolve and
# /workspace-token endpoints, so `gws` can be exercised in a Lima VM slot
# without a real Discord invocation, xangi authz-server, or Google OAuth
# consent. Run inside the Lima VM as root; keeps running in the foreground
# until Ctrl-C. Never wire this up outside a disposable dev VM: it never
# talks to accounts.gdgs.jp and must never be reachable by it either.
set -euo pipefail

slot=0
sub="test-gdg-sub"
nonce="dev-fake-nonce-$$"

usage() {
  echo "Usage: $0 [--slot N] [--sub GDG_SUB]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slot)
      [[ $# -ge 2 ]] || usage
      slot="$2"
      shift 2
      ;;
    --sub)
      [[ $# -ge 2 ]] || usage
      sub="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run with sudo inside the VM." >&2; exit 1; }
[[ "$slot" =~ ^[0-9]+$ ]] || { echo "--slot must be a non-negative integer." >&2; exit 1; }
[[ "$sub" =~ ^[A-Za-z0-9_.@-]+$ ]] || { echo "--sub must be a single-line identifier." >&2; exit 1; }

user="gdgagent-run-${slot}"
group="$user"
id "$user" >/dev/null 2>&1 || { echo "Unknown slot user: $user" >&2; exit 1; }
group_gid="$(id -g "$user")"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stub="$script_dir/gws-fake-token-stub.mjs"
[[ -f "$stub" ]] || { echo "Missing $stub" >&2; exit 1; }

socket_dir="/run/gdg-agent-dev/gws-stub-${slot}"
socket_path="$socket_dir/authz.sock"
install -d -m 0750 -o root -g "$group" "$socket_dir"
trap 'rm -rf "$socket_dir"' EXIT

echo "Fake authz socket: $socket_path"
echo "Fake nonce:         $nonce"
echo "Fake gdgSub:         $sub"
echo
echo "In another terminal, as the slot user, run:"
echo
echo "  sudo -u $user env XANGI_AUTHZ_SOCKET=$socket_path XANGI_AUTHZ_NONCE=$nonce \\"
echo "    /opt/gdg-agent/bin/gws drive files list --page-limit 1"
echo
echo "The issued access token is fake: an approved gws call reaches Google and fails"
echo "with a 401, which is expected — this only exercises the allowlist, mediator,"
echo "and env-var wiring, not real Drive access. An unapproved call (wrong flag or"
echo "unlisted resource/method) is still denied locally, before any network call."
echo "Press Ctrl-C to stop."
echo

/usr/bin/node "$stub" --socket "$socket_path" --nonce "$nonce" --sub "$sub" --gid "$group_gid"
