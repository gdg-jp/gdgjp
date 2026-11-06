# knowledge — search index (knowledge platform v2, Stage 03)

One Cloudflare AI Search instance per space (namespace `gdgjp-knowledge`, binding `KNOWLEDGE`,
instance id = `spaces.id`) with **built-in storage**: the Worker pushes items through the Items
API. (An R2 data source would need a dashboard-created service token; built-in storage does
not, and lets D1 stay the single source of truth.)

| File | Role |
|---|---|
| `shared.ts` | Layers (`raw` / `page` / `acl`), item keys (id-based), metadata fields |
| `mirror.ts` | Page → items: body with spans removed (`audience: page`), one item per span audience |
| `sync.server.ts` | Reconcile a space with D1 (`knowledge_items` tracks what was pushed); `knowledge_sync` queue message; hourly sweep |
| `instances.server.ts` | `ensureSpaceInstance` / `reconcileSpaceInstances` |
| `search.server.ts` | `searchSpaces` — the port; trusts its inputs |
| `viewer-search.server.ts` | `searchForReader` — the only caller: reader audiences (`readableAudienceKeys`), then page ACL / `canAccessSource` on every hit |

Redaction in search is structural: span text is never in an item with a wider audience, and
the `audience` filter is computed from the reader on the server. Spans whose sources have no
single narrowest audience are left out and flagged (`acl-ambiguous-span`).

Writes that change pages or documents schedule `knowledge_sync` (editor save, `/sync`, new page,
revert, archive, import completion, translation); the hourly cron schedules every space.
Thresholds are set to 0 explicitly — the defaults (0.4) drop most Japanese matches.
