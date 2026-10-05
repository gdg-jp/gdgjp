# translation

Low-cost JA→EN page translation through Cloudflare Workers AI
(`@cf/meta/m2m100-1.2b`). Japanese page writes are coalesced in D1 and dispatched to
`TRANSLATION_QUEUE` once per day instead of translating on every save.

- `translation.server.ts` separates Markdown syntax from visible Japanese text locally, translates
  only the text segments, and reuses them by a model/version-aware SHA-256 key.
- `translation_jobs` is the durable one-row-per-page state machine. A lease makes Queue delivery
  idempotent, and a source snapshot guard prevents stale inference from overwriting a newer page.
- `translation_segments` is the durable exact-match translation memory.
- `AUTO_TRANSLATE=false` stops dispatch and consumption without discarding pending work.
- Spend-limit `429` responses remain pending until the next UTC allocation instead of consuming
  Queue retries.

Production setup: create the `gdgjp-wiki-translation` AI Gateway, configure a fixed daily spend
limit of USD 0.05 filtered to `@cf/meta/m2m100-1.2b`, leave `AUTO_TRANSLATE=false` through the
10-page canary review, then set it to `true` to start daily translation. The Gateway limit is
account configuration and is intentionally not a Worker secret or repository credential.

Enqueue and dispatch go through `app/lib/queue-processors.server.ts` (keep the message
discriminable there, or the Worker silently `ack()`s it).
