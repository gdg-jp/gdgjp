# pages

Wiki page domain: content, tree, metadata, archive, and access control.

- `access.server.ts` — `getEffectivePagePermissions`; the authoritative ACL resolver (fan-in high).
- `visibility.server.ts` — `canUserSeePage(Async)` boolean gate built on `access.server`.
- `acl-spans.ts` / `acl-spans.server.ts` — inline ACL span parsing + `redactPageMarkdown` / `pageAclClearance`.
- `tree.ts` / `wiki-page-path(.server).ts` / `meta.ts` — tree build, slug↔path, `<meta>` builders.
- `archive.server.ts`, `content-backfill.server.ts`, `wiki-catalog.server.ts`, `d1-chunk.server.ts`.
- `duplicate.server.ts` / `move.server.ts` — page-tree operations shared by the page menu and reorder API.
- `page-menu-content.ts` / `use-page-display.ts` — displayed Markdown selection and browser-local reader preferences.
- `components/` — page UI (PageTree, PageEditor, ShareDialog, Comment*, TagChip, *Content).

Caveat: `content-backfill.server.ts` reaches into `~/features/editor/content-format` (legacy TipTap JSON).

## Page menu

The reader toolbar exposes copy link, copy Markdown, duplicate, move, archive,
small text and full width on desktop and mobile. Clipboard content comes from
the same redacted, language-selected Markdown as the reader. Small text and full
width default to off and are stored only in this browser, keyed by user ID (or
anonymous) and immutable page ID; they are not shared page settings.

`POST /wiki/*` accepts `duplicatePage` and `movePage` intents, with `lang` and,
for moves, `parentId` (empty string means root). Success redirects to the new
canonical URL. `GET /api/pages/move-targets?pageId=...` lists eligible published
destinations for the signed-in owner/admin, excluding the source subtree and
tool-maintained pages. Moves append to the destination and preserve sharing;
the existing `/api/pages/reorder` endpoint uses the same authorization and
mutation service while retaining its explicit sibling-position contract.

Duplication requires ownership/admin rights and full inline-ACL clearance for
every published page in the branch. Archived branches and their descendants
are omitted. Copies start at root as private human pages owned by the caller,
with fresh IDs, slugs and independently stored attachments. The copied tree
retains localized content, metadata, tags, sources and inline ACL markers, but
does not inherit grants, comments, history, favorites or ingestion runs. Objects
are uploaded before a single D1 transaction publishes the graph; failed writes
trigger cleanup of the new objects. The original objects are never changed.

The menu's trash action uses the existing recursive archive operation. Existing
archive screens restore individual pages; restoring the parent does not
automatically restore children.
