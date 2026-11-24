# Sign-in gate and runner API

Every pr screen requires a signed-in user with a chapter. The runner API accepts only the
runner token.

## Sub-features

- `pr-signin-gate`: anonymous `/` and `/c/<slug>` redirect to `/signin?return_to=...`,
  which continues to `/api/auth/signin`; the dev login lands on 通知.
- `pr-runner-token`: `/api/runner/jobs/next` with a wrong bearer token returns 401.
- `pr-accounts-signin`: with `--platform`, anonymous `/events` reaches Accounts `/signin` with
  `client_id=pr` and the stack's callback; with the verify-platform Accounts session cookie the
  same navigation completes OIDC and `/api/auth/me` returns `platform-oidc@test.local`.

## How to get to it (user POV)

Open `http://localhost:6161/` in a fresh profile. Sign in with a dev login URL from the
README.

## Driving it with Orca Browser

Preconditions: a fresh isolated profile with no cookies.

- Gate. Navigate to `/`. Record the final URL. With no `--platform`, `/api/auth/signin`
  answers 500 (`Unexpected Server Error`) because no Accounts is reachable; that is the
  IdP boundary, not part of this journey. Record the chain with
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'` for `/`, `/signin?return_to=%2F`,
  and `/c/none`: require 302 to `/signin?return_to=...` and then 302 to `/api/auth/signin`.
- Dev login. Navigate to the `lead` dev login with `return_to=/events`. Require the
  heading **イベント** and the sidebar links **通知**, **イベント**, **告知先**, **設定**.
- Runner token. `curl -H 'authorization: Bearer nope' http://localhost:6161/api/runner/jobs/next?types=copy`
  returns 401.

## Gotchas

The real OIDC hop needs `--platform` and is covered by verify-platform, not here. A curl
dev login creates a `user` row; use labels that do not collide with journey identities.
