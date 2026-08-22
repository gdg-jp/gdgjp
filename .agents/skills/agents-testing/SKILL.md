---
name: agents-testing
description: Run and diagnose production-style local tests for gdgjp agents-local. Use when validating the Lima Ubuntu VM, xangi harness invocation, IAM role and channel authorization, Cursor sandbox behavior, wk ACLs, or the chapter-versus-national visibility boundary without Discord.
---

# Agents Local Testing

Use the disposable Lima VM. Never add a production `DISCORD_TOKEN` to it.

## Provision the VM

Run from the gdgjp repository root:

```bash
limactl start --name=gdg-agent agents-local/dev/lima-gdg-agent.yaml
limactl shell --workdir / gdg-agent -- sudo /mnt/gdgjp-src/agents-local/dev/provision.sh
limactl shell --workdir / gdg-agent -- sudo /opt/gdgjp/agents-local/dev/seed-iam.sh
limactl shell --workdir / gdg-agent -- sudo /opt/gdgjp/agents-local/dev/activate.sh
```

`activate.sh` needs a TTY for the dedicated test Accounts login. Provisioning copies the read-only host checkout into `/opt/gdgjp`; never install from `/mnt/gdgjp-src`. Reset with `limactl delete gdg-agent`; do not snapshot the VM.

## Authenticate Cursor

Log in every slot:

```bash
limactl shell --workdir / --tty gdg-agent -- sudo -u gdgagent-run-0 cursor-agent login
limactl shell --workdir / --tty gdg-agent -- sudo -u gdgagent-run-1 cursor-agent login
```

If token storage fails, ensure `/home/gdgagent-run-N/.config/cursor` is slot-owned with mode `0700`, then retry. If workspace trust is required, establish trust for `/srv/gdg-agent/wiki` as that slot. Keep the sandbox enabled.

## Invoke and assess the harness

```bash
sudo -u gdgagent-svc xangi harness invoke \
  --guild test-guild --channel ch-chapter --user test-user \
  --roles role-organizer --message "Read a chapter page using wiki sources." --json
```

Check `error` before `denialReason`. Successful runs include `classes`, `channelAudience`, `slot`, `runId`, and `result`. Use `docs/agents-local-testing/iam-e2e-runbook.md` for full criteria.

Verify these cases:

1. `ch-chapter` plus `role-organizer` starts an agent, creates then removes a nonce, and uses `wk read` after direct reads are denied.
2. `ch-chapter` plus no roles returns `no-held-classes` without a Cursor child or nonce.
3. `ch-other` plus `role-organizer` returns `no-effective-classes` without a child or nonce.
4. `pages/test-chapter-restricted/page.md` is readable from `ch-chapter`, but `wk read` from `ch-national` fails with `wk: access denied for this file in the current channel`.

The check-4 fixture must remain a canonical `pages/**/page.md` page with `visibility: restricted` and `chapter_id: test-chapter`. A loose `pages/*.md` path or unsupported visibility bypasses page ACL evaluation and invalidates the test.

## Diagnose and validate changes

- Rerun `seed-iam.sh` when IAM is missing or stale; it restarts active xangi.
- Do not add shared API keys to evade Cursor authentication.
- On an unexpected `wk` allow, verify the fixture path/front matter and response classes/channel audience before diagnosing production ACL code.
- Stop the checklist on an unexpected child or any `error`; preserve the JSON result and service status.

After changing setup or ACL helpers, run:

```bash
pnpm --filter @gdgjp/gdg-lib build:acl
pnpm exec node --test .github/scripts/gdg-agent-layout.test.mjs
```

Reprovision and re-seed before testing changed host layout, ACL bundle, or fixture behavior.
