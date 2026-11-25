# Custom-domain gateway

A visitor opens a short link on a chapter's custom apex domain. The Vercel gateway
(`apps/tinyurl-gateway`) terminates TLS for that domain, asks TinyURL's signed internal API for
the domain's configuration, and for a `short-only` domain resolves the slug through the same
redirect handler as the apex, returning its 302.

## Sub-features

- `tinyurl-gateway` signed config lookup and resolution: an existing slug on an active custom
  domain answers 302 to its destination.
- `tinyurl-gateway` unknown slug on that domain answers 404 `Not Found`.
- `tinyurl-gateway` a hostname that is not an active TinyURL domain answers 421
  `Misdirected Request`.
- `tinyurl-gateway` a non-GET/HEAD request on a `short-only` domain answers 405.
- `tinyurl-gateway` a gateway with the wrong shared secret answers 502
  `Gateway configuration unavailable`.
- `tinyurl-gateway` the internal API refuses unsigned requests with 401.

## How to get to it (user POV)

A member creates a link on a custom domain (**Short link domain** `verify-gw.example/`) and shares
`https://verify-gw.example/<slug>`. Visitors reach it through Vercel; nobody uses the internal API
directly.

## Driving it with Orca Browser

The gateway is a Vercel Edge function. Locally its handler runs in Node with `tsx` and calls the
TinyURL Worker at `http://localhost:6169` over HTTP, with no Vercel credentials or network: the
Vercel runtime cache falls back to memory (it logs
`Runtime Cache unavailable in this environment. Falling back to in-memory cache.`). The probe
[`../fixtures/gateway-probe.mts`](../fixtures/gateway-probe.mts) imports
`apps/tinyurl-gateway/src/gateway.ts` relative to its own location, sends one request for
`https://<hostname><path>` with a browser user agent, and prints `{status, location, body}`.
This journey uses HTTP and the probe only; Orca is used to create the link.

Preconditions: the helper's `.dev.vars` contains
`GATEWAY_SHARED_SECRET=verify-tinyurl-gateway-secret`; seed applied (`verify-gw.example`,
custom, `short-only`, active, chapter 101); [sharing.md](sharing.md) created `verify-gw-link` on
`verify-gw.example/` with destination `https://1.1.1.1/verify-gw-link` (or create it now as
`owner` the same way). Run from the root of the tree whose source is under test, after
`export TINYURL_INTERNAL_BASE=http://localhost:6169 GATEWAY_SHARED_SECRET=verify-tinyurl-gateway-secret`.
`probe` below stands for
`apps/tinyurl-gateway/node_modules/.bin/tsx .agents/skills/verify-tinyurl/fixtures/gateway-probe.mts`.

- **Unsigned request.** `curl -s -w '\n%{http_code}\n'
  'http://localhost:6169/api/internal/gateway/config?hostname=verify-gw.example'` prints
  `Unauthorized` and `401`. This step needs no secret.
- **Resolve.** `probe verify-gw.example /verify-gw-link` prints
  `"status":302` and `"location":"https://1.1.1.1/verify-gw-link"`.
- **Unknown slug.** `probe verify-gw.example /verify-gw-missing` prints `"status":404`
  and `"body":"Not Found"`.
- **Unknown host.** `probe unknown-gw.example /verify-gw-link` prints `"status":421` and
  `"body":"Misdirected Request"`.
- **Method.** `probe verify-gw.example /verify-gw-link POST` prints `"status":405`.
- **Wrong secret.** `GATEWAY_SHARED_SECRET=wrong probe verify-gw.example
  /verify-gw-link` prints `"status":502` and
  `"body":"Gateway configuration unavailable"`.
- **Cross-domain isolation.** `probe verify-gw.example /verify-first-renamed` prints
  `"status":404`: a slug that exists only on `localhost:6169` does not resolve on the custom
  domain.
- **Read-back.** D1: `SELECT l.slug, d.hostname, d.kind, d.mode, d.status FROM links l JOIN
  domains d ON d.id = l.domain_id WHERE l.slug = 'verify-gw-link'` returns `verify-gw-link`,
  `verify-gw.example`, `custom`, `short-only`, `active`.

Evidence: the probe JSON lines with their commands (secret values redacted), the 401 line, and the
D1 row.

## Gotchas

The probe runs each request in a new process, so the gateway's 30-second domain-config cache
never carries over between steps; inside one process a changed domain status would be cached.
`origin-first` domains first validate the upstream origin through DNS-over-HTTPS and proxy to it;
that path is outside the map.
The gateway signs the method, path with query, hostname, and a timestamp; a clock skew above five
minutes between the probe and the Worker yields 401 and a 502 from the probe.
The internal API accepts only GET and HEAD and only for domains whose status is `active`.
Without `GATEWAY_SHARED_SECRET` in the Worker's `.dev.vars`, every signed step answers 502
(config 401); record the journey as blocked by that precondition, not as passed or failed.
