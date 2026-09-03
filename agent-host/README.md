# agent-host

Self-hosted counterpart to [`agents/`](https://github.com/gdg-jp/gdgjp/tree/main/agents), the
GDG Japan Wiki Q&A assistant deployed to Vercel (`agent.gdgs.jp`). Both talk to the same
[LLM Wiki](https://wiki.gdgs.jp) and answer the same kinds of questions over Discord, but they use
different stacks:

|                | `agents/` (Vercel)                     | `agent-host/` (this repo)                  |
| -------------- | --------------------------------------- | ------------------------------------------- |
| Runtime        | Next.js on Vercel                       | [xangi](https://github.com/karaage0703/xangi) on a self-hosted Ubuntu server |
| LLM backend    | Gemini via Vertex AI (`ai` SDK)         | Cursor CLI (`cursor-agent`), model Composer 2.5 |
| Chat surfaces  | Discord + Google Chat (custom webhooks) | Discord (via xangi)                          |
| Wiki access    | `wiki.gdgs.jp` agent API                | Local `/srv/gdg-agent/wiki` clone + `gdg` CLI |

See [`docs/agents-setup.md`](https://github.com/gdg-jp/gdgjp/blob/main/docs/agents-setup.md) in
the main monorepo for the Vercel deployment's setup, for background on what the bot does.

## Trust boundaries

Three layers, none of which is optional in production:

1. **preToolUse gate** — the only in-workdir ACL boundary (`wk` vs everything else).
2. **uid isolation** — `cursor-agent` runs as `gdgagent-run-<N>`, not as the
   operator. `~/.config/gdg/credentials.json`, IAM files, hooks, and conversation
   logs are owned by `gdgagent-svc` and are not readable from a slot uid.
3. **OS sandbox** — `sandbox.mode: "enabled"` and `readBoundary: "workspace"`
   stop shell reads of paths outside the worktree. This is a workspace-sized
   fence, not a per-file policy. **It does not replace the gate.**

`readBoundary` and `~/.cursor/sandbox.json` are undocumented Cursor features.
Pin `cursor-agent` and re-run ingest after upgrades.

```
gdgagent-svc          Discord, IAM, authz sockets, gdg tokens, index.db
gdgagent-run-0..N     one concurrent invocation each; shared /srv/gdg-agent/wiki
```

Slots exist so two invocations cannot read each other's `/proc/<pid>/environ`
(nonce). They share one worktree; repository mutations are still serialized by
the later Stage 10 mutex.

## Sleep

xangi runs a daily sleep at 04:00 JST (`SLEEP_CRON`, after the server-side source
refresh at 01:00 JST). `/sleep now` starts it immediately (organizer). `/sleep status`
shows the last summary.

Sleep `raw pull`s, uploads each `memories/` file, ingests one source at a time through
the same `wk` + `preToolUse` harness as chat, then posts a summary to
`SLEEP_SUMMARY_CHANNEL_ID`. Failed memories are left on disk. Push always happens
before `gdg wiki ingest --commit`. Conversation logs never appear in `INGEST_QUEUE.md`.

If the summary lists failures or a truncation, the next sleep continues from
`DATA_DIR/sleep-progress.json` (outside the clone). Do not delete that file to
"unstick" a source unless you also inspect git history for a duplicate page.

Repository mutations (sleep and Discord) share one mutex held by xangi. A waiting
turn is told in Discord; it is not run without the lock.

## Layout

- `workspace/` (`.agents/`, `.claude/`, `.codex/`, `AGENTS.md`) — hand-curated skills and guidelines
  (`wiki-ingest`, `wiki-lint`, `wiki-query`) that teach the coding agent how to work with the wiki
  content in the target worktree.
- `install.sh` — Ubuntu host bootstrap: clone gdgjp, `build:acl`, OS users,
  layout, permissions, and systemd units.
- `lib/verify.sh` — host verification checks (13 inspections for live paths and uid boundaries).
- `config/` — templates for `hooks.json`, `cli-config.json`, `sandbox.json`,
  `mcp.json`, and the argument-less `spawn-slot-<N>` launchers.
- `lib/install-layout.sh` — idempotent file placement (prefixable for tests).
- `lib/apply-ownership.sh` — apply permissions to slot and service directories.
- `langfuse-forwarder/` — standalone Node tool that reads xangi's
  `logs/observability/*.jsonl` and forwards it to Langfuse Cloud JP as sessions/traces/typed observations.
  Deployed to `/opt/langfuse-forwarder`, run by `langfuse-forwarder.timer` (every 5 min).
  See [docs/agents-observability.md](../docs/agents-observability.md) for the
  shared Langfuse conventions with the sibling `agents/` app.

## Setup (on the Ubuntu server)

Hooks and `acl.ts` live in the **gdgjp** monorepo.
The bootstrap URL (`curl -fsSL ... | sudo bash`) will return in Stage 08 once host provisioning is extracted.

Currently, install from a gdgjp checkout:

```bash
sudo ./agent-host/install.sh
```

`install.sh` is Ubuntu-only for live paths. Stage 1 clones gdgjp to `/opt/gdgjp` when needed,
runs `pnpm --filter @gdgjp/gdg-lib build:acl`, creates the uid-isolation users, writes
`/opt/gdg-agent`, installs `gdg` to `/usr/local/bin` (plus `git-remote-gdg-wiki`), installs
Cursor CLI and [Harineko0/xangi](https://github.com/Harineko0/xangi) at `/opt/xangi`, and enables
the systemd `--user` unit. If credentials are available (or it has a TTY), it automatically chains
to stage 2: service-user login, cloning `/srv/gdg-agent/wiki` when empty, seeding gitignored Cursor
files and skills from `agent-host/workspace/`, applying `xangi setup --apply`, and conditionally starting
the service. To explicitly run stage 2, use `sudo ./agent-host/install.sh --activate`.

After activation, only secrets that cannot be invented on the host remain:

1. Discord bot token in `/home/gdgagent-svc/.config/xangi/secrets.json` if it was
   not copied from the operator account, then start `xangi.service`
2. Cursor `auth.json` on each `/home/gdgagent-run-<N>/.config/cursor/` if it was
   not copied from the operator account
3. Discord Developer Portal: Server Members Intent and Message Content Intent
4. (optional) Langfuse credentials — `activate_live_host` prompts for
   `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_HOST`/`idSalt` one at a time on a TTY
   (`LANGFUSE_HOST` defaults to the JP region, `idSalt` auto-generates if left blank) unless
   `/home/gdgagent-svc/.config/langfuse/credentials.json` was already copied from the operator
   account or is already present; `langfuse-forwarder.timer` starts automatically once it exists.
   Observability is optional — the bot works without it

If an unattended stage 1 has no credentials to copy, it finishes successfully and prints the
activation command. `install.sh --activate` runs `gdg login --device` as `gdgagent-svc` (needs a
TTY) before cloning the wiki.

After a config-only change (e.g. `AGENT_MODEL` in `write_xangi_user_unit`) or a code change
pushed to `Harineko0/xangi`, run `sudo ./agent-host/install.sh --reload-config` to pull the
latest `/opt/xangi` checkout (`git pull --ff-only` + `npm ci`), regenerate the `xangi.service`
and `langfuse-forwarder.timer` unit/drop-in files, and restart whichever of them is currently
active. Unlike `--activate`, it does not run login, wiki cloning, or `xangi setup`.

Do not put the worktree under a slot home directory. `gdg wiki *` and `git push`
run as `gdgagent-svc` and need group write via `gdgwiki` + setgid `2770`.

### Discord bot

Follow xangi's own Discord setup docs to create the bot application and invite it to the target
server; `xangi setup` walks through supplying the token.

### Local VM testing

`dev/` contains the disposable Lima Ubuntu environment used to exercise the same installer,
uid isolation, sandbox, and Discord-less harness path locally. See [dev/README.md](dev/README.md)
and [the Stage 12 specification](../docs/agents-local-mvp/12-local-test-environment.md).

### Security

xangi's Web Chat has no built-in auth — if you enable it, keep it bound to `localhost` or expose
it only over Tailscale, per xangi's own README. Don't expose it to the open LAN or internet.

## Updating the wiki content

`wiki/` is a normal `gdg wiki clone` working tree once populated — use `gdg wiki raw pull`,
`gdg wiki ingest`, etc. from inside it exactly as documented in `.agents/skills/`.
