# agent-api

Server logic behind the CLI / agent read APIs (`/api/cli/wiki/*`, `/api/agent/*`). Read-only,
permission-aware; never touches Vectorize or embeddings (`app/routes/api/agent/architecture.test.ts`).

- `workspace.server.ts` — `resolveAgentWorkspace`: bearer-token → chapter/admin claims → bounded wiki workspace.
- `notes.server.ts` — agent notes: parse, access-floor, create-or-replace.
- `cli-wiki-human.server.ts` / `cli-wiki-raw-content.server.ts` / `cli-wiki-source-path.server.ts` — `gdg wiki` read helpers.
- `agents-md.server.ts` — `AGENTS.md` instruction sections. `cli-sync-helpers.ts` — sync-plan diffing for `/api/cli/wiki/sync`.

Caveat: `workspace.server.ts` / `notes.server.ts` import `workers/features/ingestion/**` workspace adapters by relative path.
