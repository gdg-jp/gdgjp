# pages

Wiki page domain: content, tree, metadata, archive, and access control.

- `access.server.ts` — `getEffectivePagePermissions`; the authoritative ACL resolver (fan-in high).
- `visibility.server.ts` — `canUserSeePage(Async)` boolean gate built on `access.server`.
- `acl-spans.ts` / `acl-spans.server.ts` — inline ACL span parsing + `redactPageMarkdown` / `pageAclClearance`.
- `tree.ts` / `wiki-page-path(.server).ts` / `meta.ts` — tree build, slug↔path, `<meta>` builders.
- `archive.server.ts`, `content-backfill.server.ts`, `wiki-catalog.server.ts`, `d1-chunk.server.ts`.
- `components/` — page UI (PageTree, PageEditor, ShareDialog, Comment*, TagChip, *Content).

Caveat: `content-backfill.server.ts` reaches into `~/features/editor/content-format` (legacy TipTap JSON).
