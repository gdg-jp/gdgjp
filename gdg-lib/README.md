# @gdgjp/gdg-lib

Shared auth building blocks for GDG Japan apps. The package ships TypeScript
sources directly (no build step) and is consumed via `workspace:*`.

It provides the RP factory used by `tinyurl/`, `img/`, `scheduler/`, and
`wiki/` to delegate sign-in to the `accounts/` IdP, plus the shared signed-
cookie helpers used by both the RPs and the IdP.

| Export                  | Purpose                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `initializeRpAuth`      | Build an RP auth instance (PKCE authorize, callback, session cookie, sign-out)|
| `AuthUser`, `UserClaims`| Shared user / claims types                                                    |
| `signPayload` / `verifyPayload` | HMAC-SHA256 signed-cookie primitives                                  |
| `serializeCookie` / `readCookie` / `parseCookies` / `clearedCookie` | Cookie I/O helpers          |
| `ClaimsUnavailableError`| Thrown by `getFreshClaims(request)` when the IdP can't be queried             |
| `SSO_PROVIDER_ID`       | Constant identifying the IdP provider (`"gdgjp"`)                             |

The IdP itself is built directly on `@cloudflare/workers-oauth-provider` in
`accounts/` — it doesn't go through this lib.

---

## Implementing a Relying Party (RP)

The accounts IdP exposes an OIDC-flavoured OAuth 2.1 discovery document at
`${IDP_URL}/.well-known/openid-configuration`. The RP redirects users there
to sign in, receives an access + refresh token, calls `/userinfo` to fetch
user attributes, and stores a signed session cookie scoped to the RP origin.

> Note: the IdP does **not** issue `id_token`s. The RP must pass
> `idTokenExpected: false` when calling `openid-client` directly; the
> factory in this package handles that internally.

### 1. Add the dependency

In your app's `package.json`:

```json
{
  "dependencies": {
    "@gdgjp/gdg-lib": "workspace:*"
  }
}
```

Then `pnpm install` from the repo root.

### 2. Configure Wrangler bindings + secrets

In your app's `wrangler.toml`, declare a D1 binding named `DB` and the env
vars the factory expects. The secrets (`RP_SESSION_SECRET` for the cookie
HMAC, `IDP_CLIENT_SECRET` for OAuth client auth against the IdP) should be
set with `wrangler secret put`, not committed.

```toml
[vars]
APP_URL = "https://your-app.gdgs.jp"
IDP_URL = "https://accounts.gdgs.jp"
IDP_CLIENT_ID = "your-app"

[[d1_databases]]
binding = "DB"
database_name = "gdgjp-your-app-db"
database_id = "..."
migrations_dir = "./migrations"
```

The IdP also needs to know about your client: ensure the RP's
`{APP}_CLIENT_ID`, `{APP}_CLIENT_SECRET`, and `{APP}_REDIRECT_URLS`
(pointing at `${APP_URL}/api/auth/callback/gdgjp`) are set on the
`accounts/` worker, and run `POST /admin/seed-clients` there to register
the client in `OAUTH_KV`.

### 3. Wire the factory

```ts
// app/lib/auth.server.ts
import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-your-app",
    secret: env.RP_SESSION_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
    },
  });
  cached = { instance, env };
  return instance;
}
```

`initializeRpAuth` returns an `RpAuthInstance` with:

- `getSessionUser(request)` / `requireUser(request)` — read the signed session cookie
- `handleAuthRequest(request)` — handler for `/api/auth/*` (signin, callback, signout, me)
- `handleSignOutRedirect(request, opts?)` — 302 to the IdP's federated sign-out
- `handleSignOutIframe(request)` — clear the RP session from an iframe (CSP-locked to the IdP origin)
- `getFreshClaims(request)` — fetch live `/userinfo` from the IdP; refreshes access token via the stored refresh token. Throws `ClaimsUnavailableError` if the IdP can't be reached.

### 4. Add the routes

The handler paths below match what `handleAuthRequest` dispatches on:

```ts
// app/routes/api.auth.$.ts — catch-all for the four /api/auth/* paths
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.auth.$";

export const loader = (args: Route.LoaderArgs) =>
  getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);
export const action = (args: Route.ActionArgs) =>
  getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);
```

```ts
// app/routes/auth.signout.ts
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.signout";

export const loader = ({ request, context }: Route.LoaderArgs) =>
  getAuth(context.cloudflare.env).handleSignOutRedirect(request);
```

```ts
// app/routes/auth.signout-iframe.ts — called from the IdP's federated sign-out page
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.signout-iframe";

export const loader = ({ request, context }: Route.LoaderArgs) =>
  getAuth(context.cloudflare.env).handleSignOutIframe(request);
```

### 5. Add migrations

Each RP keeps a tiny local `user` table (id, email, name, image, is_admin,
created_at, updated_at) used to attribute domain rows like links/images.
The factory's upsert looks up the user by email, mints a UUID for new
sign-ups, and updates name/image/is_admin on every callback.

```sql
CREATE TABLE "user" (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  image      TEXT,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

That's the only auth-related table you need — sessions are signed cookies
and OAuth state lives entirely on the IdP.
