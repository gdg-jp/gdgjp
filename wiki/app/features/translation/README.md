# translation

JA→EN auto-translation of page content, run as a `TRANSLATION_QUEUE` consumer job.

- `translation.server.ts` — translate entry; prompt + schema for the model call.

Enqueue and dispatch go through `app/lib/queue-processors.server.ts` (keep the message
discriminable there, or the Worker silently `ack()`s it).
