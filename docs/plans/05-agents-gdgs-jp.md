# Stage 5 — agent.gdgs.jp (Chat SDK) — overview

**This file is an overview and is not delegated.** The delegatable units are 5a–5e below; each one follows
the plan heading contract and is sized for a single `/cursor:delegate` run.

## Goal

Enable operations members to query the Wiki from the Google Chat / Discord environments they already use
every day. Ingest can run locally, but local Query is inconvenient — only this part belongs in the cloud.

The overall approach is in [00-llm-wiki-overview.md](00-llm-wiki-overview.md).
**Depends on Stage 3**: the `index` / `log` reserved slugs and the page-type ontology must be in place.

## Sub-plans

| # | Plan | Scope | Workspace |
|---|---|---|---|
| 5a | [05a-accounts-agents-client.md](05a-accounts-agents-client.md) | OAuth client `agents` on accounts.gdgs.jp | `accounts/` |
| 5b | [05b-wiki-agent-api.md](05b-wiki-agent-api.md) | `/api/agent/*` file-exploration read API + OpenAPI | `wiki/` |
| 5c | [05c-agents-workspace.md](05c-agents-workspace.md) | `agents/` workspace scaffold + webhook signature verification | `agents/`, root config, `gdg-lib/` |
| 5d | [05d-account-linking.md](05d-account-linking.md) | PKCE linking flow, Redis state, token encryption and rotation | `agents/` |
| 5e | [05e-agent-tools.md](05e-agent-tools.md) | ToolLoopAgent, Wiki tools, citations, `/unlink`, setup docs | `agents/`, `docs/` |

Dependencies: `5a → 5d`, `5b → 5e`, `5c → 5d → 5e`.
**5a, 5b, and 5c are independent of each other and can proceed in parallel.**

5d additionally requires 5a to be **deployed and reseeded** through `/admin/seed-clients`, not merely merged.

## Standing decisions

**Query is exploration, not RAG.** The agent navigates the Wiki the way a coding agent navigates a codebase —
read `/wiki/index`, list a namespace, read a page, follow a link. `llm-wiki.md` is explicit that the
index-first read path "avoids the need for embedding-based RAG infrastructure," and the reason is structural:
synthesis already happened at Ingest time, so a query walks the compiled artifact rather than re-deriving an
answer from embedded chunks on every question.

This is not a new mechanism. `wiki/workers/features/ingestion/tools/workspace/` already implements a bounded,
permission-aware virtual filesystem over the Wiki with `ls` / `cat` / `search`, backed by
`createD1WikiWorkspaceStore`, and `wiki/CLAUDE.md` records the rule the generation agent follows: *generation
never uses Vectorize*. Stage 5b puts an HTTP surface on that existing workspace; Stage 5e's tools mirror it
one for one. Vectorize and `app/features/ai-search/` stay where they are, serving the interactive `/search`
UI, and are not part of the agent path.

**Per-user tokens, not service authentication.** Most Wiki content is `restricted`, with granular control
through `page_access`, and it contains speaker contact details, budgets, and incident records. agent.gdgs.jp
links each Chat user to a GDG account and calls the Wiki API with that person's token. This structurally
prevents pages that should not be visible in Chat from appearing in an answer. Chapter-level or app-level
service authentication is prohibited across every sub-plan.

**Webhook verification is a precondition, not hardening.** The account link is only as trustworthy as the
webhook it arrives on. The Chat user ID is the lookup key for the link, so an unverified webhook lets anyone
POST a crafted payload carrying a linked member's Chat user ID and read every Wiki page that member can see.
Google Chat JWT verification (signature **and** audience) and Discord Ed25519 verification land in 5c, before
any linking code exists.

**Vercel + Redis.** Chat SDK's official state adapters are memory / Redis / ioredis / PostgreSQL; there is no
Cloudflare KV or Durable Object adapter. `agents/` therefore runs on Vercel with Redis, using
`tinyurl-gateway/` as the in-repo precedent. Moving agent.gdgs.jp to Cloudflare later would require writing
a custom adapter.

## Manual prerequisites

Confirm both before starting 5c. If either is unavailable, **stop and report** rather than working around it.

1. The Google Chat app is configured with an HTTP endpoint and its **project number is known** — that number
   is the required `aud` value. A Chat app configured without a fixed audience cannot be verified safely.
2. The Discord application is registered and its **public key** is available for Ed25519 verification.

A third prerequisite in earlier drafts — that the accounts IdP supports PKCE S256 and issues refresh tokens —
has since been **confirmed**: seeded clients are created with `requirePKCE = 1` and `public = 0`, the OAuth
provider accepts only `S256`, refresh tokens are issued (access 1 h, refresh 30 d), and a revocation endpoint
exists at `/api/auth/oauth2/revoke`. The details are recorded in 5a and 5d; do not re-investigate them.

## Manual operations (out of implementation scope)

- Google Cloud: enable the Chat API and configure the Chat app's HTTP endpoint.
- Discord: register the application and set its interactions endpoint URL.
- Vercel: create the agents project and set its environment variables. The repository's `VERCEL_PROJECT_ID`
  secret is already bound to the tinyurl-gateway project — the agents deploy step needs a distinct
  `VERCEL_PROJECT_ID_AGENTS` secret, or it will deploy into the wrong project.
- Cloudflare DNS: point `agent.gdgs.jp` at Vercel.
- accounts.gdgs.jp: `wrangler secret put AGENTS_CLIENT_SECRET`, deploy, then `POST /admin/seed-clients`.

The procedure is documented for operators in `docs/agents-setup.md`, written in 5e.

## Notes for whoever picks this up

Claims in earlier drafts of this plan that were wrong, recorded so they are not reintroduced:

- **The agent API is not RAG.** An earlier draft specified a Vectorize-backed `/api/agent/search` and asked
  for a retrieval half to be extracted from `app/features/ai-search/rag-search.server.ts`. Both are dropped —
  see the Query decision above. `rag-search.server.ts` is left untouched, and no agent-path module imports
  `createKnowledgeRetriever`, `env.VECTORIZE`, or `env.AI`.
- **Namespaced pages are a hierarchy, not a slug containing `/`.** Stage 3 creates `events/` `venues/`
  `vendors/` `people/` `orgs/` `playbooks/` as **top-level pages that parent their children**, and
  `pages.slug` holds a single segment. So `/wiki/venues/umeda-hall` resolves by walking `parentId`, which is
  what `WikiWorkspaceAdapter` already does. An earlier draft's "exact `pages.slug` match on
  `venues/umeda-hall`" would not have matched anything.
- **`createSource` already enforces the explicit-chapter rule.** `parseChapterSelection` returns
  `chapter_required` and `canAssignChapter` returns `forbidden_chapter`; `POST /api/agent/sources` reuses it
  rather than re-implementing the check.
- **`wiki/CLAUDE.md` is stale about the tool names.** It says the workspace exposes `ls/cd/pwd/cat/find/grep`;
  the real catalog is `ls` / `cat` / `search`, and `architecture.test.ts` asserts `pwd|cd|find|grep` are not
  tools.
