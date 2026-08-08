# Stage 5b — Wiki agent API (file-exploration surface)

## Context — Background and Repository State

agent.gdgs.jp (Stage 5) answers operations questions from Google Chat / Discord by reading the Wiki. This
stage builds the read surface it calls: a **bounded, permission-aware virtual filesystem over the Wiki**,
exposed over HTTP and authenticated with the linked user's access token.

Nothing in this stage knows about Chat, Discord, Vercel, or Redis — it is testable on its own with `curl` and
a Bearer token.

**Dependencies:** Stage 3 (`index` / `log` pages, the type namespaces `events/` `venues/` `vendors/`
`people/` `orgs/` `playbooks/`, `pages.origin`).
**Blocks:** Stage 5e (agent tools call these routes).
**Target workspace:** `wiki/` only. Runs in parallel with 5a and 5c.

Stage overview: [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md).

### Query is exploration, not RAG

This is the central design constraint, and it comes from `llm-wiki.md`, the source pattern: the LLM reads the
index first to find relevant pages and then drills into them, which at this scale "avoids the need for
embedding-based RAG infrastructure."

The reason is structural. Synthesis has **already happened at ingest time** — the pages are the compiled
artifact, cross-references already there, contradictions already flagged. A query therefore navigates that
artifact the way a coding agent navigates a codebase, rather than re-deriving an answer from embedded chunks
on every question.

So this API is `ls` / `cat` / `search`, not a vector search endpoint. **Do not use Vectorize, embeddings, or
`createKnowledgeRetriever` anywhere in this stage.** The existing `/search` UI and `app/features/ai-search/`
keep their RAG implementation for interactive site search; that is a separate surface, untouched here.

### Existing implementations to reuse

**Almost all of this stage already exists.** The Wiki generation agent explores the Wiki through exactly this
kind of workspace, and `wiki/CLAUDE.md` records the rule it follows: *"The bounded, permission-aware Wiki
workspace exposes … generation never uses Vectorize."* This stage puts an HTTP surface on that same
workspace. Everything below is under
`wiki/workers/features/ingestion/`; read it before writing anything.

- `tools/workspace/contracts.ts` — `WorkspaceAdapter`, `WorkspaceEntry`, `ListResult`, `ReadResult`,
  `SearchResult`, and `WORKSPACE_LIMITS` (directory entries 25 default / 50 max; read 12 000 chars default /
  24 000 max; search 12 / 20; path depth 16; query length 160).
- `tools/workspace/wiki-adapter.ts` — `WikiWorkspaceAdapter`, which maps the `pages.parentId` hierarchy to
  slug paths lazily, checks `canView` on **every** node it lists, reads, or returns from search, and slices
  content with an offset cursor. Also `WorkspaceActor` and `resolveWikiWorkspacePage`.
- `persistence/d1/wiki-read-repository.ts` — `createD1WikiWorkspaceStore(db, actor)`, the D1 implementation
  of `WikiWorkspaceStore`. It already evaluates permissions through `getEffectivePagePermissions`.
- `tools/workspace/workspace.ts` — `MountedWorkspace` (the only absolute-path API; routes to mounted
  adapters, records provenance) and `createMountedWorkspace({ wiki })`, mounting `/wiki`, `/google-docs`,
  `/websites`.
- `tools/workspace/paths.ts` — `normaliseAbsoluteWorkspacePath`, `splitMountedPath`, `boundedLimit`,
  `decodeOffsetCursor`, `encodeOffsetCursor`, `cleanQuery`. **Path safety and pagination are solved here. Do
  not re-implement them in the route.**
- `getCliIdentity(request, env)` in `wiki/app/lib/cli-identity.server.ts` — Bearer token → `ACCOUNTS_URL` +
  `/api/auth/oauth2/userinfo` → `{ user: { id, email, name, image, isAdmin }, chapters: [{ chapterId, … }] }`
  or `null`. `chapterId` is numeric in claims, so callers do `String(c.chapterId)`.
- `createSource(env, input)` in `wiki/app/lib/sources.server.ts` — already requires an explicit `chapter`
  (`parseChapterSelection` → `chapter_required`, `canAssignChapter` → `forbidden_chapter`), inserts the row,
  and enqueues `SOURCE_FETCH_QUEUE`.
- `getDb(env)` in `wiki/app/lib/db.server.ts`.
- `wiki/app/routes/api.cli.wiki.snapshot.ts` — the template for a Bearer-authenticated API route.
- `wiki/app/routes/analyze.tsx:12` — precedent for an `app/routes/` module importing
  `../../workers/features/ingestion/…`. That direction is established; no new architectural boundary.

Two stale references to disregard: `wiki/CLAUDE.md` says the workspace exposes `ls/cd/pwd/cat/find/grep` —
the real catalog is `ls` / `cat` / `search`, and `architecture.test.ts` asserts `pwd|cd|find|grep` are *not*
tools. And earlier drafts of this plan specified a Vectorize-backed `/api/agent/search` extracted from
`rag-search.server.ts`; that is obsolete, and `rag-search.server.ts` stays untouched.

## Design

### 1. Route registration

Add to `wiki/app/routes.ts`, beside the `/api/cli/wiki/*` entries and **before** the
`route("*", "routes/$.tsx")` catch-all:

```ts
route("/api/agent/ls", "routes/api.agent.ls.ts"),
route("/api/agent/cat", "routes/api.agent.cat.ts"),
route("/api/agent/search", "routes/api.agent.search.ts"),
route("/api/agent/sources", "routes/api.agent.sources.ts"),
```

Paths are passed as a **query parameter**, not as a URL path segment. This sidesteps the splat-versus-`:slug`
problem entirely, and the workspace's own normaliser is the single place path safety is enforced. Modules
export `loader` (GET) or `action` (POST) only. Errors are always
`Response.json({ error: "<snake_case_code>" }, { status })` — never a thrown `Response`, and never
`requireUser`, which throws a sign-in redirect and is wrong for a machine API.

There is deliberately **no `/api/agent/index` route**. The catalog is just a page: `cat?path=/wiki/index`.
Reading it first is the agent's policy (Stage 5e), not a separate endpoint.

### 2. Per-request workspace construction

Factor into `wiki/app/lib/agent-workspace.server.ts`:

```ts
const identity = await getCliIdentity(request, env);
if (!identity) return null;                       // caller emits 401 invalid_token
const actor: WorkspaceActor = {
  userId: identity.user.id,
  email: identity.user.email,
  isAdmin: identity.user.isAdmin,
  chapterIds: identity.chapters.map((c) => String(c.chapterId)),
};
const store = createD1WikiWorkspaceStore(getDb(env), actor);
const workspace = createMountedWorkspace({ wiki: new WikiWorkspaceAdapter(store) });
```

`WorkspaceActor` is exactly the shape `getCliIdentity` yields — no adapter type is needed.

Build the workspace **per request**. `MountedWorkspace` accumulates traces and references for provenance and
is not shareable across callers; more importantly, the store closes over one actor's permissions, so reusing
an instance across requests would serve one user's authorized view to another.

`createMountedWorkspace` also mounts `/google-docs` and `/websites`, which resolve to `EmptyWorkspaceAdapter`
here. That is intended: **raw sources are not part of the Query surface.** Raw is primary material for Ingest;
Query answers from the reviewed Wiki layer. The empty mounts appear in `ls /` and return nothing.

### 3. Route contracts

| Route | Query parameters | Returns |
|---|---|---|
| `GET /api/agent/ls` | `path` (default `/`), `limit?`, `cursor?` | `{ path, entries: { name, path, readable, hasChildren, title? }[], nextCursor }` |
| `GET /api/agent/cat` | `path` (required), `maxChars?`, `cursor?` | `{ path, content, nextCursor }` |
| `GET /api/agent/search` | `q` (required), `path?`, `limit?`, `cursor?` | `{ matches: { path, title, snippet? }[], nextCursor }` |
| `POST /api/agent/sources` | JSON `{ url, chapter, refreshPolicy? }` | `createSource` result: 201 on success |

Return the adapter's `data` plus `truncated`. The `manifest` (traces and references) is internal provenance
for the generation pipeline — do not return it; it would leak the shape of pages the caller could not read.

`search` is D1-backed: `findPages` (title/slug `LIKE`) unioned with `searchPageBodies`, then filtered by
`canView`. That is the level of search `llm-wiki.md` calls for — "at small scale the index file is enough,
but as the wiki grows you want proper search."

For `POST /api/agent/sources`, call
`createSource(env, { url, chapter, refreshPolicy, user: identity.user, chapterIds })` and map its
`{ ok: false, error, status }` straight through.

### 4. Error mapping

The adapter signals failure by throwing `Error` with a small set of messages. Map them without leaking:

| Adapter condition | HTTP |
|---|---|
| `Workspace path not found` / `Workspace resource not found` | 404 `not_found` |
| `Workspace path is not mounted` / `Workspace mount is unavailable` | 404 `not_found` |
| `Workspace cursor is outside resource` | 400 `invalid_cursor` |
| Invalid or over-deep path from the normaliser | 400 `invalid_path` |
| Missing required parameter | 400 `path_required` / `query_required` |
| `getCliIdentity` returns `null` | 401 `invalid_token` |

**A page the caller cannot view must be indistinguishable from a page that does not exist.** The adapter
already does this — `cat` throws the same "not found" for both. Do not "improve" it into a 403; that turns
the API into an existence oracle for restricted pages. This is a deliberate departure from the rest of the
Wiki API, where 403 is used, and it is worth a comment in the code.

Do not pass the raw `Error.message` through to the response body — map to the codes above.

### 5. OpenAPI

`wiki/openapi/` is `$ref`-per-URL. Add one path file per route under `wiki/openapi/paths/`
(`agent.ls.yaml`, `agent.cat.yaml`, `agent.search.yaml`, `agent.sources.yaml`), each a bare operation map
with `security: [{ BearerAuth: [] }]`, copying the shape of `paths/snapshot.yaml` (GET) and `paths/sync.yaml`
(POST). Put schemas in `wiki/openapi/components/schemas/agent.yaml` and re-export them from
`components.schemas` in `openapi.yaml`. Then:

```bash
pnpm --filter @gdgjp/wiki openapi:generate
```

### Constraints

- **No Vectorize, no embeddings, no RAG in this path.** Do not import `createKnowledgeRetriever`,
  `performRagSearch`, `env.VECTORIZE`, or `env.AI` into any `api.agent.*` module. Query navigates the wiki
  that Ingest already synthesized; re-deriving answers from chunks is the pattern this project exists to
  replace.
- **No text generation.** Do not import `createWikiModel` or `createWikiLanguageModel`. Composing the answer
  is the Chat SDK agent's job (Stage 5e). Generating prose here would spend Gemini tokens on text the agent
  discards and produce citations it cannot attribute.
- **Never widen access.** Every route evaluates permissions with the caller's own token, through the store's
  `canView`. Do not add a service token, an internal shared secret, or an "agent reads everything" path. This
  is the reason restricted pages cannot leak into a Chat answer.
- **Do not re-implement path handling.** Use `normaliseAbsoluteWorkspacePath` and the adapter's resolution.
  A second path parser in the route layer is a second place for a traversal bug to live.
- Do not return the workspace `manifest` to the caller.
- Do not construct the workspace once at module scope. Per request, per actor.
- Do not modify `app/features/ai-search/**`, existing wiki routes, the D1 schema, or `wiki/migrations/`.
  This stage adds routes only.
- Do not insert into `sources` directly; go through `createSource`.
- `wiki/openapi/types.generated.ts` and `wiki/openapi/dist/openapi.yaml` are generated; `wiki/schema.sql` is
  a generated dump. Do not hand-edit them.
- Do not log page bodies or the caller's access token, including in error paths.
- Do not build the `agents/` workspace here — that is Stage 5c.
- Follow Biome and use `import type`.

## Files to touch

### `wiki/`

- `app/routes.ts` — four `route(...)` entries
- `app/routes/api.agent.ls.ts`, `api.agent.cat.ts`, `api.agent.search.ts`, `api.agent.sources.ts` (new)
- `app/lib/agent-workspace.server.ts` (new) — identity → `WorkspaceActor` → `MountedWorkspace`, and the
  error-to-status mapping
- `openapi/openapi.yaml`, `openapi/paths/agent.*.yaml` (new), `openapi/components/schemas/agent.yaml` (new)
- `app/routes/api.agent.*.test.ts` (new)
- `wiki/CLAUDE.md` — optional: correct the stale `ls/cd/pwd/cat/find/grep` line to `ls/cat/search`

## Verification — Completion Criteria and Validation

### Completion criteria

With a Bearer token for a member, `GET /api/agent/ls?path=/wiki` lists the top-level namespaces that member
can view; `GET /api/agent/cat?path=/wiki/index` returns the catalog page; `GET /api/agent/cat?path=/wiki/venues/umeda-hall`
returns that page's content; a page the member cannot view returns 404, identically to a page that does not
exist; and no route touches Vectorize, Workers AI, or a text-generation model.

### Commands

```bash
pnpm --filter @gdgjp/wiki openapi:generate
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

### Test setup

Model route tests on `wiki/app/routes/api.sources.$id.refresh.test.ts`: hand-mocked bindings with
`context: { cloudflare: { env } } as never`, and the `unstable_pattern` / `unstable_url` fields RR7's
`LoaderFunctionArgs` / `ActionFunctionArgs` types require. The workspace layer is already unit-tested in
`workers/features/ingestion/tools/workspace/workspace.test.ts` and `wiki-adapter.test.ts` — the route tests
cover the HTTP boundary (auth, parameter parsing, error mapping), not the adapter's internals. A fake
`WikiWorkspaceStore` is the cheapest fixture; it is a small interface with nine methods.

### Tests to establish as regressions

Permission and architecture properties, all of which fail silently in production if they regress:

- A `restricted` page whose caller is absent from `page_access` **does not appear** in `ls` of its parent, is
  **not returned** by `search`, and returns **404 — not 403** from `cat`. Assert the 404 explicitly; a future
  "improvement" to 403 must break a test.
- Every route returns 401 `invalid_token` when `getCliIdentity` returns `null`, and **performs no D1 query**
  in that case. Assert on the mock, not just the status.
- **An architecture test in the spirit of `workers/features/ingestion/architecture.test.ts`**: read the text
  of the four `api.agent.*.ts` modules plus `agent-workspace.server.ts` and assert it does not match
  `/VECTORIZE|knowledgeRetriever|embedding|createWikiModel|performRagSearch/i`. This is the cheapest possible
  guard on the stage's central design decision, and it is the one a future contributor is most likely to
  violate by reflex.
- Two callers with different permissions receive different `ls` results for the same path — proving the
  workspace is built per actor and not cached at module scope.
- A namespaced page resolves by hierarchy: `cat?path=/wiki/venues/umeda-hall` reaches the child page whose
  parent is the `venues` namespace page. (Stage 3 creates namespaces as **top-level pages that parent their
  children**, so this is a hierarchy walk, not a flat slug containing `/`.)
- `..`, a leading `//`, an over-deep path, and an over-long query are each rejected with 400 by the
  normaliser, and issue no query.
- A `cursor` past the end of a page returns 400 `invalid_cursor` rather than an empty 200.
- `limit` above `WORKSPACE_LIMITS.maxDirectoryEntries` is clamped, not honoured.
- The response body contains no `manifest` key.
- `POST /api/agent/sources` without a `chapter` returns 400 `chapter_required` and creates no row; for a
  chapter the caller does not belong to, 403 `forbidden_chapter`.

### Manual E2E

1. Obtain an access token for a test member (the Stage 3 CLI login flow issues one).
2. `curl -H "Authorization: Bearer $TOKEN" 'http://localhost:5177/api/agent/ls?path=/wiki'` → the namespace
   pages.
3. `curl '.../api/agent/cat?path=/wiki/index'` → the catalog.
4. Follow a link from the catalog: `curl '.../api/agent/ls?path=/wiki/venues'`, then
   `curl '.../api/agent/cat?path=/wiki/venues/<slug>'`. This is the exact path the agent will walk.
5. `curl '.../api/agent/search?q=umeda'` → matches with paths that `cat` accepts verbatim.
6. `curl '.../api/agent/cat?path=/wiki/../etc/passwd'` → 400.
7. Drop the `Authorization` header on each → 401.
8. As a member excluded from a known restricted page, confirm steps 2–5 neither list, match, nor return it,
   and that step 4's `cat` on it returns 404.
