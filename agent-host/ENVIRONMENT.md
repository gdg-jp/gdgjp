# Production environment (this host)

Snapshot of the self-hosted GDG agent on **<production-host>** (Ubuntu 24.04.3 LTS,
x86-64). Recorded 2026-08-20. Do not put Discord tokens, `gdg` credentials, or
Cursor `auth.json` in this file.

This is **not** the Vercel bot (`agents/` in gdgjp → `agent.gdgs.jp`). That stack
is documented in the monorepo’s `docs/agents-setup.md`.

For how the layout is *supposed* to be created, see [README.md](README.md) and
`docs/agents-local-mvp/07-ubuntu-host-install-2026-08-20.md` in gdgjp. This file
says **where things actually are on this machine**, including leftover operator
checkouts that are easy to confuse with production.

## Host

| | |
| --- | --- |
| Hostname | `<production-host>` |
| OS | Ubuntu 24.04.3 LTS, kernel 6.8.0-136-generic |
| Operator account | `<operator>` (uid 1000). Has sudo (password required). Not in `gdgwiki`. |
| `/usr/bin/node` | v22.23.2 (NodeSource). `wk` / spawners hard-code this path. |
| Cursor CLI | `/usr/bin/cursor-agent` → `/opt/cursor-agent/` (`2026.08.11-e8db854`) |
| `gdg` | `/usr/local/bin/gdg` 0.1.4; `git-remote-gdg-wiki` is a symlink to the same binary |

## Which checkout is which

Several clones of the same GitHub repos exist. **Production processes do not
use `/home/<operator>/*`.** Editing the wrong tree will not change what Discord
runs.

| Path | Remote | Role on this host | Typical HEAD when recorded |
| --- | --- | --- | --- |
| `/home/<operator>/gdgjp` | `https://github.com/gdg-jp/gdgjp.git` | **Operator working copy** of the monorepo (hooks, `gdg-lib`, this file via submodule). Not what systemd starts. | `226cb66` `main` |
| `/home/<operator>/gdgjp/agents-local` | `https://github.com/gdg-jp/agents.git` (gdgjp submodule) | **Operator working copy** of `agents-local`. Source for skills / `install.sh` / this doc. | `bba9c96` `main` |
| `/opt/gdgjp` | `https://github.com/gdg-jp/gdgjp.git` | **Install-time clone** (`install.sh` default). Root-owned. `@gdgjp/gdg-lib` for `/opt/xangi` resolves here (`file:../gdgjp/gdg-lib` → `/opt/gdgjp/gdg-lib`). Git from the operator uid hits “dubious ownership”. | `1651d69` `main` (older than `~/<operator>/gdgjp`) |
| `/opt/gdgjp/agents-local` | gitlink to `gdg-jp/agents` | **Unpopulated submodule** (only `.git`). Do not treat as a worktree. Recorded module HEAD `e4c3a2e`. |
| `/opt/gdgjp/agents` | in-tree Next.js app | Vercel Q&A bot sources inside the install clone. **Not** the Discord/xangi runtime. | (same as `/opt/gdgjp`) |
| `/opt/xangi` | `https://github.com/gdg-jp/xangi.git` | **Production xangi** checkout. systemd `WorkingDirectory`. Owned by `<operator>` on this host. | `d9a5aa6` (`feat/07-agent-uid-isolation`) |
| `/home/<operator>/xangi` | same remote | **Operator xangi** checkout. Ahead of `/opt/xangi` (sleep-cap commit). Not started. | `1e8cb1b` |
| `/home/<operator>/agents` | `https://github.com/gdg-jp/agents` | **Pre–Stage 07 operator workspace**. Operator `xangi.json` still points here. **Not** the live wiki. | `e4c3a2e` |
| `/srv/gdg-agent/wiki` | `gdg-wiki::https://wiki.gdgs.jp/api/cli/wiki` | **Live wiki worktree.** xangi `workspacePath`. `gdgagent-svc:gdgwiki` **2770**. Operator cannot `ls` it. | `gdg wiki clone` (not a GitHub clone) |
| `/home/<operator>/gdgjp/agents-local/wiki` | same `gdg-wiki::` URL | Submodule stub (root-owned `.git`, no live pages). **Not** production. | empty checkout |

`gdg-jp/agents` on GitHub is this repository (`agents-local/` in the monorepo).
The wiki content repo is **not** on GitHub; it is reached only through the
`gdg-wiki::` remote helper (`gdg`).

## Production runtime layout

```
Discord
  → gdgagent-svc  xangi.service  (systemd --user, linger)
       DATA_DIR  /home/gdgagent-svc/.local/share/xangi
       config    /home/gdgagent-svc/.config/xangi/   (xangi.json, secrets.json)
       gdg creds /home/gdgagent-svc/.config/gdg/credentials.json
  → sudo -u gdgagent-run-N /opt/gdg-agent/bin/spawn-slot-N
       HOME=/home/gdgagent-run-N
       cursor-agent + root-owned ~/.cursor/{hooks,cli-config,sandbox,mcp}.json
  → workdir /srv/gdg-agent/wiki   (shared by all slots)
       pages/ raw/ skills copied from agents-local
       memories/ gitignored conversation logs (xangi writes; slots use wk)

gdgagent-svc  langfuse-forwarder.timer  (systemd --user, every 5 min; optional)
     reads    DATA_DIR/logs/observability/*.jsonl  (xangi writes; append-only)
     config   /home/gdgagent-svc/.config/langfuse/credentials.json
     state    /home/gdgagent-svc/.local/share/langfuse-forwarder/
```

`/opt/langfuse-forwarder` is placed by `install.sh` (`ensure_langfuse_forwarder`) alongside
`/opt/xangi` and confirmed running on `<production-host>`: `langfuse-forwarder.timer` fires every 5
minutes and successfully forwards turns from `DATA_DIR/logs/observability/*.jsonl` to Langfuse.
(An earlier version of `write_langfuse_forwarder_unit()` hardcoded the wrong `DATA_DIR` here —
xangi's unused fallback default instead of `XANGI_SETUP_STATE_DIR` — which silently forwarded
nothing; fixed once `DATA_DIR` was made to match xangi's unit.)

| Path | Owner / mode | What lives there |
| --- | --- | --- |
| `/opt/gdg-agent/` | `root:root` | Installed hooks: `bin/wk`, `bin/gws`, `bin/gws-bin`, `bin/spawn-slot-0..3`, `bin/index-proxy`, `lib/*.ts` (from `cli/internal/wiki/hooks` + `agents-index/src/proxy.ts`) |
| `/srv/gdg-agent/wiki` | `gdgagent-svc:gdgwiki` 2770 | Only worktree `cursor-agent` is meant to see (`readBoundary: workspace`) |
| `/run/gdg-agent/<N>/` | svc + slot group 0750 | Per-slot sockets (`authz.sock`, `index.sock`). Recreated by tmpfiles |
| `/etc/sudoers.d/gdg-agent` | root 0440 | Exact spawn / pkill paths; no wildcards |
| `/etc/tmpfiles.d/gdg-agent.conf` | root 0444 | `/run/gdg-agent` dirs |
| `/home/gdgagent-run-<N>/.cursor/` | root sticky `1775`; policy json `0444` | User hooks / sandbox / MCP. `projects/` is slot-writable |
| `/home/gdgagent-run-<N>/.config/cursor/auth.json` | slot uid 0600 | Cursor login (copied from the operator; not committed) |
| `/opt/cursor-agent/` | root | Cursor CLI payload |

Worktree skills (`.agents/`, `.claude/`, `.codex/`) were copied from
`agents-local/` onto `/srv/gdg-agent/wiki`. There is **no** `.cursor/` inside
the wiki (avoids merging per-repo `sandbox.json` / `mcp.json`).

Slot MCP: `gdg-index` via `/opt/gdg-agent/bin/index-proxy` (unix socket under
`/run/gdg-agent/<N>/`). Google Workspace access is **not** MCP — it is the
official `gws` (`googleworkspace/cli`) invoked as a Shell command through a
mediator, same shape as `wk`:

```
cursor-agent Shell("gws ...")
  → /opt/gdg-agent/bin/gws            (wrapper, execs the mediator)
      exec node lib/gws.ts "$@"
  → cli/internal/wiki/hooks/gws.ts    (the only filtered surface; never the raw binary)
      1. re-validates argv against gwsAllowlist (exact "service resource method" triples,
         config/permissions.json → each slot's ~/.cursor/permissions.json)
      2. resolveAuthz() over the per-slot authz socket (/resolve) → gdgSub, the invoking
         Discord user's linked GDG account, or fails closed with "connect Google Workspace
         first" if unlinked
      3. resolveWorkspaceToken() over the same socket (/workspace-token) → a short-lived
         Google access token only, never a refresh token, never written to disk
      4. execs the real binary in a fresh per-invocation GOOGLE_WORKSPACE_CLI_CONFIG_DIR,
         with only GOOGLE_WORKSPACE_CLI_TOKEN set (client id/secret/credentials-file env
         vars cleared) so no credential planted in the slot's normal $HOME is ever picked up
  → /opt/gdg-agent/bin/gws-bin        (the real googleworkspace/cli binary, fixed non-PATH path)
```

`/workspace-token` is a **second** endpoint on the same per-slot authz socket
`/resolve` already uses (`XANGI_AUTHZ_SOCKET`/`XANGI_AUTHZ_NONCE`, unchanged
plumbing) — it lives in xangi (external repo, `gdgagent-svc`-owned process),
derives the target identity from the nonce itself (never a caller-supplied
sub), and is the only thing that can read `gdgagent-svc`'s own `gdg login`
credentials to call `accounts.gdgs.jp`'s token-vending endpoint on the linked
user's behalf. No slot process, and therefore no `gws` invocation, ever holds
a long-lived Google credential. `install.sh`'s `ensure_gws` installs the
pinned `gws-bin` release; there is no `uv`/`uvx` install step anymore, and no
per-slot OAuth env file — see `docs/agents-local-gws/plan.md` for the full
design and `agents-local/AGENTS.md` for the Discord-facing linking flow
(`/login` + "Connect Google Workspace" on `accounts.gdgs.jp`).

## OS users

| Account | uid (this host) | Job |
| --- | --- | --- |
| `gdgagent-svc` | 999 | xangi, Discord, IAM, `gdg` tokens, spawn via sudoers. Home `/home/gdgagent-svc`, shell `nologin`. Linger enabled. |
| `gdgagent-run-0` … `gdgagent-run-3` | 996–993 | One concurrent `cursor-agent` each. Cannot read svc credentials or DATA_DIR. |
| `gdgwiki` (group 987) | — | Shared write on `/srv/gdg-agent/wiki`. Members: svc + all four slots. |
| per-slot groups | 986–983 | Socket access. **On this host**, `gdgagent-svc` is also a member of each (needed so tsx-started xangi can `chown` `authz.sock`). |

Slots share one git worktree. Concurrent **repository** mutation is a later
mutex in xangi, not four parallel ingests.

## systemd

Production unit (enable + linger; start after Discord intents / token):

```
sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/999 systemctl --user status xangi.service
```

- Unit: `/home/gdgagent-svc/.config/systemd/user/xangi.service`
- Drop-in: `…/xangi.service.d/model.conf` — `AGENT_MODEL=composer-2.5`,
  `DISCORD_SHOW_THINKING=false`, `DISCORD_STREAMING=false`,
  `DISCORD_COMPLETION_NOTIFY=off`
- **This host’s `ExecStart`** (see deviations below):

  `/usr/bin/node /opt/xangi/node_modules/tsx/dist/cli.mjs /opt/xangi/src/index.ts`

Operator `<operator>` also has `~/.config/systemd/user/xangi.service`. It is
**disabled and inactive**. Re-enabling it with the same Discord token fights
the production bot. Operator `xangi.json` still has
`workspacePath=/home/<operator>/agents` and
`backendExecutable=/home/<operator>/.local/bin/cursor-agent` — leftover from
before uid isolation.

Production `xangi.json` (svc, 0700, not readable by `<operator>`):
`backend=cursor`, `workspacePath=/srv/gdg-agent/wiki`, `webChatAccess=local`.

`langfuse-forwarder.service` + `.timer` (planned, see note above — not yet observed running on
this host):

- Unit: `/home/gdgagent-svc/.config/systemd/user/langfuse-forwarder.service` (oneshot)
- Timer: `…/langfuse-forwarder.timer` — `OnUnitActiveSec=5min`
- `ExecStart`: `/usr/bin/node /opt/langfuse-forwarder/node_modules/tsx/dist/cli.mjs
  /opt/langfuse-forwarder/src/index.ts`
- Only starts if `/home/gdgagent-svc/.config/langfuse/credentials.json` is non-empty
  (`start_langfuse_forwarder` gate, same shape as the Discord token gate on `xangi.service`)

## Host-specific deviations from a clean `install.sh`

These are real on `<production-host>`; they are not all in the scripts.

1. **Two gdgjp trees, different commits.** Live `gdg-lib` for xangi is
   `/opt/gdgjp/gdg-lib`, which lags `/home/<operator>/gdgjp`. After changing ACL
   code, either update `/opt/gdgjp` or point the `file:` dependency at the tree
   you actually built.
2. **tsx in production.** ADR-022 wants Node-native TypeScript without tsx.
   `/opt/xangi/dist` cannot resolve `@gdgjp/gdg-lib` TypeScript sources, so the
   unit runs `tsx` against `src/index.ts`. Temporary host workaround.
3. **`gdgagent-svc` in every `gdgagent-run-*` group** so socket `chown` works
   after the tsx start. Restart `user@999.service` if you change supplementary
   groups; linger sessions do not pick them up otherwise.
4. **`/opt/xangi` is behind `/home/<operator>/xangi`.** Deploying sleep-cap or
   other fork commits means updating `/opt/xangi`, not only `~/<operator>/xangi`.
5. **`/srv` is `<operator>:<admin-group>`.** The wiki directory itself is still
   `gdgagent-svc:gdgwiki` 2770.
6. **Operator `gdg`** also exists at `/home/<operator>/.local/bin/gdg` (same
   0.1.4 binary as `/usr/local/bin/gdg`). Production clone/login uses the
   `/usr/local/bin` copy as `gdgagent-svc`.

## What to edit when changing behavior

| Change | Edit | Then |
| --- | --- | --- |
| Hooks, `wk`, ACL, spawn | this `gdg` binary (`gdg agent-host emit-layout`) | rebuild/install `gdg` after hook changes, then re-run `agent-host/install.sh` so `/opt/gdg-agent` matches |
| Skills, `AGENTS.md`, Discord channel list | this repo, then copy skills onto `/srv/gdg-agent/wiki` if needed | worktree is not updated by git pull of agents.git |
| Discord / spawn / sleep in xangi | `/opt/xangi` (or merge from `~/<operator>/xangi` then restart svc unit) | `systemctl --user restart xangi.service` as svc |
| Wiki pages | `/srv/gdg-agent/wiki` via `wk` / `gdg wiki *` as svc | never treat `~/<operator>/agents` or `agents-local/wiki` as live |
| Observability event schema | `xangi` `src/observability-logger.ts` + `agent-host/langfuse-forwarder/src/parse.ts` | v2 is append-only and records IDs, source, sequence, tool completion, Cursor events, and turn usage; keep v1 readable and quarantine only unsupported/malformed records |
| Langfuse trace/masking conventions | `agent-host/langfuse-forwarder/src/mask.ts`, `src/index.ts` | keep in sync with `agents/lib/langfuse.ts` and `docs/agents-observability.md` |

## Secrets (locations only)

| File | Who |
| --- | --- |
| `/home/gdgagent-svc/.config/xangi/secrets.json` | Discord bot token |
| `/home/gdgagent-svc/.config/gdg/credentials.json` | `gdg` device/login tokens |
| `/home/gdgagent-run-<N>/.config/cursor/auth.json` | Cursor CLI |
| `/home/gdgagent-svc/.config/langfuse/credentials.json` | Langfuse public/secret key, host, hash salt (optional — observability only) |
| Discord Developer Portal | Server Members Intent + Message Content Intent (cannot be set from the host) |

Web Chat, if enabled, must stay on localhost / Tailscale. It has no auth.
