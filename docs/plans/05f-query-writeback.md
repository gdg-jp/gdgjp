# Stage 5f — Query write-back (answer first, then update the Wiki)

> Generated from Claude Code plan: `/Users/hari/.claude/plans/create-a-plan-binary-iverson.md`

## Goal

Stage 5f — Query write-back (answer first, then update the Wiki)

## Repo context

`llm-wiki.md` states under **Operations → Query** that good answers should be filed back into the
Wiki so that explorations compound in the knowledge base the same way ingested sources do, and that
each query should leave a `## [YYYY-MM-DD] query | …` entry in `log`. The shipped `/ask` agent does
neither: `handleInquiry` in `agents/lib/agent.ts` explores and answers, and the Wiki is left exactly
as it was. Its read-only nature is also why it is fast, and that speed must be preserved.

This stage adds the missing half: **the reply goes out unchanged, then a background pass writes to
the Wiki layer.** The answer path is not touched — no new tools, no larger system prompt, no extra
tool round trips — so latency and per-answer token cost are unchanged.

**Dependency:** Stage 5e (`agents/lib/agent.ts`, `agents/lib/tools/wiki.ts`), Stage 5b
(`/api/agent/*`), Stage 3 (namespaces, `index` / `log`, `origin`).
**Target workspaces:** `wiki/`, `agents/`, `docs/`.

### Required reading

- **`llm-wiki.md`** — "Operations → Query" and "Indexing and logging". These define what a query is
  supposed to leave behind, and they are the reason this stage exists.
- `docs/plans/05b-wiki-agent-api.md` — the read API and its error-mapping conventions, which the new
  write routes must match.
- `docs/plans/05e-agent-tools.md` — the answer loop this stage must **not** slow down.
- **`docs/plans/03a-agents-md.md`** — the `AGENTS.md` full text. Sections `### Citations` and
  `## Sensitive information` are consumed at runtime by this stage (§6); the placement table in it
  must gain the new namespace.
- `docs/plans/00-llm-wiki-overview.md` — the cost split (fetch in the cloud, integrate locally).

### Decisions already made with the user

| Topic | Decision |
|---|---|
| Where a filed answer goes | **A real Wiki page** under a new reserved namespace — not the raw layer |
| `log` entries | **Every successfully answered query**, whether or not a page was filed |
| DM / 1:1 questions | Filed the same as channel questions. Consequence: a private question and its answer become readable by the chapter. Accepted deliberately; do not add a gate |
| Raw (`/google-docs`, `/websites`) | Stays unreadable from the query side. Empty mounts are intentional |
| The answer path | Unchanged. All writing happens after the reply |

### Existing implementations to reuse — do not rewrite these

- `wiki/app/lib/agent-workspace.server.ts` — `resolveAgentWorkspace(request, env)` returns
  `{ identity, workspace, chapterIds }` already scoped to the Bearer token's actor;
  `agentUnauthorized()` and `mapWorkspaceError()` give the Stage 5b error vocabulary.
  **Every new route starts here.** `wiki/app/routes/api.agent.sources.ts` is a 30-line template.
- `wiki/app/lib/page-access.server.ts` — `getEffectivePagePermissions`, `getPageAccessList`,
  `insertPageOwner`, `isGeneralAccess`, `isPageRole`. Permission evaluation is solved; do not write
  a second evaluator.
- `wiki/app/routes/api.cli.wiki.sync.ts:255-340` — the canonical page INSERT column list, and
  `buildNewPageLocaleValues` / `canonicalMarkdown` in `api.cli.wiki.sync.helpers.ts` /
  `~/lib/content-format`. Copy the shape; do **not** call the route.
- `wiki/app/lib/queue-processors.server.ts` — `sendOrRunTranslation(env, ctx, pageId)`.
- `wiki/app/lib/agents-md.server.ts` — `getAgentInstructions(db)`, `agentsHash`,
  `INITIAL_AGENTS_MD` (seeded from the fenced block in `docs/plans/03a-agents-md.md`).
  AGENTS.md is **DB-authoritative** in `wiki_agent_instructions` and admin-editable.
- `wiki/migrations/0038_seed_namespaces.sql` — the exact pattern for seeding a namespace page
  (fixed id, `origin='agent'`, `status='published'`, `visibility='restricted'`, admin-or-
  `wiki-system` author, `WHERE NOT EXISTS`).
- `agents/lib/redis.ts` — `REDIS_KEY_PREFIX`, `LinkRedis.setNX(key, value, ttl)`.
- `agents/lib/link-account.ts` — `getLinkedToken` handles refresh centrally.
- `agents/app/api/chat/route.ts:63` — `waitUntil` is already implemented with `after()` from
  `next/server`; the entire reply already runs in a post-response continuation. The filing pass
  extends that continuation rather than introducing a new mechanism.
- `pages.sync_revision` (`wiki/app/db/schema.ts:131`) — existing optimistic-concurrency column.

### Facts that shape the design

- `POST /api/cli/wiki/sync` requires per-page `canEdit` (`api.cli.wiki.sync.ts:184`). Ordinary
  chapter members do not have it on a namespace page, so **the filing pass cannot use sync.**
- There is no programmatic append to `log` anywhere in the repo today. The convention is enforced
  only by prose in AGENTS.md, and the only mechanical write is a full-content read-modify-write.
- The `AGENTS.md` payload measures 13.4 KB / 207 lines / **≈3.3–4.2k tokens**. Placing it in the
  answer path's system prompt would re-send it on each of the `AGENT_MAX_STEPS = 12` steps
  (≈40k input tokens per answer) for rules the answer path never uses. It belongs only in the
  background pass, and only as a slice (§6).

## Acceptance criteria

### 1. Two-phase split

**Phase A — answer path: unchanged.** `handleInquiry` → `runWikiAgent` → post the reply. Tool set
stays exactly `{ wiki_ls, wiki_cat, wiki_search, wiki_add_source }`. No write tools, no AGENTS.md,
no extra steps. This is the property the whole stage is arranged to protect, and §10 pins it with a
test.

**Phase B — filing pass.** Runs after the reply has been posted, inside the same `after()`
continuation. It receives the finished `RunWikiAgentResult` and **does not re-explore the Wiki** —
one structured LLM call over material already in hand, then at most three HTTP writes. Cost is
roughly one short call per answered query, not a second 12-step loop.

### 2. New namespace and page type

A new top-level namespace, seeded exactly like the Stage 3 ones.

| Field | Value |
|---|---|
| id | `ns-answers` |
| slug | `answers` |
| `page_type` | `answer` (new) |
| `sort_order` | `70` |
| `origin` / `status` / `visibility` / `general_role` | `agent` / `published` / `restricted` / `viewer` |
| titles | 回答 / Answers |

Add `answer` to the `pageType` enum in `wiki/shared/ingestion/domain.ts` and to the column comment
in `wiki/app/db/schema.ts:116`.

**Answer pages stay editable and archivable by humans in the Wiki app.** Do not extend the
`wiki-index` / `wiki-log` read-only guards (`wiki/app/routes/wiki.$slug.edit.tsx:74`,
`wiki.$slug.tsx:246`, `api.pages.reorder.ts:33`) to cover them. These are the lowest-trust pages in
the Wiki — model-written from a chat transcript with no new primary source — so pruning them must
be easy. `origin: 'agent'` already shows the "edits may be overwritten" editor warning.

Because they are ordinary `origin: 'agent'` pages, they appear in `pages/answers/**` of a clone and
in `ls`/`cat`/`search` immediately. That is deliberate: the next query finds prior answers through
the catalog, which is the compounding `llm-wiki.md` describes.

### 3. `POST /api/agent/notes` — the bounded write route

```
POST /api/agent/notes            Authorization: Bearer <linked user's token>
{
  slug: string,                  // ^[a-z0-9]+(?:-[a-z0-9]+)*$, ≤160 — matches sync's PagePayload
  title: string,                 // ≤200
  summary: string,               // ≤300, one or two sentences
  content: string,               // ≤8000 markdown
  citedPaths: string[],          // 2..12 workspace paths
  replaceId?: string             // an existing answer page to overwrite
}
→ 201 { id, slug, path: "/wiki/answers/<slug>", pageUrl, created: true }
→ 200 { …, created: false }     // replaceId path
```

**The server fixes every field that carries authority.** `parent_id = 'ns-answers'`,
`page_type = 'answer'`, `origin = 'agent'`, `status = 'published'`, `visibility = 'restricted'`,
`general_role = 'viewer'`, `author_id = last_edited_by = identity.user.id`, and `chapter_id` derived
per §4. The request body cannot name a parent, a page type, a visibility, or a chapter. Reject
unknown body keys.

**Authorization predicate** — deliberately *not* `canEdit` on the namespace:

1. `resolveAgentWorkspace` resolves the Bearer token, else `401 invalid_token`.
2. The caller belongs to ≥1 chapter, else `403 no_chapter_membership`.
3. Every `citedPaths` entry resolves through **the caller's own workspace** (§4), else
   `400 invalid_citation`.
4. `replaceId`, when present, must name a page with `parent_id = 'ns-answers'`,
   `page_type = 'answer'`, `origin = 'agent'`, and must be viewable by the caller — otherwise
   `404 not_found`, never 403, per the Stage 5b existence-oracle rule.

This is safe to grant to any chapter member because the route's authority is a **constant, not a
caller-supplied value**: it can only create or replace a leaf under one hard-coded parent, it cannot
widen visibility, and it cannot touch any page outside the namespace. Write that reasoning as a
comment in the route — it is the question a reviewer will ask.

**Dedup.** Slug collision under `ns-answers` without `replaceId` → `409 slug_exists` with the
existing `path`. The filing pass handles this by skipping (§7); it does not invent a suffix. Because
prior answer pages are visible to the answer path through `wiki_ls /wiki/answers`, the normal way to
update one is that the agent read it while answering, and the filing pass then supplies `replaceId`.

On update, insert a `page_versions` row first, exactly as `api.cli.wiki.sync.ts:328` does, and bump
`sync_revision`. Enqueue translation with `sendOrRunTranslation(env, context.cloudflare.ctx, id)`.
After a successful write, upsert the catalog line (§5).

### 4. Visibility invariant — the correctness crux

**A filed note must never be readable by anyone who could not have read its inputs.** This is
enforced server-side, from the cited pages, never from the request body.

Resolve each `citedPaths` entry through the workspace built for the caller's actor
(`resolveAgentWorkspace` already returns it), which proves the caller could read it and yields the
page row. Then compute the access floor over the cited set:

| Cited-set condition | Outcome |
|---|---|
| Any cited page has explicit `page_access` rows (per-page ACL) | **Refuse — `409 citations_span_access`** |
| Cited pages carry two or more distinct non-null `chapter_id` | **Refuse — `409 citations_span_chapters`** |
| All cited pages share one non-null `chapter_id` | Use it; require the caller is a member, else `403 forbidden_chapter` |
| All cited `chapter_id` are null (chapter-wide) | Use the caller's chapter when they have exactly one; otherwise `409 chapter_ambiguous` |

Refusing rather than intersecting ACLs is the deliberate choice: copying an access list is a feature
in its own right, and a subtle bug in it leaks a restricted page into a chapter-wide one. Refusal is
conservative, cheap, testable, and rare. The filing pass treats every refusal as "do not file" and
still writes the log entry (§7).

`visibility` is hard-coded `restricted`; there is no code path to `unlisted` or `public`. Reuse
`canAssignChapter`-style membership checking rather than reimplementing it.

### 5. `POST /api/agent/log` — atomic append, and the catalog line

```
POST /api/agent/log
{ subject: string, lines: string[] }
→ 204
```

The server composes the entry; the caller never supplies the heading:

```
## [YYYY-MM-DD] query | <subject>

- <line>
```

`type` is fixed to `query` for this route — `ingest` and `lint` entries stay with the CLI. The
format lives in `wiki/app/lib/wiki-catalog.server.ts`, which is why the filing prompt never needs
the `## index と log` section of AGENTS.md.

**Atomicity.** Append in one statement — no read-modify-write, so concurrent queries cannot lose
each other's entries:

```sql
UPDATE pages
   SET content_ja = content_ja || ?, content_en = content_en || ?,
       updated_at = unixepoch(), sync_revision = sync_revision + 1
 WHERE id = 'ns-log'
```

Append the identical text to both locales and do **not** enqueue translation: entries are dates,
titles, and paths.

**Input hardening.** `subject` ≤200 chars, ≤8 lines ≤200 chars each; strip `\r?\n` and a leading
`#` from every field before composing. Otherwise a question containing `## [2020-01-01] ingest | …`
forges a log entry — this is untrusted text arriving from a chat message.

**Authorization:** any linked chapter member. Justified because the payload is bounded,
server-formatted, append-only, and attributed. Rate limiting lives on the `agents/` side — the
Redis idempotency key (§7) already caps it at one append per inquiry.

**The catalog line** is different and lives in the same module as
`upsertIndexEntry(db, { section: "Answers", slug, title, summary })`. It inserts
`- [<title>](answers/<slug>) — <summary>` under a `## Answers` heading in `index`, creating the
heading if absent, and replaces the line when the slug already appears. This one *is* a
read-modify-write, so guard it with `sync_revision` and retry once on mismatch. That asymmetry is
fine and deliberate: log writes are on the hot path of every query, index writes happen only when a
page is filed.

Answers must appear in `index`, not only under `wiki_ls /wiki/answers` — the answer loop reads the
catalog first and walks the namespaces the catalog names, so an unlisted namespace is effectively
invisible to it.

### 6. `GET /api/agent/instructions` — the AGENTS.md slice, single-sourced and fail-closed

Because the server fixes all front matter, the only prose the filing model needs is the citation
rule and the sensitive-information categories. Serve exactly those, extracted from the
**DB-authoritative** AGENTS.md so there is never a second copy to drift:

```
GET /api/agent/instructions?profile=query
→ 200 { profile: "query", content, contentHash }
→ 503 { error: "instructions_unavailable" }
```

`extractInstructionSections(markdown, headings)` in `wiki/app/lib/agents-md.server.ts` slices by
exact heading text (`## Sensitive information`, `### Citations`) up to the next heading of the same
or higher level. That is roughly 35 lines / ≈600 tokens — about a sixth of the full document, and it
never reaches the answer path.

**Fail closed.** If either heading is missing (an admin renamed one), return 503 and have the filing
pass **skip filing entirely**, recording `Needs action: filing rules unavailable` in the log entry.
Writing pages into the Wiki with no sensitive-information rules in context is the failure this
guards against, and silent degradation is exactly how it would happen. A unit test asserts
extraction is non-empty against `INITIAL_AGENTS_MD`.

Caching this response in the `agents/` process is fine and should be done (short TTL, keyed by
`contentHash`). It is identical for every caller, so it is not the per-user page-content caching
that Stage 5e forbids — say so in a comment so nobody "fixes" it.

**Required non-code step.** The production AGENTS.md lives in `wiki_agent_instructions` and is only
changed by an administrator pushing `AGENTS.md` through the Wiki Git remote. Adding the `answers/`
namespace therefore has an operational half:

1. Update `docs/plans/03a-agents-md.md` — add the `answers/` row to the placement table, state that
   answer pages are agent-written from Chat queries and are the lowest-trust class, and add a Lint
   item: *promote durable content from answer pages into the proper entity/playbook page and archive
   the answer; delete answers a newer source has superseded.* This makes fresh databases seed
   correctly.
2. An administrator must push the same text to production AGENTS.md and record why in `log`, per
   `03a-agents-md.md:9`. Ship this stage with that step called out in the PR description; the
   migration alone will not update an existing database.

### 7. The filing pass in `agents/`

New `agents/lib/filing.ts`, invoked from `registerAgentHandlers` in `agents/lib/agent.ts`
**after** `thread.post(...)` / `event.channel.post(...)`.

New `agents/lib/wiki-write.ts` holds plain `async` client functions — `postNote`, `postLogEntry`,
`fetchFilingInstructions` — deliberately **not** AI SDK `tool()` definitions, so there is no object
that could be spread into the answer loop's tool set by accident.

**Cited paths come from the tool trace, not the model.** Walk `result.steps[].toolResults` and
collect the paths that `wiki_cat` and `wiki_search` actually returned. This makes the citation set
mechanically trustworthy and means the model cannot cite a page it never read.

**Gate — default is not to file.** Code-enforced preconditions, all required:

- `outcome.kind === "answer"` (never on `needs_link`, `needs_relink`, `temporarily_unavailable`)
- no `needsRelink` in any tool result
- ≥2 distinct cited page paths
- answer text ≥200 characters

Only then, one `generateObject` call (`agents/lib/agent.ts`'s `defaultAgentModel()`), with the §6
slice plus a short filing prompt, producing:

```ts
{ file: boolean, reason: string,
  slug?: string, title?: string, summary?: string, content?: string, replacePath?: string }
```

The model judges the remaining, genuinely subjective criterion: the answer is a **reusable
synthesis** — a comparison, a recommendation, a procedure drawn from several pages — and is not
already fully covered by one of the pages it cited. A single-fact lookup ("what is the capacity of
X") must return `file: false`. State in the prompt that `false` is the expected common answer.

**Always write the log entry**, whichever way the gate went — that is the user's decision and the
demand signal is the point. Subject is the truncated question; lines carry the cited paths, and the
filed page link or the reason nothing was filed.

**Idempotency.** Take `setNX(filingKey(platform, messageId), "1", 86400)` in Redis before any work;
a webhook retry finds the key and returns immediately.

Getting `messageId` needs a small piece of plumbing. `verifyWebhook` **already computes exactly the
right value** — `agents/lib/verify.ts:231` returns the Google Chat JWT `jti`, and `:315` the Discord
interaction id — and it is already the replay-dedupe identity. But it stays inside
`app/api/chat/route.ts`, and `SlashCommandEvent` (`chat` package) carries no message id of its own,
only `raw`. Handlers are registered once behind a `WeakSet`, so it cannot be passed at registration
time either.

Thread it with an `AsyncLocalStorage` in a new `agents/lib/request-context.ts`, entered in
`route.ts` around the `bot.webhooks.*` call. **Verify this early**: the filing pass runs inside the
`after()` continuation, and although the promise chain is created within the ALS scope (so context
should propagate), confirm it with a test before building on it. If it does not hold, fall back to
extracting the id from `event.raw` per platform, the way `discordGuildId` already does in
`agents/lib/agent.ts:287`.

Last-resort fallback when no id is available: a hash of `(platform, chatUserId, question)` with a
**10-minute** TTL rather than 24 hours — long enough to absorb a retry, short enough that a genuine
re-ask of the same question is not silently suppressed.

**Failures are swallowed.** The entire pass is wrapped; any throw or non-2xx is counted and dropped.
The reply has already been delivered and this is bookkeeping — it must never surface in Chat, and a
409 from §4's refusal branches is an ordinary, expected outcome, not an error.

**`maxDuration`.** `agents/vercel.json` sets none today, and `after()` work counts against the
invocation's budget. Add `export const maxDuration = 300` to `agents/app/api/chat/route.ts` and
confirm the Vercel plan permits it before merging; if it does not, lower it and say so in the PR.

### Constraints

- **Do not add write tools to `createWikiTools`.** The answer path's tool set is
  `{ wiki_ls, wiki_cat, wiki_search, wiki_add_source }` and nothing else. A write tool there is the
  regression this stage is most likely to cause, and it silently costs latency on every answer.
- **Do not put AGENTS.md — whole or sliced — in `SYSTEM_INSTRUCTIONS`.** It is re-sent on every one
  of the 12 loop steps for rules the answer path never applies.
- **Do not open raw to the query side.** `/google-docs` and `/websites` stay empty mounts. Raw holds
  precisely what the sensitive-information policy strips, and its permissions are chapter-level
  where pages are per-page.
- **Do not call `POST /api/cli/wiki/sync` from `agents/`.** It requires a `canEdit` members lack and
  its surface is vastly wider than needed. The bounded route in §3 is the whole point.
- Never accept `parentId`, `pageType`, `visibility`, `generalRole`, or `chapterId` from a request
  body on `/api/agent/notes`. Deriving them server-side is what makes the route safe to expose.
- Do not intersect or copy `page_access` ACLs onto a filed note. Refuse instead (§4).
- Do not re-implement permission evaluation; use `getEffectivePagePermissions` and the workspace
  adapter, which already check `canView` on every node.
- Do not log chat text, page bodies, questions, or tokens — including in error paths.
- `wiki/schema.sql`, `wiki/worker-configuration.d.ts`, `wiki/openapi/types.generated.ts`,
  `wiki/openapi/dist/openapi.yaml`, and `cli/internal/wiki/openapigen/openapi.gen.go` are generated.
  Regenerate; never hand-edit.
- Write migrations in SQL, following `0038_seed_namespaces.sql`.
- `agents/` targets Vercel. Do not rewrite it for Cloudflare Workers.
- Do not add dependencies (`pnpm-lock.yaml` unchanged).
- Follow Biome; use `import type`; keep `.server.ts` boundaries.

## Files to touch

### `wiki/`

- `migrations/00XX_seed_answers_namespace.sql` (new) — `ns-answers`, modelled on `0038`
- `shared/ingestion/domain.ts` — add `answer` to the `pageType` enum
- `app/db/schema.ts` — page-type comment only
- `app/routes.ts` — three entries **before** the `route("*", "routes/$.tsx")` catch-all
- `app/routes/api.agent.notes.ts` (new)
- `app/routes/api.agent.log.ts` (new)
- `app/routes/api.agent.instructions.ts` (new)
- `app/lib/agent-notes.server.ts` (new) — citation resolution, the §4 access-floor computation, the
  page insert/replace
- `app/lib/wiki-catalog.server.ts` (new) — `appendLogEntry`, `upsertIndexEntry`, entry formatting
  and input hardening
- `app/lib/agents-md.server.ts` — add `extractInstructionSections`
- `openapi/paths/agent.notes.yaml`, `agent.log.yaml`, `agent.instructions.yaml` (new);
  `openapi/components/schemas/agent.yaml`; `openapi/openapi.yaml`
- Tests (new): `app/routes/api.agent.notes.test.ts`, `api.agent.log.test.ts`,
  `app/lib/agent-notes.server.test.ts`, `app/lib/wiki-catalog.server.test.ts`;
  extend `app/routes/api.agent.architecture.test.ts` and `app/lib/agents-md.server.test.ts`

### `agents/`

- `lib/filing.ts` (new) — the pass, the gate, `generateObject` schema, idempotency
- `lib/wiki-write.ts` (new) — plain clients for notes / log / instructions (not AI SDK tools)
- `lib/agent.ts` — invoke the pass after posting, in both the `reply` handler and the `ASK_COMMAND`
  handler; export the extracted cited-path helper
- `lib/request-context.ts` (new) — `AsyncLocalStorage` carrying the verified `messageId`
- `lib/redis.ts` — add `filing:` to `REDIS_KEY_PREFIX` and a `filingKey(platform, messageId)`
- `app/api/chat/route.ts` — enter the request context with `result.messageId`;
  `export const maxDuration = 300`
- Tests (new): `lib/filing.test.ts`, `lib/architecture.test.ts`; extend `lib/agent.test.ts`

### `docs/`

- `docs/plans/05f-query-writeback.md` (new) — this document
- `docs/plans/03a-agents-md.md` — `answers/` placement row, the answer-page Lint item
- `docs/plans/00-llm-wiki-overview.md` — stage table row, and the operating-loop diagram gains the
  Query → Wiki arrow
- `docs/agents-setup.md` — note the `maxDuration` requirement; no new environment variables

## How to verify

### Completion criteria

Asked in Google Chat "Suggest venue candidates for the next event based on past results", the member
receives the answer at the same speed as before. Shortly afterwards, `log` has a
`## [YYYY-MM-DD] query | …` entry, and — because the answer synthesized several venue and event
pages — `answers/<slug>` exists with `visibility: restricted`, the correct `chapter_id`, links to
every page it drew on, and a catalog line under `## Answers` in `index`. Asking a single-fact
lookup produces a log entry and **no** page. A member who could not read one of the cited pages
cannot read the filed note. The reply is posted even when every write fails.

### Commands

```bash
pnpm --filter @gdgjp/wiki migrate:local
```

```bash
pnpm --filter @gdgjp/wiki openapi:generate
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm ci:quick
```

### Tests to establish as regressions

These are the paths that fail silently in production.

**Answer path is untouched**
- An architecture test over `agents/lib/tools/wiki.ts` asserting the exported tool set is exactly
  `wiki_ls`, `wiki_cat`, `wiki_search`, `wiki_add_source` — a write tool added there must break a
  test, not merely slow answers down.
- `SYSTEM_INSTRUCTIONS` contains none of the AGENTS.md slice; assert on a distinctive phrase from
  `## Sensitive information`.
- A successful inquiry issues the same number of Wiki read calls as before the change (assert on the
  fetch mock).

**The filing gate**
- `needs_link`, `needs_relink`, and `temporarily_unavailable` outcomes perform **no** write and make
  **no** `generateObject` call — assert on the mocks, not on absence of output.
- An answer citing fewer than two distinct paths never reaches the model.
- Cited paths are taken from tool results; a model-invented path in the answer text is not cited.
- A webhook retry with the same message id performs exactly one filing pass (Redis `setNX`).
- The verified `messageId` reaches the filing pass **from inside the `after()` continuation** — the
  async-context assumption above, pinned so a Next.js upgrade that breaks it fails loudly rather
  than silently degrading every filing to the 10-minute fallback key.
- A thrown error, a 500, and a 409 inside the pass each leave the already-posted reply untouched and
  surface nothing in Chat.

**Visibility (the invariant that leaks if it regresses)**
- Cited pages spanning two chapters → `409 citations_span_chapters`, **no page row created**.
- A cited page carrying explicit `page_access` rows → `409 citations_span_access`, no page created.
- A caller with two chapters and only chapter-wide citations → `409 chapter_ambiguous`.
- A `citedPaths` entry the caller cannot view → `400 invalid_citation`, and no page created. Assert
  it is not distinguishable from a nonexistent path.
- A body attempting `visibility: "public"`, `parentId`, `pageType`, or `chapterId` is ignored or
  rejected — the created row is always `restricted`, `answer`, parented to `ns-answers`.
- `replaceId` naming a page outside `ns-answers` returns **404, not 403**.

**Catalog and log**
- Two concurrent `POST /api/agent/log` calls both appear in `content_ja` — the SQL append does not
  lose an entry. (Contrast: a read-modify-write implementation drops one; that is the regression.)
- A `subject` containing `\n## [2020-01-01] ingest | forged` produces one entry with the newline
  stripped, not two entries.
- `upsertIndexEntry` creates the `## Answers` heading when absent, and replaces rather than
  duplicates a line for an existing slug.
- A `sync_revision` mismatch on the index write retries once and then gives up without throwing.

**Instructions slice**
- `extractInstructionSections` returns non-empty content for both headings against
  `INITIAL_AGENTS_MD`.
- A stored AGENTS.md missing `## Sensitive information` yields `503 instructions_unavailable`, and
  the filing pass then writes the log entry with the `Needs action` note and creates **no** page.

**Architecture**
- Extend `app/routes/api.agent.architecture.test.ts` to cover the three new route modules and
  `agent-notes.server.ts` with the existing
  `/VECTORIZE|knowledgeRetriever|embedding|createWikiModel|performRagSearch/i` guard.

### Manual E2E

1. `pnpm --filter @gdgjp/wiki migrate:local && pnpm --filter @gdgjp/wiki dev`.
2. Obtain a member access token via the CLI login flow; `curl` `POST /api/agent/log` and confirm the
   entry appears in `log` with the exact `## [YYYY-MM-DD] query | …` heading.
3. `curl` `POST /api/agent/notes` with two cited paths in one chapter → 201; confirm the page is
   `restricted`, parented to `ns-answers`, and listed under `## Answers` in `index`.
4. Repeat with one cited path in another chapter → 409 and no row created.
5. Repeat as a member excluded from one cited page → 400, and confirm no row and no log entry.
6. From Google Chat, ask a **synthesis** question. Time the reply and compare against `main` — it
   must not regress. Then confirm the log entry and the answer page appear afterwards.
7. Ask a **single-fact lookup**. Confirm a log entry appears and no page is created.
8. Ask the same synthesis question again and confirm the agent reaches the existing answer page
   through `index` → `wiki_ls /wiki/answers`, and that the pass supplies `replaceId` rather than
   creating a duplicate.
9. As a member of a different chapter, confirm the filed note is neither listed, matched by search,
   nor readable by `cat`.
10. Rename `## Sensitive information` in AGENTS.md through the admin push flow, ask a synthesis
    question, and confirm no page is filed and the log records `Needs action`. Restore it.
11. Repeat steps 6–7 on Discord, including in a DM, and confirm the DM question is filed the same
    way (this is the accepted disclosure noted in Context).
12. `gdg wiki clone --lang ja` and confirm the filed page appears under `pages/answers/<slug>/`.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
