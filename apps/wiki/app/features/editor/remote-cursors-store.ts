// Module-level store that bridges the React hook (useCollabEditor) and the
// CM6 extension (remoteCursorsExtension). Both sides import this module and
// communicate through it without needing a shared React context.

export interface RemoteCursor {
  clientId: number;
  userName: string;
  color: string; // hex
  cursorPos: number;
  activeLang: "ja" | "en";
}

type Listener = () => void;

interface EditorStore {
  cursors: RemoteCursor[];
  listeners: Set<Listener>;
}

interface LocalCursorStore {
  pos: number;
  listeners: Set<(pos: number) => void>;
}

const stores = new Map<string, EditorStore>();
const localStores = new Map<string, LocalCursorStore>();

function getStore(editorId: string): EditorStore {
  let s = stores.get(editorId);
  if (!s) {
    s = { cursors: [], listeners: new Set() };
    stores.set(editorId, s);
  }
  return s;
}

function getLocalStore(editorId: string): LocalCursorStore {
  let s = localStores.get(editorId);
  if (!s) {
    s = { pos: 0, listeners: new Set() };
    localStores.set(editorId, s);
  }
  return s;
}

// --- Remote cursors (React → CM6) ---

export function setCursors(editorId: string, cursors: RemoteCursor[]): void {
  const s = getStore(editorId);
  s.cursors = cursors;
  for (const l of s.listeners) l();
}

export function getCursors(editorId: string): RemoteCursor[] {
  return getStore(editorId).cursors;
}

export function subscribe(editorId: string, listener: Listener): () => void {
  const s = getStore(editorId);
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

// --- Local cursor (CM6 → React) ---

export function setLocalCursor(editorId: string, pos: number): void {
  const s = getLocalStore(editorId);
  if (s.pos === pos) return;
  s.pos = pos;
  for (const l of s.listeners) l(pos);
}

export function subscribeLocalCursor(
  editorId: string,
  listener: (pos: number) => void,
): () => void {
  const s = getLocalStore(editorId);
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}
