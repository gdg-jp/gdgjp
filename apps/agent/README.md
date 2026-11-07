# @gdgjp/agent

`agent.gdgs.jp` — the Discord and Google Chat front door of the knowledge platform
(v2 Stage 05). It resolves **who** a question is answered as, searches and reads the wiki
**as that reader** over the `WIKI` service binding, bundles the redacted results into an
`answer` job, and posts the runner's answer back. **It never calls an LLM.**

```sh
pnpm --filter @gdgjp/agent test
pnpm --filter @gdgjp/agent typecheck
pnpm --filter @gdgjp/agent migrate:remote
pnpm --filter @gdgjp/agent run deploy
DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… pnpm --filter @gdgjp/agent sync:discord-commands
```

| Route | Purpose |
|---|---|
| `POST /api/chat` | Discord Interactions endpoint and Google Chat HTTP endpoint (verified first) |
| `GET /auth/callback` | GDG Accounts OAuth (PKCE) callback for `/login` |
| `POST /internal/answer-ready` | the wiki's callback when a runner result arrives (`AGENT_SERVICE_TOKEN`) |

Commands: Discord `/ask` (`private: true` answers ephemerally with the asker's own
permissions), `/login`, `/unlink`, `/setup` (server managers: pick the wiki spaces this
server searches; the server becomes a viewer of them). `discord-commands.json` is the whole
desired global command set: `sync:discord-commands` replaces whatever Discord has. Google Chat: mention or
DM the app; `/login`, `/unlink`, `/setup <space-slug>` as message text.

## Who answers are generated as

| Where | Reader |
|---|---|
| Guild channel / Chat space | the guild / Chat space principal only, even for a linked organizer — everyone there reads the reply |
| DM, or "自分の権限で再回答" | the linked asker (ephemeral on Discord, a DM on Chat) |

If the runner's heartbeat is older than 60 s, or an answer misses its 90 s deadline
(`PendingSweeper` alarm, every 30 s), the reply is the top search hits only and the job
expires.

Secrets: see `.dev.vars.example`. Setup and cut-over: `docs/plans/knowledge-platform-v2/05-agent-worker.md`.
