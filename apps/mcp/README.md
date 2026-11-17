# @gdgjp/mcp

`mcp.gdgs.jp` — the GDG Japan MCP server. MCP clients (Claude, Cursor, ChatGPT, …) connect to
`https://mcp.gdgs.jp/mcp` over Streamable HTTP, sign in with GDG Japan Accounts, and get tools that
act **as that person**: the same permissions as `gdg` CLI + Agent Skills, without installing
anything. **It never calls an LLM.**

```sh
pnpm --filter @gdgjp/mcp test
pnpm --filter @gdgjp/mcp typecheck
pnpm --filter @gdgjp/mcp dev          # http://localhost:5192 (run accounts :5173 and wiki :5177 too)
pnpm --filter @gdgjp/mcp run deploy
```

Connect a client:

```sh
claude mcp add --transport http gdg-japan https://mcp.gdgs.jp/mcp
```

## How sign-in works

```
MCP client ──401──▶ /.well-known/oauth-protected-resource/mcp ──▶ /.well-known/oauth-authorization-server
          ──register (CIMD or DCR)──▶ /authorize  (our consent page: client, redirect host, scopes)
          ──approve──▶ accounts.gdgs.jp (trusted client `mcp`, PKCE) ──▶ /callback
          ──code──▶ /oauth/token  (MCP token bound to https://mcp.gdgs.jp/mcp)
          ──Bearer──▶ /mcp  ──▶ wiki API with the person's Accounts token
```

- This Worker is the **authorization server for MCP clients** (`@cloudflare/workers-oauth-provider`):
  Client ID Metadata Documents and Dynamic Client Registration, PKCE S256, RFC 8707 resource-bound
  tokens, RFC 9728 metadata. Grants and tokens live in KV `OAUTH_KV`.
- **Consent comes first**, then Accounts. Accounts skips its own consent for the trusted `mcp`
  client, so this page is what stops one client from riding on another's approval.
- The Accounts tokens are stored only inside the grant's `props` (encrypted with a key wrapped by the
  token). The MCP client never sees them, and they are never passed through as the MCP token.
- Each MCP access token expires a minute before the Accounts access token it carries; refreshing the
  MCP token refreshes the Accounts token. When Accounts answers `invalid_grant` — the person signed
  out, their 14-day Accounts session ended (migration 0023 revokes its tokens), or an admin revoked
  it — the grant is revoked and the client signs in again.

## Scopes

| Scope | Tools |
|---|---|
| `wiki:read` (always granted) | `wiki_list_spaces`, `wiki_search`, `wiki_read_page`, `wiki_ls`, `wiki_cat`, `wiki_grep`, `wiki_list_sources`, `wiki_read_source`, `wiki_download_attachment`, `wiki_get_agents_md` |
| `wiki:write` (can be unticked on the consent page) | `wiki_add_source`, `wiki_add_inline_source`, `wiki_file_answer`, `wiki_append_log`, `wiki_update_agents_md` (admins) |

A token without `wiki:write` that calls a write tool gets a `403 insufficient_scope` step-up
challenge. What a person can actually see or change is still decided by the wiki (spaces, page
ACLs, redaction). Page bodies are not editable here: in knowledge platform v2 only the runner
writes pages (`/sync` answers people with `agent_pages_runner_only`), so knowledge changes by adding
sources.

## Setup

1. KV `gdgjp-mcp-oauth` (id in `wrangler.toml`) holds grants and tokens.
2. Accounts: `MCP_CLIENT_ID` / `MCP_REDIRECT_URLS` are in its `wrangler.toml`; set the secret
   `wrangler secret put MCP_CLIENT_SECRET` there, deploy Accounts and run `/admin/seed-clients`.
3. Here: `wrangler secret put IDP_CLIENT_SECRET` (the same value), then deploy.

Secrets and local overrides: `.dev.vars.example`.
