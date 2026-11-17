# MCP Worker architecture

Plain Worker, no framework. `src/index.ts` routes; everything else is under `src/features/`.

| Responsibility | Location |
| --- | --- |
| Routing (`/authorize`, `/callback`, `/mcp`, OAuth endpoints, cron purge) | `src/index.ts` |
| Bindings and secrets | `src/env.ts` |
| Authorization server (issuer, resource, CIMD/DCR, token lifetimes, upstream refresh) | `src/features/oauth/server.ts` |
| Consent and the GDG Accounts round trip | `src/features/oauth/authorize.ts` |
| GDG Accounts token / userinfo calls (trusted client `mcp`) | `src/features/oauth/accounts.ts` |
| Scopes, their labels and consent defaults | `src/features/oauth/scopes.ts` |
| HTML (consent, errors), escaping | `src/features/oauth/consent-page.ts` |
| Resource server around the stateless MCP handler, server instructions | `src/features/mcp/server.ts` |
| `GET /` | `src/features/mcp/landing.ts` |
| Wiki Bearer API client | `src/features/wiki/client.ts` |
| Wiki tools | `src/features/wiki/tools.ts` |
| End-to-end OAuth + tool flow test (in-memory KV, fake Accounts and wiki) | `tests/flow.test.ts` |

- One MCP server per request (`createMcpHandler`, MCP SDK v2, stateless). The server is built from
  the request's grant props, so a tool can only ever use that grant's Accounts token.
- Tool scope checks use the SDK's `scopeChallenge`; the resource server passes `ctx.auth` through
  as `authInfo`, so a missing scope becomes an HTTP 403 step-up challenge before the tool runs.
- A new service adds `src/features/<service>/{client,tools}.ts`, its scopes in `scopes.ts`, and a
  `register<Service>Tools` call in `createServer`. Call that app's existing Bearer API with the
  Accounts token; if it only accepts `gdg-cli` tokens (`getCliIdentity`), widen Accounts'
  `/api/cli/v1/identity` deliberately rather than adding a bypass here.
