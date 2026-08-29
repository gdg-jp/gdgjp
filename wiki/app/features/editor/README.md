# editor

Realtime collaborative Markdown editor. TipTap on the client, Yjs CRDT over WebSocket to
`COLLAB_DO` (`workers/collab-durable-object.ts`).

- `use-collab-editor.ts` — the React hook: Yjs doc, provider, awareness.
- `remote-cursors-extension.ts` / `remote-cursors-store.ts` — remote-cursor decorations + hook↔extension bridge.
- `tiptap-convert.ts` — legacy TipTap-JSON → Markdown boundary converter only (storage is canonical Markdown).
- `content-format.ts` — `canonicalMarkdown`, image-key extraction. `components/` — `TipTapEditor`, `TipTapRenderer`, `PresenceAvatars`.

Caveat: golden suite (`tests/golden/tiptap-*`) snapshots conversion/rendering — run `test:golden:update` on schema changes.
