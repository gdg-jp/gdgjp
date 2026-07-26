# gdgjp

Monorepo for the GDG Japan web properties. It uses a flat layout, pnpm workspaces, Turborepo, and
Biome. Its core web apps are React Router v7 SSR applications deployed to Cloudflare Workers, with
persistent state on Cloudflare D1; the repository also includes a Vercel gateway, a Chrome extension,
an OIDC client demo, and shared libraries.

## GDG CLI

Install the `gdg` CLI with the command for your operating system:

```sh
curl -fsSL https://gdgs.jp/cli/install.sh | sh
```

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://gdgs.jp/cli/install.ps1 | iex"
```

Then sign in with `gdg login`. Run `gdg update` to install the latest stable release.

## Apps

| Directory | Package | Hostname | Description |
|---|---|---|---|
| `accounts/` | `@gdgjp/accounts` | accounts.gdgs.jp | Auth IdP — built on `@cloudflare/workers-oauth-provider` over D1 + KV, issues OAuth credentials to the other apps. |
| `accounts-oidc-client-demo/` | `@gdgjp/accounts-oidc-client-demo` | Cloudflare Workers demo | Independent OpenID Connect relying-party example for GDG Accounts; uses encrypted cookies and no D1, KV, or service binding. |
| `cli/` | `github.com/gdg-jp/gdgjp/cli` | — | Go-based `gdg` command-line tool for authenticating with GDG Accounts, managing OAuth clients, and installing updates. |
| `gdg-lib/` | `@gdgjp/gdg-lib` | — | Shared RP factory (`initializeRpAuth`) + signed-cookie HMAC helpers, consumed via `workspace:*`. Source-only (no build step). |
| `go-extension/` | `@gdgjp/go-extension` | Chrome extension | Manifest V3 extension for GDG Japan Go Links. Redirects `go/<slug>` URLs, supports the `go` omnibox keyword, and recognizes exact searches. |
| `img/` | `@gdgjp/img` | img.gdgs.jp | Image hosting. D1 + R2 + Cloudflare Images; OAuth client of `accounts`. |
| `scheduler/` | `@gdgjp/scheduler` | scheduler.gdgs.jp | Meeting scheduler. Anonymous-friendly: anyone can create an event with a weekly schedule and meeting length, and pick available slots; authenticated owners get a cross-device "My events" list plus edit/delete. D1-backed; OAuth client of `accounts`. |
| `tinyurl/` | `@gdgjp/tinyurl` | url.gdgs.jp | URL shortener. D1-backed; OAuth client of `accounts`. |
| `tinyurl-gateway/` | `@gdgjp/tinyurl-gateway` | Custom short-link domains | Vercel Edge gateway for TinyURL custom domains. It serves an optional upstream first, then resolves a short link when the upstream returns 404. |
| `wiki/` | `@gdgjp/wiki` | wiki.gdgs.jp | Community wiki. D1 + R2 + Queues + Browser Rendering + Workers AI + Vectorize + Durable Object (Yjs collab); OAuth client of `accounts`. |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development and contribution guidance.
