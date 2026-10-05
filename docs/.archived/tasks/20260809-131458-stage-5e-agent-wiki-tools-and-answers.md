# Stage 5e — agent, Wiki tools, and answers

> Generated from Claude Code plan: `/Users/hari/proj/gdgjp/docs/plans/05e-agent-tools.md`

## Goal

Stage 5e — agent, Wiki tools, and answers

## Repo context

The final piece of Stage 5: the agent that reads the Wiki and answers in Google Chat / Discord. Everything it
needs already exists by this point — verified webhooks (5c), a per-user access token (5d), and the read API
(5b). This stage adds the tool definitions, the tool-order policy, the citation rule, the `/unlink` command
surface, and the operator setup document.

**Dependencies:**
- Stage 5b — `/api/agent/{index,search,page/*,sources}` deployed on wiki.gdgs.jp
- Stage 5d — `getLinkedToken(platform, chatUserId)` and the link/unlink functions in
  `agents/lib/link-account.ts`

**Target workspaces:** `agents/` and `docs/`.

Stage overview: [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md).

### Required reading

- `docs/plans/05b-wiki-agent-api.md` — the exact route contracts these tools call
- `docs/plans/05d-account-linking.md` — the token lifecycle these tools consume
- **`llm-wiki.md`** — the source pattern. Read the "Operations → Query" and "Indexing and logging" sections
  before designing the loop; they define what a query is supposed to do here.
- Chat SDK docs at `node_modules/chat/docs/` and `node_modules/chat/resources/` — cards, streaming, and
  slash-command surfaces per platform

### Existing implementations to reuse

- `agents/lib/verify.ts` (5c) — already runs before dispatch; do not re-verify or bypass.
- `agents/lib/link-account.ts` (5d) — token retrieval, refresh, linking URL generation, unlink.
- The Wiki API returns permission-filtered results already (5b). The agent adds no filtering of its own and
  must not attempt to.

## Acceptance criteria

### 1. Query is exploration, not RAG

The agent answers by **navigating the Wiki the way a coding agent navigates a codebase** — read the catalog,
list a namespace, read a page, follow a link — not by retrieving embedded chunks. `llm-wiki.md` is explicit
that the index-first read path "avoids the need for embedding-based RAG infrastructure," and it is the reason
the Stage 5b API is `ls` / `cat` / `search` with no Vectorize in it. Synthesis already happened at ingest
time; a query walks the artifact that Ingest produced.

Practically, this shapes the loop: the agent should be willing to make **several cheap reads** before
answering, and the system prompt should encourage exploring the tree rather than settling for the first
`search` hit. Give it enough steps to do that — a loop capped at two or three tool calls collapses back into
retrieval-and-answer.

### 2. Tools

`agents/lib/tools/wiki.ts` defines three read tools plus one write tool, mirroring the Stage 5b routes one
for one. Every call attaches the linked user's access token as `Authorization: Bearer <token>`, obtained
through Stage 5d's accessor so refresh is handled centrally.

| Tool | Calls | Returns to the model |
|---|---|---|
| `wiki_ls` | `GET /api/agent/ls?path=` | `{ name, path, readable, hasChildren, title? }[]` and `nextCursor`. Path `/wiki` lists the type namespaces. |
| `wiki_cat` | `GET /api/agent/cat?path=` | Page content and `nextCursor`. Paths come from `wiki_ls` / `wiki_search` verbatim. |
| `wiki_search` | `GET /api/agent/search?q=&path=` | `{ path, title, snippet? }[]`. Title and body matching, optionally scoped to a subtree. |
| `wiki_add_source` | `POST /api/agent/sources` | Registration result, for "please read this document too". |

Surface `nextCursor` to the model and let it continue explicitly. Do not auto-paginate an entire page or
directory into the context — the bounds in `WORKSPACE_LIMITS` exist to keep a single tool call cheap.

**Read `/wiki/index` first.** The catalog is what tells the agent which namespaces exist and what is in them,
so a `search` issued before it misses whole page classes. Enforce this in the loop or the tool layer — not
only in the system prompt — for example by rejecting `wiki_search` and `wiki_cat` until `/wiki/index` has
been read in this conversation. Prefer `wiki_ls` over `wiki_search` when the catalog already names the
namespace; search is the fallback for when the tree does not obviously contain the answer.

**`wiki_add_source` requires an explicit chapter.** The Wiki API returns 400 `chapter_required` when the
field is absent — that is deliberate ([01-sources-raw-layer.md](01-sources-raw-layer.md) made visibility a
mandatory registration input). When the linked user belongs to exactly one chapter the agent may fill the
field itself; otherwise **it must ask in Chat before submitting**. Do not send the `ALL_CHAPTERS` sentinel
without the user having chosen it.

### 3. Agent

`agents/lib/agent.ts` — an AI SDK `ToolLoopAgent` over the tools above.

- **Unlinked user:** before any tool call, resolve the link. If absent, reply with the linking URL from
  Stage 5d and stop. **No Wiki API call is made for an unlinked user.**
- **Citations are mandatory.** Every answer includes links to the Wiki pages it drew on, built from the
  workspace paths the tools returned. An answer the operations team cannot trace back to a page is not usable
  for event decisions.
- **Say when the Wiki does not know.** If exploration turns up nothing relevant, say so and offer to register
  a source, rather than answering from the model's own knowledge. A confident answer about a venue that is
  not in the Wiki is worse than no answer.
- **A 404 means "not found or not yours" and is not an error to retry.** Stage 5b deliberately returns 404
  for pages the caller cannot view. The agent must not probe around a 404 to determine whether a page exists.
- `/unlink` calls Stage 5d's unlink function (record deletion **and** IdP revocation) and confirms in Chat.

### 4. Operator documentation

`docs/agents-setup.md` — the manual steps no code can perform, written so a second person can repeat them:
Google Cloud Chat app configuration (HTTP endpoint, project number → `GOOGLE_CHAT_AUDIENCE`), Discord
application registration (interactions endpoint, public key → `DISCORD_PUBLIC_KEY`), Vercel project creation
and the full environment-variable list, generating `TOKEN_ENCRYPTION_KEYS` and rotating a key, the
`VERCEL_PROJECT_ID_AGENTS` repository secret, and the `agent.gdgs.jp` → Vercel DNS record on Cloudflare.

### Constraints

- **Never widen access.** The agent calls the Wiki API only with the linked user's token. Do not add a
  service token, a shared secret, or a fallback identity for unlinked users.
- **Do not add retrieval on this side.** No embedding, no vector store, no local index of page content, and
  no "fetch every page and let the model sort it out". The agent explores the Wiki through the Stage 5b
  tools. Query answering the RAG way is the pattern this project exists to replace.
- **Do not cache page content across users.** A response cache keyed by path alone serves one user's
  restricted page to another. Key any cache by `(platform, chatUserId)` or do not cache.
- Do not log Chat conversations, page bodies, or tokens — including in error paths.
- Do not bypass or re-implement Stage 5c's verification.
- Do not filter or re-rank results by inventing permission logic in the agent. The API is the authority.
- Do not change the Wiki API contract from this side. If a route needs to change, amend Stage 5b.
- Do not send `ALL_CHAPTERS` to `wiki_add_source` unless the user explicitly chose it.
- `agents/` targets Vercel. Do not rewrite it for Cloudflare Workers.
- Follow Biome and use `import type`.

## Files to touch

### `agents/`

- `lib/tools/wiki.ts` (new) — the four tool definitions
- `lib/agent.ts` (new) — ToolLoopAgent, system prompt, tool-order enforcement
- `app/api/chat/route.ts` — dispatch verified events into the agent; `/unlink` command
- `lib/tools/wiki.test.ts`, `lib/agent.test.ts` (new)

### `docs/`

- `docs/agents-setup.md` (new)

## How to verify

### Completion criteria

Asked in Google Chat, "Suggest venue candidates for the next event based on past results," the agent answers
with citations, drawing only on pages the asking member is authorized to see. An unlinked user receives a
linking URL and triggers no Wiki call. A request that is not signed by Google Chat or Discord is rejected
with 401 before any of this runs.

### Commands

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm ci:quick
```

### Tests to establish as regressions

- **An inquiry from an unlinked user does not reach the Wiki API** — assert on the fetch mock, not only on
  the reply text.
- Every Wiki call carries `Authorization: Bearer <the linked user's token>`; no call is made without one.
- **`/wiki/index` is read before any `wiki_search` or `wiki_cat`.** A model attempting `wiki_search` first is
  refused by the tool layer, not merely discouraged by the prompt.
- Given a question whose answer sits two levels down (`/wiki/venues/<slug>`), the agent reaches it by
  `wiki_ls` / `wiki_cat` rather than by a single `wiki_search` — pin that the exploration path is actually
  used, since a loop that always shortcuts to search is the regression this design is guarding against.
- The agent passes paths returned by `wiki_ls` / `wiki_search` to `wiki_cat` **verbatim**, without
  reconstructing them from titles.
- `nextCursor` is followed only when the model asks for more, not automatically drained.
- An answer contains a link to every page it cites.
- With exploration turning up nothing relevant, the agent says the Wiki has no answer instead of producing
  prose from model knowledge.
- A 404 from `wiki_cat` is reported as "not found", and the agent does not retry the same path or probe
  neighbouring paths.
- `wiki_add_source` with a multi-chapter user and no chapter chosen **asks in Chat and issues no POST**.
- `wiki_add_source` propagates the API's 400 / 403 to the user rather than retrying with a different chapter.
- A 401 from the Wiki API (expired or revoked token) surfaces as a re-link prompt, not as a bare error.
- No response cache is shared across `(platform, chatUserId)` — two different linked users reading the same
  path each cause their own authorized fetch.
- A source-text guard over `lib/tools/wiki.ts` and `lib/agent.ts` asserting no match for
  `/embedding|vector|VECTORIZE/i`, mirroring the guard Stage 5b puts on the Wiki side.

### Manual E2E

1. Receive a Google Chat event through Chat SDK local webhook forwarding.
2. `curl` the webhook endpoint with no `Authorization` header → 401, and confirm the Wiki logs show no
   request.
3. Make an inquiry as an unlinked user → a linking URL is returned.
4. Link the account, then make the inquiry again → an answer with citations.
5. **Read the tool trace for that answer.** Confirm it starts at `/wiki/index` and walks the tree — this is
   the behaviour the design is for, and it is invisible from the answer text alone.
6. **Confirm the answer contains no content from pages the asking user is not authorized to access** — use a
   member who is excluded from a known restricted page and check that page is neither cited nor quoted.
7. Ask the same question as a second, differently-permissioned member and confirm the answers differ where
   permissions differ.
8. Paste a Google Docs URL and say "please read this too" → the agent asks which chapter (multi-chapter
   user), then registers it in `sources` with the chapter that was explicitly chosen.
9. Run `/unlink`, then repeat step 3 and confirm the linking URL is returned again.
10. Repeat steps 3–6 on Discord and confirm the Discord user ID resolves to its own link.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
