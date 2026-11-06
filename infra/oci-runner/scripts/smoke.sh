#!/bin/sh
# Verify a runner VM end to end without leasing a job. Run as root: sudo sh smoke.sh
set -eu
echo "== codex (as runner, on the Pro login)"
sudo -u runner -H codex exec --sandbox read-only --skip-git-repo-check --ephemeral "Reply with the single word: ok" | tail -3
echo "== gdg wiki runner --once --dry-run"
sudo -u runner -H sh -c 'set -a; . /etc/gdg/runner.env; set +a; cd /var/lib/gdg-runner && gdg wiki runner --once --dry-run'
echo "== service"
systemctl is-active gdg-runner || true
journalctl -u gdg-runner -n 5 --no-pager || true
echo "smoke ok"
