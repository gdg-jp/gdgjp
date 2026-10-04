# TinyURL gateway architecture

`api/index.ts` is the Vercel Edge adapter: runtime/region metadata and the default handler.
Application code lives in `src/`, independent of the deployment entry point.

- `gateway.ts` orchestrates domain lookup, upstream precedence and GET/HEAD short-link resolution.
- `request.ts` normalizes native Requests and compatibility adapters, including public URLs,
  headers and bodies. It has no network or cache dependencies.
- `internal-api.ts` owns environment configuration, HMAC signing and the TinyURL internal API.
- `domain-config.ts` owns domain configuration lookup and its 30-second isolate cache.
- `upstream.ts` owns HTTPS/hostname restrictions, DNS public-address validation and its
  five-minute isolate cache. Validation must complete before an origin request is sent.
- `origin-proxy.ts` owns origin fetch timeouts, header/body forwarding, decoded response headers
  and public CDN cache policy. It does not choose routing or resolve short links.
- `runtime-cache.ts` owns the Vercel shared cache connection and failure logging. Domain and DNS
  modules own their separate key formats, TTLs and invalidation tags.

Dependencies flow from the gateway to these concrete modules; source modules never import
`api/`. Add behavior to its owner rather than expanding the deployment adapter or introducing
re-export facades. Tests import concrete modules, with only the runtime metadata assertion
reading the Vercel adapter. Cache reset functions belong to the modules owning each cache.

Run `pnpm --dir tinyurl-gateway test` and `pnpm --dir tinyurl-gateway typecheck` after changes.
