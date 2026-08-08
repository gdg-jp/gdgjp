# LLM Wiki Integration — Overall Strategy

**Status:** Plan finalized / Not started
**Related:** `llm-wiki.md` (the source pattern), `wiki/CLAUDE.md`

## Goal

Use AI agents to support GDG event operations, including venue selection, catering recommendations, speaker-office coordination, and promotion initiatives.
To enable this, accumulate operational knowledge scattered across Google Docs, Google Chat, and the web as a structured, cross-referenced Wiki.

Implement the `llm-wiki.md` pattern in `wiki/` and `cli/`: maintain a structured Wiki that LLMs continuously revise separately from primary information (`raw`), and integrate each new source into the existing set of pages.

## Three-layer mapping

| LLM Wiki layer | Implementation |
|---|---|
| Raw (primary information) | D1 `sources` / `source_documents` + R2 `raw/`. Kept separate from Wiki pages. It is not shown in the sidebar page tree and is accessed from “Sources” above Settings. |
| Wiki | Existing `pages` table. Add pages with reserved `index` / `log` slugs. |
| Schema (instructions) | `AGENTS.md`. Versioned server-side and materialized at the clone root by `gdg wiki clone`. |

## Operating loop

```
   [Human]  Paste a URL into wiki.gdgs.jp /sources
     │
     ▼
   [Cloud]  Fetch and normalize
     Fetch Google Docs / Google Chat / web → convert to Markdown → finalize in R2 raw/
     Record in source_documents with a content_hash
     │
     ▼
   [Local]  Integrate (Ingest)
     Fetch raw/ and AGENTS.md with gdg wiki clone + gdg wiki raw pull
     gdg wiki ingest enumerates documents not yet ingested
     Claude Code / Codex updates pages/** and index/log according to AGENTS.md
     git push → reflect the Wiki through the snapshot/sync API
     │
     ▼
   [Cloud]  Query
     agents.gdgs.jp (Chat SDK / Vercel) calls the Wiki agent API
     and answers operations-team questions from Google Chat / Discord
```

Keep only the costly LLM work of “understanding and integration” within a local coding-agent subscription.
Keep “fetching,” which requires OAuth tokens, Browser Rendering, and R2, in the cloud, so Google credentials do not need to reside on a local machine or home server.

## Finalized design decisions

- Separate raw content from Wiki pages by adding a `sources` table. Move the existing `google-document/` content to raw. Retire the current approach of importing Google Docs directly as Wiki pages because it is a UX failure.
- Fetching happens in the cloud; integration happens locally.
- Queries are served by agents.gdgs.jp (Chat SDK, Vercel + Redis), called from Google Chat / Discord.
- Only Google Chat history is supported. Discord log ingestion is out of scope (Discord is used only as a Query-side adapter).
- agents.gdgs.jp links each Chat user with accounts.gdgs.jp and calls the Wiki API using that person’s token. This structurally prevents restricted pages from leaking into Chat.
- That link is only as trustworthy as the webhook it arrives on. Google Chat JWT verification (signature **and** audience) and Discord Ed25519 verification are a hard precondition of Stage 5, not a hardening pass — an unverified webhook makes the Chat user ID forgeable and defeats the permission model above.

### Wiki editing policy (outline of `AGENTS.md`)

The full text is in [03a-agents-md.md](03a-agents-md.md). Decisions follow.

| Topic | Decision |
|---|---|
| Page hierarchy | Type-specific namespaces (`events/` `venues/` `people/` `vendors/` `orgs/` `playbooks/`) |
| Human-authored pages | Distinguish using `pages.origin`. They remain ordinary pages in the Wiki app, but are treated as `raw/` rather than emitted under `pages/` in a clone. Agents may read but not rewrite them. |
| Handling manual edits | Pages with `origin: agent` may be overwritten, with a warning shown in the editor. |
| Contradictions | Do not resolve them unilaterally; include both positions in an “Unconfirmed” block in the body and record them in `log`. |
| Sensitive information | Do not include contact details in page bodies; amounts are allowed (while remaining restricted); anonymize the names of incident parties. |
| Handwritten and synthesized pages | Keep both, adding source pages as citations in the synthesized page’s `sources`. |
| Language | Use a single language with `gdg wiki clone --lang ja`. Consolidate `ja.md`/`en.md` into `page.md`, and rely on the existing translation queue for English. |
| Ingest granularity | One source at a time, up to 15 pages. |

## Wiki ontology

Determine page types by working backward from the tasks to automate. This becomes the classification axis that `AGENTS.md` gives the agent during Ingest.

| Automation task | Required page types |
|---|---|
| Find an appropriate venue | `venue` (capacity, cost, equipment, access, usage history, caveats) |
| Recommend catering | `vendor` + `event` history (attendee count, budget, menu, leftovers) |
| Speaker-office coordination | `person` (speaking history, contact channel, responsiveness) + `playbook` (message templates and timeline) |
| Marketing strategy / connpass / X Ads | `playbook` (initiatives and attendance outcomes) + `event` attendance metrics |

Extend the `pageType` enum in `wiki/shared/ingestion/domain.ts`.

- Existing: `event-report` / `speaker-profile` / `project-log` / `how-to-guide` / `onboarding-guide` / `survey-report`
- Add: `event` / `venue` / `vendor` / `person` / `organization` / `playbook` / `wiki-index` / `wiki-log`

## Stages

| # | Plan | Contents |
|---|---|---|
| 1 | [01-sources-raw-layer.md](01-sources-raw-layer.md) | Create the raw layer (`sources` table, `/sources` UI, fetch worker) — **implemented in `b54b338`, with outstanding items** |
| 2 | [02-google-chat-import.md](02-google-chat-import.md) | Google Chat ingestion (expanded OAuth scopes, conversation-log normalization) |
| 3 | [03-local-ingest-toolchain.md](03-local-ingest-toolchain.md) | Local Ingest toolchain (single-language clone, `origin`, `gdg wiki raw pull` / `ingest` / `lint`) |
| 3a | [03a-agents-md.md](03a-agents-md.md) | Full `AGENTS.md` draft (appendix to Stage 3) |
| 4 | [04-reingest-existing-google-docs.md](04-reingest-existing-google-docs.md) | Move 107 existing `google-document/` pages to raw and resynthesize them |
| 5 | [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md) | agents.gdgs.jp (Chat SDK / Vercel, Google Chat + Discord) |

Dependencies: 1 → 2, 1 → 3 → 4, 3 → 5. Stages 2 and 3 can proceed in parallel.

## Risks and considerations

- The Google Chat API supports calling `spaces.messages.list` with user authentication (confirmed), but the Google Cloud project must enable the Chat API and configure a Chat app. Make this connectivity check the first Stage 2 task; if it fails, fall back to manual-export ingestion.
- Existing users’ `google_drive_tokens` require renewed consent when scopes are added. Record granted scopes and request reauthorization only when scopes are missing.
- The constraint that `git push` rejects anything outside `pages/**` (`cli/internal/wiki/remote_helper.go`) is a core Stage 3 design assumption. Document in `AGENTS.md` that refactoring to remove `raw/` from `.gitignore` is forbidden.
- Stage 3 includes a breaking clone-format change (`ja.md`/`en.md` → `page.md`, single language). Existing clones (such as `~/proj/wiki`) must be recloned. At the same time, change the sync API to update locales partially; otherwise, pushing from a Japanese-only clone deletes every English page. Lock this down with regression tests.
- Stage 1 shipped in `b54b338` but does not yet satisfy its own plan on three points, each marked as a divergence note in [01-sources-raw-layer.md](01-sources-raw-layer.md): the `/sources` form is Google Picker-only, so the `website` fetcher is unreachable from the product; fetch completion has no attempt lease, so overlapping queue deliveries can silently archive documents a newer fetch just discovered; and refresh enqueue failures leave rows stuck as `pending`. Stages 2 and 3 build directly on this fetch lifecycle, so close them before starting either.
- LLM-generated Wiki pages may include speaker contact details or budgets. Stage 4 must always include human review.
- Chat SDK has no official state adapter for Cloudflare KV/DO. Vercel + Redis was selected with the understanding that moving agents.gdgs.jp to Cloudflare would require a custom adapter.
