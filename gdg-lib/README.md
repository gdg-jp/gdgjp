# @gdgjp/gdg-lib

Shared auth building blocks for GDG Japan apps. The package ships TypeScript
sources directly (no build step) and is consumed via `workspace:*`.

It provides the RP factory used by `tinyurl/`, `img/`, `scheduler/`, and
`wiki/` to delegate sign-in to the `accounts/` IdP, plus shared signed-cookie
helpers.

| Export                  | Purpose                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `initializeRpAuth`      | Build an RP auth instance (PKCE authorize, callback, session cookie, sign-out)|
| `AuthUser`, `UserClaims`| Shared user / claims types                                                    |
| `signPayload` / `verifyPayload` | HMAC-SHA256 signed-cookie primitives                                  |
| `serializeCookie` / `readCookie` / `parseCookies` / `clearedCookie` | Cookie I/O helpers          |
| `ClaimsUnavailableError`| Thrown by `getFreshClaims(request)` when the IdP can't be queried             |
| `SSO_PROVIDER_ID`       | Constant identifying the IdP provider (`"gdgjp"`)                             |

The IdP itself is built with Better Auth's OAuth Provider plugin in `accounts/`;
it only consumes shared user types from this library.

---

## Implementing a Relying Party (RP)

The accounts IdP exposes an OpenID Connect discovery document at
`${IDP_URL}/.well-known/openid-configuration`. The RP redirects users there
to sign in, validates the RS256 ID Token (including nonce), and calls UserInfo
with subject binding. The cookie contains only local session identity; access,
refresh, and ID tokens are stored server-side in the RP's D1 database.

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
the client in D1.

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
- `handleSignOutRedirect(request, opts?)` — OIDC RP-Initiated Logout
- `getFreshClaims(request)` — fetch live UserInfo; refreshes and persists rotated tokens in D1. Throws `ClaimsUnavailableError` if the IdP can't be reached.

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

### 5. Add migrations

Each RP keeps a local `user` table used to attribute domain rows. The stable
identity key is `(oidc_issuer, oidc_subject)`. A verified email can link one
pre-migration row once, but is not used as the continuing identity key.

```sql
CREATE TABLE "user" (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  image      TEXT,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX user_oidc_identity
  ON "user" (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL;

CREATE TABLE oidc_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  id_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);
```
