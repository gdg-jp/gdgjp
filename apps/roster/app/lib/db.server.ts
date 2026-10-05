/**
 * D1 handle accessor — the one cross-cutting, domain-free primitive this
 * stage adds to `app/lib/` (docs/roster/02-domain-schema.md "Design" §4:
 * "D1 ハンドルの取得だけ。横断プリミティブ。"; anticipated in
 * `tests/architecture/layering.test.ts`'s `LIB_ALLOWED_FILES` comment since
 * Stage 01). Every feature's `*.server.ts` takes a `D1Database` directly and
 * owns its own queries — this only centralizes pulling the binding off the
 * Worker env so call sites don't reach into `context.cloudflare.env.DB`.
 */
export function getDb(env: Env): D1Database {
  return env.DB;
}
