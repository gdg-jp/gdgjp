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

1. **preToolUse gate** (`toolGate: "preToolUse-failClosed"`) — the only in-workdir ACL boundary (`wk` vs everything else).
2. **uid isolation** (`slotLauncher: true`) — the backend CLI (`cursor-agent`, and since Stage 12
   every other xangi adapter too) runs as `gdgagent-run-<N>`, not as the operator.
   `~/.config/gdg/credentials.json`, IAM files, hooks, and conversation
   logs are owned by `gdgagent-svc` and are not readable from a slot uid. Slot isolation lives
   in xangi's `CliRunnerBase` (`src/cli-runner-core.ts`), not in any single adapter, and fails
   closed (throws) rather than falling back to a same-uid spawn when a slot can't be assigned.
3. **OS sandbox** (`osSandbox: "workspace"`) — `sandbox.mode: "enabled"` and `readBoundary: "workspace"`
   stop shell reads of paths outside the worktree. This is a workspace-sized
   fence, not a per-file policy. **It does not replace the gate.**

### Backend capability contract (fail closed)

The 3 layers are governed by the **Backend Capability Contract** in `spec.backend.isolation`:
```jsonc
"backend": {
  "name": "cursor",
  "model": "composer-2.5",
  "isolation": {
    "slotLauncher": true,
    "osSandbox": "workspace",
    "toolGate": "preToolUse-failClosed"
  }
}
```

The Go converger (`gdg agent-host apply`) enforces this contract against a backend capabilities registry:
- Switching `backend.name` to `antigravity` fails closed with explicit error messages for each missing layer. Since Stage 12 lifted slot isolation into `CliRunnerBase` for all xangi adapters, `slotLauncher` is satisfied; `osSandbox` and `toolGate` still block the switch pending Stage 14.
- Relaxing `backend.isolation` in `environment: "production"` is rejected against an immutable `productionMinimum` compiled into the `gdg` binary.
- Self re-exec (`pins.gdgCli`) verifies the current binary's `productionMinimum` before re-exec and requires SHA-256 digests to match an approved release allowlist, preventing downgrade bypasses.
- Backend configuration bundles are organized under `config/backends/<name>/` (e.g. `cursor/`), with the converger placing only the active backend's templates.
- No `--force` or bypass flags are permitted.

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
- `../scripts/install-gdg-agent-host.sh` — the only provisioning shell (~40 lines): Ubuntu check,
  minimal apt prerequisites, pinned `gdg` fetch, then `exec gdg agent-host apply`. Everything else
  is the Go converger.
- `config/` — templates for `hooks.json`, `cli-config.json`, `sandbox.json`,
  `mcp.json`, and the argument-less `spawn-slot-<N>` launchers.
- `gdg agent-host apply` — declarative convergence (idempotent, `--prefix` for tests,
  `--dry-run --diff` to review, `--only <type>` to scope). `gdg agent-host verify` runs the 13
  live-path and uid-boundary inspections.
- `agents-index/` — standalone runtime manifest (`package.json` + `package-lock.json`) for the
  ACL-filtered wiki search daemon. `gdg agent-host apply` deploys it to `/opt/agents-index`
  (daemon sources from the `@gdgjp/agents-index` workspace package, ACL import rewritten off
  `@gdgjp/gdg-lib`), runs `npm ci`, and manages `agents-index.service` — a **system** unit
  running as `gdgagent-svc` with `SupplementaryGroups=` for the slot socket groups — whose
  `--slots` follow `spec.slotCount`. It starts once `npm ci` has populated
  `/opt/agents-index/node_modules`; it needs no credential file. There is no separate installer.
- `langfuse-forwarder/` — standalone Node tool that reads xangi's
  `logs/observability/*.jsonl` and forwards it to Langfuse Cloud JP as sessions/traces/typed observations.
  Deployed to `/opt/langfuse-forwarder`, run by `langfuse-forwarder.timer` (every 5 min).
  See [docs/agents-observability.md](../docs/agents-observability.md) for the
  shared Langfuse conventions with the sibling `agents/` app.

## Setup (on the Ubuntu server)

Everything below is embedded in the `gdg` binary and driven by `gdg agent-host apply`.
`/opt/gdgjp` remains only for xangi's `file:` `gdg-lib` until Stage 13; agents-index no longer
depends on it.

Bootstrap a bare Ubuntu host with the single provisioning shell
(`scripts/install-gdg-agent-host.sh`, ~40 lines). It installs the apt prerequisites, fetches the
`gdg` CLI pinned by version + sha256 from `agent-host.json` to `/usr/local/bin/gdg` (plus the
`git-remote-gdg-wiki` symlink), and `exec`s `gdg agent-host apply`:

```bash
# from a checkout
sudo ./scripts/install-gdg-agent-host.sh

# or piped from the public repo (equivalent, no checkout needed)
curl -fsSL https://raw.githubusercontent.com/gdg-jp/gdgjp/main/scripts/install-gdg-agent-host.sh | sudo bash
```

Do **not** use `url.gdgs.jp/cli/install.sh` here: that installer places `gdg` under
`~/.local/bin`, tracks the latest release rather than the spec pin, and does not run the
converger.

`gdg agent-host apply` is Ubuntu-only for live paths. It installs the apt prerequisites and the
pinned Node, creates the uid-isolation users, writes `/opt/gdg-agent`, installs Cursor CLI and
[Harineko0/xangi](https://github.com/Harineko0/xangi) at `/opt/xangi`, deploys the agents-index
daemon to `/opt/agents-index`, and manages the systemd units — `xangi.service` /
`langfuse-forwarder.*` as `gdgagent-svc` `--user` units, `agents-index.service` as a system unit.
Re-running it converges only the differences; review first with
`sudo gdg agent-host apply --dry-run --diff`.

| Old `install.sh` invocation | Now |
| --- | --- |
| `sudo ./agent-host/install.sh` | `sudo gdg agent-host apply` |
| `sudo ./agent-host/install.sh --activate` | `sudo gdg agent-host secrets import` then `sudo gdg agent-host secrets login` |
| `sudo ./agent-host/install.sh --reload-config` | `sudo gdg agent-host apply` (or `--only systemd,git,exec` to scope) |
| `sudo ./agents-index/install.sh` | (folded in — `gdg agent-host apply` deploys and manages agents-index) |
| `sudo ./agent-host/lib/verify.sh` | `sudo gdg agent-host verify` |

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

`gdg agent-host apply` finishes successfully with no secrets present. `agents-index.service`
starts as soon as `npm ci` has run (no credential needed); `xangi.service` and
`langfuse-forwarder.timer` each stay stopped until their credential file
exists. `sudo gdg agent-host secrets login` runs `gdg login --device` as `gdgagent-svc` (needs a
TTY) before cloning the wiki; `sudo gdg agent-host secrets import` copies operator credentials
into the service and slot accounts.

After a config-only change (e.g. `backend.model` in `agent-host.json`) or a new `pins.xangi.ref`,
re-run `sudo gdg agent-host apply` — it re-pins `/opt/xangi`, regenerates the unit/drop-in files,
and restarts whichever units changed. Scope it with `--only systemd,git,exec` to skip the layout
pass.

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

## Updating skills and workspace content (Tier 1)

Skills and rules live in `agent-host/workspace/`:
- `.agents/skills/`
- `AGENTS.md` (automatically synthesized to `.cursor/rules/local.mdc`)

Push changes to `main`. The CI workflow (`.github/workflows/agent-host-workspace.yml`) validates `SKILL.md` frontmatter, verifies public content invariants, and packages a signed bundle with an Ed25519 detached manifest.

The host runs `agent-host-sync.timer` (every 5 minutes as `gdgagent-svc`), which runs `gdg agent-host sync-workspace`. It holds the wiki mutex to serialize against sleep ingest, verifies the Ed25519 signature against `/opt/gdg-agent/lib/release-key.pub`, defends against archive exploits, and atomically converges the worktree using Mode B write-ahead journals. No manual SSH or service restarts are required.

To manually inspect or sync:
```bash
sudo -u gdgagent-svc gdg agent-host sync-workspace --dry-run --diff
```

## Updating the wiki content

`wiki/` is a normal `gdg wiki clone` working tree once populated — use `gdg wiki raw pull`,
`gdg wiki ingest`, etc. from inside it exactly as documented in `.agents/skills/`.
