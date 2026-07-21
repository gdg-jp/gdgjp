# Cloudflare Worker RP pattern

## Required configuration

Declare the private workspace dependency:

```json
{
  "dependencies": {
    "@gdgjp/gdg-lib": "workspace:*"
  }
}
```

Use non-secret Wrangler vars:

```toml
[vars]
APP_URL = "https://app.example"
IDP_URL = "https://accounts.gdgs.jp"
IDP_CLIENT_ID = "issued-client-id"
```

Provide `RP_SESSION_SECRET` and `IDP_CLIENT_SECRET` through Wrangler secrets. Generate the session
secret with a cryptographically secure generator, such as `openssl rand -base64 48`. Put blank
placeholders only in `.dev.vars.example`.

For local HTTP development, use `localhost` or `127.0.0.1`. The current shared cookie helper does
not remove `Secure` for an IPv6 `[::1]` app URL even though the accounts registration validator
accepts that loopback host.

The app needs a D1 binding named `DB`. An optional `ACCOUNTS` service binding can keep discovery,
token, UserInfo, and logout requests on Cloudflare's internal network while retaining the public
issuer URL.

## Client ownership

Default third-party and individually owned apps to the self-service portal at
`https://accounts.gdgs.jp/developers/apps`. The signed-in owner must have an active chapter
membership. Save the create/rotate response secret immediately.

Use `accounts/wrangler.toml` client variables plus the accounts seed route only for an explicitly
platform-owned trusted RP. That path requires coordinated accounts deployment and secret
provisioning and is not ordinary self-service registration.

## Factory

Create one package-local server module:

```ts
import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-unique-app-name",
    secret: env.RP_SESSION_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      // Add only when Env declares an ACCOUNTS service binding:
      // fetch: (input, init) => env.ACCOUNTS.fetch(input, init),
    },
  });
  cached = { instance, env };
  return instance;
}
```

`RpAuthInstance` provides:

- `getSessionUser(request)` for optional session identity.
- `requireUser(request)` for a 401-enforcing session check.
- `handleAuthRequest(request)` for sign-in, callback, sign-out, and `me` endpoints.
- `handleSignOutRedirect(request, { returnTo? })` for RP-Initiated Logout.
- `getFreshClaims(request)` for UserInfo backed by server-side tokens and automatic refresh.

## Routes

Register `/api/auth/*` and delegate both HTTP data functions:

```ts
export const loader = (args: Route.LoaderArgs) =>
  getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);

export const action = (args: Route.ActionArgs) =>
  getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);
```

The factory dispatches these paths:

- `/api/auth/signin`
- `/api/auth/callback/gdgjp` (preferred) and `/api/auth/callback` (compatibility)
- `/api/auth/signout` and `/api/auth/sign-out`
- `/api/auth/me`

Expose an app-facing `/auth/signout` route with `handleSignOutRedirect`. Any `returnTo` option must
remain same-origin and must match a registered post-logout URI after resolution.

## D1 identity and token schema

Ensure the app-local user table has nullable `oidc_issuer` and `oidc_subject` columns plus a unique
index over the pair when both values are non-null. Preserve existing user IDs so domain foreign keys
remain stable.

Create `oidc_session` with:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL` referencing the local user with cascade delete
- `issuer TEXT NOT NULL`, `subject TEXT NOT NULL`
- `access_token TEXT NOT NULL`, nullable `refresh_token TEXT`, `id_token TEXT NOT NULL`
- `access_token_expires_at INTEGER NOT NULL`, `expires_at INTEGER NOT NULL`
- `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`
- an index on `user_id`

Use a new migration. Do not edit already-applied migrations or drop/recreate a referenced user table.

## Claims and authorization

`AuthUser` contains local `id`, `email`, `name`, `image`, and cached `isAdmin`. `UserClaims` adds
verified current identity plus `chapters` and the legacy primary `chapter` projection. Prefer
`chapters` for new authorization.

Call `getFreshClaims` for security-sensitive membership checks. Catch `ClaimsUnavailableError` and
force reauthentication or return a controlled unavailable response; do not silently reuse stale
membership on failure.

## Repository examples

- `tinyurl/app/lib/auth.server.ts`: factory plus `ACCOUNTS` service binding.
- `tinyurl/app/routes/api.auth.$.ts`: React Router catch-all delegation.
- `tinyurl/migrations/0021_add_oidc_subject.sql`: compact RP schema migration.
- `wiki/app/lib/auth.server.ts`: factory without the service binding.
- `wiki/app/lib/auth-utils.server.ts`: optional session, fresh claims, and compatibility helpers.
- `gdg-lib/src/auth/rp.test.ts`: protocol, storage, refresh, and failure-mode tests.
