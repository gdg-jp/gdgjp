# Lima local agent test VM

This is a disposable Ubuntu 24.04 arm64 VM for exercising the production-style
agent path without a Discord token. It does not claim a macOS security boundary.
Never place a Discord bot token in this VM: that would create a second production-bot login.
It mounts the existing `~/proj/xangi` checkout read-only and copies it into the VM, so no GitHub
credential is needed inside the VM. Ensure that checkout exists before starting Lima.

```bash
limactl start --name=gdg-agent agent-host/dev/lima-gdg-agent.yaml
limactl shell gdg-agent sudo /mnt/gdgjp-src/agent-host/dev/provision.sh
limactl shell gdg-agent sudo /opt/gdgjp/agent-host/dev/seed-iam.sh
limactl shell gdg-agent sudo /opt/gdgjp/agent-host/dev/activate.sh
```

### `gws` (Google Workspace) fake-token dev loop

Token vending for `gws` is server-side now (`accounts.gdgs.jp` + the xangi
authz-server's `/workspace-token` endpoint), not device-local — there is no
browser-redirect callback to tunnel into the VM. A real end-to-end check still
needs a test GDG account that has run `/login` in Discord *and* used "Connect
Google Workspace" on `accounts.gdgs.jp` (a real Google OAuth consent, done
once, outside the VM); see
`docs/agents-local-testing/iam-e2e-runbook.md`'s linking checks.

For fast local iteration on `gws.ts`'s mediator path itself — the Shell
allowlist, the authz-socket calls, and the env vars handed to `gws-bin` —
without doing that consent every time, `dev/seed-gws-fake-token.sh` stands in
for the authz socket's `/resolve` and `/workspace-token` endpoints with a
fixed, obviously-fake identity and access token:

```bash
# VM terminal: keep this running; Ctrl-C to stop and clean up its socket.
limactl shell --workdir / --tty gdg-agent -- \
  sudo /opt/gdgjp/agent-host/dev/seed-gws-fake-token.sh --slot 0
```

It prints the exact command to run as the slot user in a second terminal. The
issued access token is fake, so an approved `gws` call reaches Google and
fails with a 401 — that's expected and still proves the allowlist, mediator,
and env-var wiring work; it does not prove real Drive access. Never point a
real slot's `XANGI_AUTHZ_SOCKET` at this stub, and never run it anywhere but
a disposable VM.

Provisioning is credential-free and only places the host layout and VM-only harness drop-in.
`seed-iam.sh` installs a committed, fully synthetic IAM fixture
(`agent-host/dev/iam-fixture.json`) — the guild, user, role, and channel ids are readable
placeholder strings (`test-guild`, `test-user`, `role-organizer`, `ch-chapter`, …), not real
Discord snowflakes, and are deliberately checked in. Seed before activation, because xangi reads
IAM only at service startup; re-seeding an already-active VM restarts `xangi.service` so the new
fixture takes effect. `seed-iam.sh` also drops a local-only wiki page
(`pages/test-chapter-restricted/page.md`) used by runbook check 4; that page is excluded via
`.git/info/exclude` in the cloned wiki so it is never committed or pushed, and is skipped until
`/srv/gdg-agent/wiki` is an actual clone (re-run `seed-iam.sh` after `activate.sh` in that case).
`activate.sh` runs the device login for the dedicated test Accounts identity, clones
the wiki, and starts xangi. Put Cursor credentials in each slot home before invoking a turn.
Provisioning intentionally suppresses copying operator secrets, so Cursor credentials must be
installed separately and no `secrets.json` may contain `DISCORD_TOKEN`.

Never place a Discord bot token in this VM. Invoke the mapped organizer role with:

```bash
limactl shell gdg-agent -- sudo -u gdgagent-svc xangi harness invoke \
  --guild test-guild --channel ch-chapter --user test-user \
  --roles role-organizer --message "Summarize the venue-cost policy." --json
```

See `docs/agents-local-testing/iam-e2e-runbook.md` for the full checklist.

The host checkout is mounted read-only; provisioning copies it to `/opt/gdgjp` before
running the ordinary installer. Reset with `limactl delete gdg-agent`; do not snapshot it.

### Langfuse observability dev loop

`langfuse-forwarder/` reads xangi's `logs/observability/*.jsonl` and forwards it to Langfuse
Cloud JP — see `docs/agents-local-o11y/plan.md` and `docs/agents-observability.md`. It is
optional; the bot works without it. To exercise it in this VM (uses the same `~/proj/xangi`
checkout the harness mounts, so xangi-side observability-logger.ts changes are picked up too):

1. Drop **test** Langfuse Cloud JP project credentials (never production keys) at
   `/home/gdgagent-svc/.config/langfuse/credentials.json` (0600, `gdgagent-svc`-owned):
   ```json
   {"LANGFUSE_PUBLIC_KEY":"pk-...","LANGFUSE_SECRET_KEY":"sk-...","LANGFUSE_HOST":"https://jp.cloud.langfuse.com","idSalt":"any-random-string"}
   ```
2. Drive at least one turn (e.g. the `xangi harness invoke` command above) so
   `logs/observability/<appSessionId>.jsonl` has a completed turn.
3. Run the forwarder once by hand rather than waiting on the timer:
   ```bash
   limactl shell gdg-agent -- sudo -u gdgagent-svc \
     env DATA_DIR=/srv/gdg-agent/wiki/.xangi \
         LANGFUSE_CREDENTIALS_PATH=/home/gdgagent-svc/.config/langfuse/credentials.json \
         LANGFUSE_FORWARDER_STATE_DIR=/home/gdgagent-svc/.local/share/langfuse-forwarder \
     node /opt/langfuse-forwarder/node_modules/tsx/dist/cli.mjs /opt/langfuse-forwarder/src/index.ts
   ```
4. In the Langfuse UI (or `npx langfuse-cli api traces list --limit 1`), confirm: one trace per
   turn with a root `agent`-typed observation, tool calls as sibling `tool` observations (not
   nested under a generation), `userId`/`sessionId` as digests (never the raw `appSessionId`), and
   real start/end timestamps (not "just now" — this forwarder backfills historical data).
5. Re-run step 3 with no new turns: it should log "Nothing new to forward" and produce zero
   duplicate traces (idempotency). Check
   `/home/gdgagent-svc/.local/share/langfuse-forwarder/quarantine/` for anything unexpected.

This section documents the intended loop; it has not been run end-to-end against a live Lima VM
as part of this change (no VM in the environment that implemented it) — treat step 4's specifics
as the first thing to verify, not as a confirmed-working result.
