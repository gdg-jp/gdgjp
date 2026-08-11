# Stage 10 — Page ACL Spans and Server-Side Redaction

## Context — Background and Repository Status

### Why this is needed

`gdg wiki ingest` reads `raw/` and writes `pages/**`, but **the confidentiality level of a source is not propagated to derived content at all**.
A sentence derived from a confidential source can remain in plaintext in page content that everyone can read.

Neither LLM Wiki (`llm-wiki.md`) nor Google’s Open Knowledge Format defines an ACL model for this kind of “LLM-generated derived text,” so we define one here.

**Target state for this stage**: if part of a page body is wrapped like this:

```markdown
foobar
<acl src="7sLHj_rsleSlrEd1yH6CN">bazqux</acl>
fugahoge
```

that span is evaluated using the **current read permissions of the source**, and is replaced server-side with `⬛︎⬛︎⬛︎` for viewers who do not have permission.

The reason `src` contains the source’s `source_id` is so that **if the source permissions change later, every span derived from that source automatically follows the new permissions without re-ingestion**.

The Agent already writes `source_id` in front matter `sources`, so it does not need to learn any new vocabulary.

### Explicit design limitation (must also be documented in code comments)

Span-level ACLs **depend on the LLM self-reporting correctly, so they are not a security boundary**.

The effective security boundaries are the following two mechanisms, and this stage must not weaken either of them:

* (a) raw pull control via `canAccessSource` (Stage 9)
* (b) page-level `visibility` / `page_access` (existing page ACL)

`<acl>` is an additional defense layer inside those boundaries — a mechanism for “hiding only specific sentences inside a page that should otherwise remain broadly visible.”

### Dependencies and scope

* **The preceding stage, [09-source-visibility-acl.md](09-source-visibility-acl.md), is required.**
  This stage cannot be implemented until `sources.visibility` and the role-aware
  `canAccessSource(source, user, chapters)` are in place.
* Target workspaces: `wiki/` (primary), `cli/` (only one additional line in `INGEST_QUEUE.md`),
  and `docs/plans/` (update the `AGENTS.md` draft).
* **Ingest trace verification through CLI hooks — tracing Agent Read/Write operations and blocking commits with missing tags — is a separate stage. Do not implement it here.**
  This stage covers only “instructions in `AGENTS.md`” plus “server-side invariant checking in `/sync`.”
* Do **not** modify the permission model of the Agent (`workers/agents/`, `WikiGenerationAgent`, `/agents/*`).
  However, if `agent-workspace.server.ts` / `knowledge-retriever.server.ts` return page content before redaction, they become leakage paths, so **applying redaction there is included in this stage**.

### Required reading

* `wiki/CLAUDE.md` — the Worker’s three handlers, `COLLAB_DO`, Drizzle operations, golden tests, and fake E2E sessions
* `docs/plans/09-source-visibility-acl.md` — `SourceVisibility` vocabulary and `canAccessSource` evaluation order
* `docs/plans/03-local-ingest-toolchain.md` — overall clone / remote helper / sync architecture
* **`docs/plans/03a-agents-md.md` — full draft of `AGENTS.md`. This stage adds a section to it. Required reading.**

### Existing implementations to reuse (do not rewrite)

* `wiki/app/lib/sources.server.ts` → `canAccessSource(source, user, chapters)`
  — **span evaluation must call this function directly.**
  A core part of this design is that raw visibility and derived-span visibility are determined by the same single function. Do not create a separate evaluator.
* `wiki/app/lib/auth-utils.server.ts` → `getAccessIdentity` /
  `wiki/app/lib/cli-identity.server.ts` → `getCliIdentity`
  — `{ user, chapters, claimsAvailable }`
* `wiki/app/lib/page-access.server.ts` → `getEffectivePagePermissions`
  — determines whether the page itself is visible. **Do not change it.**
  Span ACLs are an independent second layer and must never weaken page ACLs.
* `wiki/app/lib/content-format.ts` → `canonicalMarkdown` — normalization boundary when saving
* `wiki/app/lib/cli-wiki-human.server.ts` → `renderWikiHumanDocument` — generates front matter for clone
* `wiki/app/routes/api.cli.wiki.sync.helpers.ts` — location for sync validation logic; already has tests
* `wiki/app/lib/agents-md.server.ts` — bootstraps from `docs/plans/03a-agents-md.md?raw`; after bootstrap, the `wiki_agent_instructions` DB row is authoritative
* `cli/internal/wiki/raw.go` → `BuildIngestQueue` — generates `INGEST_QUEUE.md`
  (`source_id` output format already exists; add one line in the same style)

---

## Design

### 0. Permission Algebra — Treat Visibilities as Sets, Not an Ordered Scale

**If the policy in this section is violated, the entire design breaks. Read this before implementation.**

Each visibility represents a set of viewers A(V) (Admins are always included):

| visibility            | A(V)                      |
| --------------------- | ------------------------- |
| `private`             | { registrant }            |
| `member`              | Members of any chapter    |
| `organizer`           | Organizers of any chapter |
| `chapter-member:C`    | Members of C              |
| `chapter-organizer:C` | Organizers of C           |

This forms a **partial order under ⊆, not a total order**.

`chapter-member:Tokyo` and `chapter-member:Osaka` are incomparable, and their intersection
(people who belong to both Tokyo and Osaka) **cannot be named using these five vocabulary values**.

Therefore:

* **Do not define a “confidentiality ordering.” Do not compare levels as greater/lesser.**
* **Do not compute a source upper bound for an entire page.**
  Doing so would hide non-confidential content from unauthorized users and break UX.
  Span-level evaluation avoids the problem entirely.
* Every required operation must reduce to **logical operations over predicates**.
  Do not materialize unnamed viewer sets.

There are three different meanings of “multiple roles,” and they must be handled differently:

| What is multiple                                                              | Operation                  | Where                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| **A viewer has multiple memberships** (e.g. Tokyo Organizer and Osaka Member) | **OR**                     | `chapters.some(...)` inside `canAccessSource`. Already implemented in Stage 9         |
| **A page contains spans derived from multiple sources**                       | **No aggregate operation** | Evaluate each span independently. Do not compute a page-level upper bound             |
| **Edit / push gate requires permission for all spans**                        | **AND**                    | conjunction in `pageAclClearance`. Works correctly even for incomparable combinations |

`accounts.memberships` has primary key `(user_id, chapter_id)`, so one user can in fact belong to multiple chapters with different roles.
Supporting the OR case is therefore a hard requirement.

### 1. Syntax

* **`src` is the primary form.** Its value is `sources.id`.
  At render time, the server looks up the current `sources.visibility`.
* **A single span may reference multiple sources** — `src="<id1> <id2>"`, space-separated.
  Authorization is the **logical AND of permission checks for every ID**
  (= intersection of viewer sets), so the most restrictive source automatically governs access.

  When a sentence is supported by two sources, do not make the LLM decide “which one is more restrictive”
  (as described in §0, levels must not be ordered against each other).
* `<acl level="organizer">` / `<acl level="chapter-organizer:<chapterId>">` are accepted as an
  **escape hatch for manually written content with no source**.
  The vocabulary is identical to Stage 9 `SourceVisibility`.
  Combining `src` and `level` is forbidden; exactly one of them is required.
* Two forms are allowed:

  * **Inline** — opens and closes on the same line.
  * **Block** — opening and closing tags each appear on separate lines.
* **`<acl>` is allowed only in page bodies (`content_ja` / `content_en`).**
  It must never appear in title / summary / tags / front matter (§4 rejects this).
* **Nesting is forbidden.**
  `<acl>` inside code fences (` ``` `) must not be interpreted as an ACL tag.

### 2. Pure Module `wiki/app/lib/acl-spans.ts`

Do not make this server-only, so it can be unit-tested easily.
Inject policy evaluation as a function.

```ts
export type AclSpan = {
  start: number; end: number;          // offsets in markdown
  srcIds: string[];                    // space-separated src values. Empty when level is used
  level: string | null;
  block: boolean;
  body: string;
};

export function parseAclSpans(markdown: string): AclSpan[];
export function aclSpanSourceIds(markdown: string): string[];   // deduplicated
export function stripAclSpans(markdown: string): string;         // remove tags only; retain body
export function removeAclSpans(markdown: string): string;        // remove spans including body
export function redactAclSpans(
  markdown: string,
  allow: (span: AclSpan) => boolean,
): { markdown: string; redactedCount: number };
export function validateAclSpans(markdown: string): { ok: true } | { ok: false; error: string };
```

* The redaction string is `⬛︎⬛︎⬛︎`.
  Inline spans are replaced in place; block spans collapse to one line containing `⬛︎⬛︎⬛︎`.
* **`redactAclSpans` must always remove the tags, regardless of whether access is allowed or denied.**
  `<acl` must never appear in its output.
  `md-editor-rt` (`MdPreview`) must never see a raw ACL tag.
* Unclosed tags, nesting, using both `src` and `level`, or using neither must cause
  `validateAclSpans` to return `acl_malformed`.
  `parseAclSpans` itself must not throw; it must behave deterministically even for malformed input.

### 3. Evaluation in `wiki/app/lib/acl-spans.server.ts`

```ts
export async function buildAclSpanPolicy(
  db, spanSourceIds: readonly string[],
  user: AuthUser | null, chapters: readonly { chapterId: string | number; role: string }[],
): Promise<(span: AclSpan) => boolean>;

export async function pageAclClearance(
  db, markdowns: readonly (string | null)[],
  user: AuthUser | null, chapters: readonly { chapterId: string | number; role: string }[],
): Promise<boolean>;   // true only if every span is allowed
```

* Fetch all source rows referenced by `src` **in one `inArray` query**
  (do not query once per span).
  After loading them, call `canAccessSource` directly.
* **Multiple sources use logical AND**:
  `span.srcIds.every(id => canAccessSource(sourceById.get(id), ...))`.
  Do not compare levels and select a supposedly “stricter” one (§0).
* **Missing / deleted `src` → Admin only** (fail closed).
* Unauthenticated users are always denied.
  `level=` uses the same vocabulary as Stage 9.
* When `claimsAvailable === false`, an empty `chapters` array is passed, so behavior naturally fails closed.

### 4. Validation and Invariants on Save Paths

#### 4-1. Denormalized Column

Add `acl_source_ids TEXT NOT NULL DEFAULT '[]'` to `pages`
(migration `wiki/migrations/0055_add_page_acl_source_ids.sql`).

Every path that writes page bodies must recompute and write:

`aclSpanSourceIds(content_ja) ∪ aclSpanSourceIds(content_en)`.

This avoids reparsing page bodies every time for listings, push gates, and audits.

**When a partial-locale sync updates only one locale, do not discard the result from the other locale.**

#### 4-2. Sync Validation

Add validation to:

`wiki/app/routes/api.cli.wiki.sync.ts`
and
`api.cli.wiki.sync.helpers.ts`.

| Error code                   | Condition                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `acl_malformed`              | mismatched closing tag / nesting / both `src` and `level` / neither specified |
| `acl_unknown_source`         | `src` does not exist, or the pushing user cannot read the referenced source   |
| `acl_in_metadata`            | title / summary / tags contains `<acl>`                                       |
| `acl_required`               | invariant below is violated                                                   |
| `redacted_page_not_editable` | overwrite attempt from a clone that received a redacted version (§5)          |

#### 4-3. Invariant

The only effective guarantee that the server can verify mechanically:

> If a page cites source S in front matter `sources[]`,
> either **A(page) ⊆ A(S)**, or the body must contain at least one
> `<acl src="…S…">` span.

**This is the only place in the design where an ordering-like relationship is needed.**
However, do not define a total order.
Implement this instead as a **decision table enumerating only inclusions that can actually be proven**
in `wiki/app/lib/acl-spans.server.ts` as:

`audienceContains(sourceVisibility, page): boolean`.

| Source S              | Pages for which A(page) ⊆ A(S) holds                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `private`             | none (a span is always required)                                                                           |
| `member`              | pages whose `visibility` is `member` / `organizer`, plus `restricted` pages with **chapter grants only**   |
| `organizer`           | pages whose `visibility` is `organizer` only                                                               |
| `chapter-member:C`    | `restricted` pages granted to **chapter C only** (if there is even one email grant, this does not qualify) |
| `chapter-organizer:C` | none (the page vocabulary cannot express “Organizers of C”; a span is always required)                     |

**Every combination not listed in the table must return `false` (= span required).**
Never treat an unprovable case as allowed.

`public` / `unlisted` include anonymous viewers, so they always return `false` for every source.

Incomparable chapter combinations such as Tokyo and Osaka match no cell in the table,
so they automatically return `false`, requiring spans.
**That is the correct behavior.**

There is no need to invent an unnamed set such as “Tokyo ∩ Osaka.”

This check considers only the page’s general viewer set and ignores the author’s implicit permissions.
In practice, an author cannot cite a source they cannot read, so this approximation fails safely.

This invariant exists to catch the case where the Agent **completely forgets to add tags**.
It **cannot detect partially missing tags** (see the limitation in §Context).

### 5. Paths Where Redaction Must Be Applied

**Missing any path becomes a direct data-leak bug. Cover every path.**

| Path                     | File                                                                                                            | Handling                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Page view                | `app/routes/wiki.$.tsx` → `displayContent`                                                                      | `redactAclSpans`                                                                        |
| History view             | `app/routes/wiki.$slug.history.tsx`                                                                             | `redactAclSpans` for each version body                                                  |
| Edit screen              | `app/routes/wiki.$slug.edit.tsx`                                                                                | **403** when `pageAclClearance` is false                                                |
| Collaborative editing WS | `/ws/collab/:slug` branch in `workers/app.ts` + `workers/collab-durable-object.ts`                              | same                                                                                    |
| OG image                 | `app/routes/og.wiki.$slug.tsx`                                                                                  | anonymous-facing; if page-body-derived content is rendered, use `removeAclSpans`        |
| Search / listings        | `app/routes/search.tsx`, `recent.tsx`, `api.recent.ts`                                                          | run `removeAclSpans` **before** generating snippets                                     |
| AI search                | `app/features/ai-search/knowledge-retriever.server.ts`                                                          | `redactAclSpans` on retrieved chunks                                                    |
| Embedding generation     | `app/features/ai-search/{embedding,chunker}.server.ts`, `app/routes/api.admin.backfill-embeddings.ts`           | embed **only content after `removeAclSpans`**; never put confidential text into vectors |
| Agent workspace          | `app/lib/agent-workspace.server.ts`, `app/lib/agent-notes.server.ts`, `app/routes/api.agent.{ls,cat,search}.ts` | `redactAclSpans`                                                                        |
| CLI clone                | `app/routes/api.cli.wiki.snapshot.ts`, `api.cli.wiki.sources.ts` (`wiki-human` path)                            | see below                                                                               |

**Editing paths return 403 so that redacted content cannot be saved back.**
If a redacted body overwrites the original, the original text is lost.
“Readable but not writable” is the correct behavior.

**`/ws/collab/:slug` does not pass through the React Router loader.**
`workers/app.ts` short-circuits it directly into `COLLAB_DO`.

If this path is missed, the page can leak unredacted content through WebSocket access.

#### 5-1. CLI Clone Behavior

* For callers without full span access, the snapshot returns `page.md` after
  `removeAclSpans` (removing both ACL tags and span bodies), and sets
  `acl_redacted: true` in front matter.
* For callers who can read every span, return the original tagged content unchanged
  so it can round-trip through push without losing ACL metadata.
* `/api/cli/wiki/sync` must reject upserts for pages where the pushing user does not have access to all spans,
  returning `redacted_page_not_editable`.

  The decision must be based on **the pushing user’s server-side permissions**.
  Do not trust the client-side flag.

### 6. Supplying Information and Instructions to the Agent

* Add `visibility` to manifest entries returned by `GET /api/cli/wiki/sources`.
  Update `wiki/openapi/paths/sources.yaml` and regenerate `openapi/types.generated.ts`.
* Add `Visibility` to the manifest type in `cli/internal/wiki/client.go`.
  In `cli/internal/wiki/raw.go` → `BuildIngestQueue`, output:

  ```go
  fmt.Fprintf(&b, "- visibility: `%s`\n", ...)
  ```

  **immediately after the `source_id` line**.

  As with `source_id`, omit the entire line for entries with no value (`wiki-human`).
* Add a new **“## Confidentiality and Span ACLs”** section inside the ````markdown block in
  `docs/plans/03a-agents-md.md`, and update `INITIAL_AGENTS_MD` read by
  `wiki/app/lib/agents-md.server.ts`.

  The section must say:

  * Any statement written from a source whose `visibility` in `INGEST_QUEUE.md`
    is anything other than `member` must be wrapped in
    `<acl src="<source_id>">…</acl>`.
  * If you cannot wrap it, or cannot determine whether it should be wrapped,
    **do not write that fact**. It remains available in `raw/`.
  * Do not put `<acl>` in title / summary / front matter.
    Do not nest ACL spans.
  * Do not edit a page with `acl_redacted: true` (the push will be rejected).
  * If the server returns `acl_required`, wrap the cited content with the appropriate tag
    or lower the page `visibility`, then resend.
* Update `docs/plans/00-llm-wiki-overview.md` to add the Stage 9 → 10 dependency.

### Constraints

* **Keep `canAccessSource` as the only source-permission evaluator.**
  Do not create a second evaluator for spans.
  Doing so would break the central property that changes to source permissions automatically propagate to spans.
* **Do not implement anything that violates §0.**
  Specifically:

  * do not assign numeric ranks to visibility values,
  * do not compare levels as greater/lesser,
  * do not impose an aggregate source upper bound on the entire page,
  * do not create a new level value representing the intersection of multiple levels.

  The only required concepts are the predicate “is this viewer allowed?” and logical AND / OR over those predicates.
* Do **not weaken or modify** the existing page ACL in
  `page-access.server.ts` / `page-visibility.server.ts`.
  Span ACLs are layered on top and must not participate in deciding whether the page itself is visible.
* Do **not relax** the check in `cli/internal/wiki/remote_helper.go`
  that rejects pushes for anything other than `pages/**` and `AGENTS.md`.
  This is a safety mechanism preventing raw data from being written back.
* `wiki/schema.sql` is generated output.
  Do not edit it manually; regenerate it with:

  `pnpm --filter @gdgjp/wiki migrate:local`
* For `AGENTS.md`, **the DB row (`wiki_agent_instructions`) is authoritative**.
  Updating `docs/plans/03a-agents-md.md` only changes the bootstrap seed.
  Existing environments must receive the update through an admin push.
  Handle this distinction exactly as described in Verification.
* **CLI-hook-based ingest trace verification is a separate stage. Do not build it here.**
* Do not modify the permission architecture of the Agent
  (`workers/agents/`, `WikiGenerationAgent`).
* Biome:
  2 spaces, double quotes, semicolons, 100-column limit.
  Use `import type`.

---

## Files to Touch

### `wiki/`

* `migrations/0055_add_page_acl_source_ids.sql` (new), `schema.sql` (regenerated), `app/db/schema.ts`
* `app/lib/acl-spans.ts` (new), `app/lib/acl-spans.server.ts` (new),
  `app/lib/acl-spans.test.ts` (new)
* `app/routes/wiki.$.tsx`, `app/routes/wiki.$slug.edit.tsx`, `app/routes/wiki.$slug.history.tsx`,
  `app/routes/og.wiki.$slug.tsx`
* `app/routes/search.tsx`, `app/routes/recent.tsx`, `app/routes/api.recent.ts`
* `app/routes/api.cli.wiki.snapshot.ts`, `app/routes/api.cli.wiki.sync.ts`,
  `app/routes/api.cli.wiki.sync.helpers.ts`, `app/routes/api.cli.wiki.sources.ts`
* `app/routes/api.agent.ls.ts`, `api.agent.cat.ts`, `api.agent.search.ts`,
  `app/lib/agent-workspace.server.ts`, `app/lib/agent-notes.server.ts`
* `app/features/ai-search/embedding.server.ts`, `chunker.server.ts`,
  `knowledge-retriever.server.ts`, `app/routes/api.admin.backfill-embeddings.ts`
* `workers/app.ts` (`/ws/collab/:slug` gate), `workers/collab-durable-object.ts`
* `app/lib/agents-md.server.ts`
* `openapi/paths/sources.yaml` + `openapi/types.generated.ts` (regenerated)

### `cli/`

* `internal/wiki/client.go` (`Visibility` on manifest type)
* `internal/wiki/raw.go` (`visibility` line in `BuildIngestQueue`)
* `internal/wiki/raw_test.go`

### `docs/`

* `docs/plans/03a-agents-md.md`
  (add the “Confidentiality and Span ACLs” section to the `AGENTS.md` body)
* `docs/plans/00-llm-wiki-overview.md`
  (update dependency graph)

---

## Verification — Completion Criteria and Validation

### Completion Criteria

1. On a page containing `<acl src>`, an authorized viewer sees the original text,
   while an unauthorized viewer sees `⬛︎⬛︎⬛︎`.
   Both viewers can still open the page itself.
2. Changing the source’s `visibility` changes the visibility of spans derived from that source
   **without re-ingestion**.
3. A clone made by an unauthorized user has the entire span body removed,
   includes `acl_redacted: true`,
   and a push from that state is rejected with `redacted_page_not_editable`.
4. A push of a page that cites a confidential source but has neither sufficient page `visibility`
   nor the required span is rejected with `acl_required`.
5. The literal tag text `<acl` never appears in any output path:
   page view, history, search, OG, embeddings, or Agent workspace.
6. `INGEST_QUEUE.md` includes a `visibility` line.

### Commands

```bash
pnpm --filter @gdgjp/wiki migrate:local
```

```bash
pnpm --filter @gdgjp/wiki typecheck && pnpm --filter @gdgjp/wiki test
```

```bash
pnpm --filter @gdgjp/wiki test:golden
```

```bash
cd cli && go test ./...
```

```bash
pnpm ci:quick
```

`migrate:local` regenerates `wiki/schema.sql`.
Include the resulting diff in the commit.

If any `openapi/*.yaml` file is modified, always regenerate
`openapi/types.generated.ts`.

Otherwise, a stale generated type can silently drop `visibility`
from the CLI manifest.

### Regression Tests That Must Be Locked Down Because These Paths Can Fail Silently

* **The output of `redactAclSpans` must never contain `<acl`**,
  both when access is allowed and when it is denied.
  If the allowed path simply passes the original text through, raw tags reach the renderer.
* **`/ws/collab/:slug` does not pass through the loader.**
  Add a test confirming that WebSocket connections are rejected for pages containing spans
  the caller cannot read.
  **This is the easiest path to miss silently in this stage.**
* **Confidential content must never enter embeddings.**
  Text passed to `embedding.server.ts` must not contain span bodies.
  Once confidential text reaches Vectorize, it may be recoverable through AI search.
* **Pushing from a ja-only clone must not erase `<acl>` spans in `content_en`.**
  During partial-locale updates, do not recompute `acl_source_ids` from only the modified locale
  and accidentally clear the other locale’s source IDs.
* **A missing `src` must deny access to everyone except Admins.**
  Deleting a source must not cause the span to become visible.
* **Coexistence of incomparable chapters.**
  Put spans derived from Tokyo and Osaka sources on one page, and verify:

  1. a Tokyo-only user can read only the Tokyo span;
  2. only a user who belongs to both can edit;
  3. `audienceContains` returns `false` for both, requiring spans.

  **Introducing greater/lesser comparison between levels would make all of these tests pass incorrectly.**
* **A multi-source span `src="a b"` uses logical AND.**
  A user who can read only one source must see redaction.
* **The default return value of `audienceContains` is `false`.**
  Unlisted combinations must never fail open.
  `public` / `unlisted` pages always return `false` for every source.
* **A user belonging to multiple chapters with different roles must be handled using OR inside `canAccessSource`.**
  Example: a Tokyo Organizer who is also an Osaka Member can read spans for both chapters.
* **Do not interpret `<acl>` inside code fences.**
  Otherwise, pages documenting how to use `gdg wiki` itself can break.
* **`acl_source_ids` must be updated on every save path**:
  sync, editor save, and collaborative editing.
  Missing any one of these can silently allow the push gate to pass.
* **`redacted_page_not_editable` must be evaluated using the pushing user’s permissions.**
  Do not trust the client’s `acl_redacted` flag.
* `BuildIngestQueue` golden test:
  the `visibility` line appears immediately after the `source_id` line.

### Manual E2E

1. Run `pnpm --filter @gdgjp/wiki dev` on `:5177`.
   Use the three sessions from `tests/e2e/global-setup.ts`:
   `admin`, `author`, and `member`.
2. As `author`, register one Google Doc with **Organizer** access
   using the Stage 9 functionality.
3. As `author`, create a page sourced from that Doc,
   wrap part of the content in `<acl src="…">`,
   and save it.
   Set the page itself to `visibility: member`.
4. As `member`, open the page and verify that only the wrapped portion becomes `⬛︎⬛︎⬛︎`
   while the rest remains readable.
   View the page source and confirm that `<acl` does not appear in the output.
5. As `member`, verify that entering `/wiki/<slug>/edit` returns 403
   and that a WebSocket connection to `/ws/collab/<slug>` is rejected.
6. As `author`, change the source permission to **Member**.
   Reload as `member` and confirm that the redaction disappears
   **without re-ingestion**.
7. Using the `member` CLI token, run `gdg wiki clone`.
   Confirm that `page.md` does not contain the span body
   and that `acl_redacted: true` is present.
   Edit the body as-is and run `git push`;
   confirm that it is rejected with `redacted_page_not_editable`.
8. As `admin`, stage the updated `AGENTS.md` with `git add AGENTS.md` and push it
   to update the DB row.
   Then run:

   `gdg wiki raw pull && gdg wiki ingest`

   and confirm that `INGEST_QUEUE.md` includes a `visibility` line.
9. Run `gdg wiki ingest --agent claude` once against an `organizer` source
   and visually confirm that the generated page contains `<acl src>` spans.
   If it does not, confirm that the push is rejected with `acl_required`.
