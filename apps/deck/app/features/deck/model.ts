/**
 * The deck layout: everything the editor saves and the controller draws.
 *
 * A deck is one JSON document. Boards are the root screen and every folder;
 * each board has pages of `cols × rows` slots. Keys sit in slots by index
 * (row-major). Navigation (pages, folders) happens on the phone only; the
 * Durable Object only ever sees "key X was pressed" and resolves it here.
 *
 * `parseLayout` is the single gate for anything coming from a client: it
 * rebuilds the document field by field and drops whatever it does not know.
 */

import { type ObsAction, parseAction } from "~/features/obs/actions";

export const ROOT_BOARD = "root";
export const MAX_COLS = 12;
export const MAX_ROWS = 12;
export const MAX_BOARDS = 100;
export const MAX_PAGES = 50;
export const MAX_STEPS = 50;
export const MAX_WAIT_MS = 60_000;
export const MAX_TITLE = 40;
export const MAX_HOLD_MS = 5000;
/** Saved JSON larger than this is refused (D1 rows stay small). */
export const MAX_LAYOUT_BYTES = 512 * 1024;

export const KEY_COLORS = ["neutral", "blue", "red", "green", "yellow", "slate", "black"] as const;
export type KeyColor = (typeof KEY_COLORS)[number];

export type KeyLook = {
  /** design-system icon name (`Icons`), or null. */
  icon: string | null;
  /** Uploaded image id (deck-scoped), drawn instead of the icon. */
  image: string | null;
  color: KeyColor;
};

export type Confirm = { mode: "none" } | { mode: "hold"; ms: number } | { mode: "double" };

export type Step = { type: "obs"; action: ObsAction } | { type: "wait"; ms: number };

export type Behavior =
  | { type: "action"; action: ObsAction }
  | { type: "multi"; steps: Step[] }
  /** Runs `a`, then `b` on the next press, and so on (state kept by the room). */
  | { type: "multiSwitch"; a: Step[]; b: Step[] }
  | { type: "folder"; board: string }
  | { type: "back" }
  | { type: "page"; to: "next" | "prev" | number };

export type Key = {
  id: string;
  title: string;
  look: KeyLook;
  /** Look while the key's state is "on" (scene live, muted, recording…); null = highlight only. */
  lookOn: KeyLook | null;
  confirm: Confirm;
  behavior: Behavior;
};

export type Page = { id: string; keys: Record<string, Key> };

export type Board = { id: string; name: string; pages: Page[] };

export type DeckLayout = {
  cols: number;
  rows: number;
  boards: Record<string, Board>;
};

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function emptyPage(): Page {
  return { id: newId(), keys: {} };
}

export function emptyLayout(cols = 5, rows = 3): DeckLayout {
  return {
    cols: clampInt(cols, 1, MAX_COLS, 5),
    rows: clampInt(rows, 1, MAX_ROWS, 3),
    boards: { [ROOT_BOARD]: { id: ROOT_BOARD, name: "ホーム", pages: [emptyPage()] } },
  };
}

export const DEFAULT_LOOK: KeyLook = { icon: null, image: null, color: "neutral" };

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function cleanText(value: unknown, max = MAX_TITLE): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out.trim().slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLook(value: unknown): KeyLook | null {
  if (!isRecord(value)) return null;
  const icon =
    typeof value.icon === "string" && /^[A-Za-z0-9]{1,60}$/.test(value.icon) ? value.icon : null;
  const image = typeof value.image === "string" && ID_RE.test(value.image) ? value.image : null;
  const color = (KEY_COLORS as readonly string[]).includes(value.color as string)
    ? (value.color as KeyColor)
    : "neutral";
  return { icon, image, color };
}

function parseConfirm(value: unknown): Confirm {
  if (!isRecord(value)) return { mode: "none" };
  if (value.mode === "hold")
    return { mode: "hold", ms: clampInt(value.ms, 200, MAX_HOLD_MS, 1500) };
  if (value.mode === "double") return { mode: "double" };
  return { mode: "none" };
}

function parseSteps(value: unknown): Step[] {
  if (!Array.isArray(value)) return [];
  const steps: Step[] = [];
  for (const raw of value.slice(0, MAX_STEPS)) {
    if (!isRecord(raw)) continue;
    if (raw.type === "wait") {
      steps.push({ type: "wait", ms: clampInt(raw.ms, 0, MAX_WAIT_MS, 0) });
    } else if (raw.type === "obs") {
      const action = parseAction(raw.action);
      if (action) steps.push({ type: "obs", action });
    }
  }
  return steps;
}

function parseBehavior(value: unknown, boardIds: Set<string>): Behavior | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "action": {
      const action = parseAction(value.action);
      return action ? { type: "action", action } : null;
    }
    case "multi":
      return { type: "multi", steps: parseSteps(value.steps) };
    case "multiSwitch":
      return { type: "multiSwitch", a: parseSteps(value.a), b: parseSteps(value.b) };
    case "folder":
      return typeof value.board === "string" &&
        boardIds.has(value.board) &&
        value.board !== ROOT_BOARD
        ? { type: "folder", board: value.board }
        : null;
    case "back":
      return { type: "back" };
    case "page": {
      if (value.to === "next" || value.to === "prev") return { type: "page", to: value.to };
      return { type: "page", to: clampInt(value.to, 0, MAX_PAGES - 1, 0) };
    }
    default:
      return null;
  }
}

function parseKey(value: unknown, boardIds: Set<string>, seen: Set<string>): Key | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !ID_RE.test(value.id) || seen.has(value.id)) return null;
  const behavior = parseBehavior(value.behavior, boardIds);
  if (!behavior) return null;
  seen.add(value.id);
  return {
    id: value.id,
    title: cleanText(value.title),
    look: parseLook(value.look) ?? DEFAULT_LOOK,
    lookOn: parseLook(value.lookOn),
    confirm: parseConfirm(value.confirm),
    behavior,
  };
}

/** Validates and normalizes a client-supplied layout; null when it is unusable. */
export function parseLayout(value: unknown): DeckLayout | null {
  if (!isRecord(value) || !isRecord(value.boards)) return null;
  const cols = clampInt(value.cols, 1, MAX_COLS, 5);
  const rows = clampInt(value.rows, 1, MAX_ROWS, 3);
  const slots = cols * rows;
  const rawBoards = Object.entries(value.boards).slice(0, MAX_BOARDS);
  const boardIds = new Set(rawBoards.map(([id]) => id).filter((id) => ID_RE.test(id)));
  if (!boardIds.has(ROOT_BOARD)) return null;

  const seenKeys = new Set<string>();
  const boards: Record<string, Board> = {};
  for (const [id, raw] of rawBoards) {
    if (!boardIds.has(id) || !isRecord(raw)) continue;
    const pages: Page[] = [];
    const rawPages = Array.isArray(raw.pages) ? raw.pages.slice(0, MAX_PAGES) : [];
    for (const rawPage of rawPages) {
      if (!isRecord(rawPage)) continue;
      const keys: Record<string, Key> = {};
      if (isRecord(rawPage.keys)) {
        for (const [slot, rawKey] of Object.entries(rawPage.keys)) {
          const index = Number(slot);
          if (!Number.isInteger(index) || index < 0 || index >= slots) continue;
          const key = parseKey(rawKey, boardIds, seenKeys);
          if (key) keys[String(index)] = key;
        }
      }
      const pageId =
        typeof rawPage.id === "string" && ID_RE.test(rawPage.id) ? rawPage.id : newId();
      pages.push({ id: pageId, keys });
    }
    if (pages.length === 0) pages.push(emptyPage());
    boards[id] = {
      id,
      name: cleanText(raw.name) || (id === ROOT_BOARD ? "ホーム" : "フォルダ"),
      pages,
    };
  }
  return { cols, rows, boards };
}

/** Finds a key anywhere in the deck. */
export function findKey(layout: DeckLayout, keyId: string): Key | null {
  for (const board of Object.values(layout.boards)) {
    for (const page of board.pages) {
      for (const key of Object.values(page.keys)) {
        if (key.id === keyId) return key;
      }
    }
  }
  return null;
}

/** Every uploaded image id the layout still uses. */
export function imageIds(layout: DeckLayout): Set<string> {
  const ids = new Set<string>();
  for (const board of Object.values(layout.boards)) {
    for (const page of board.pages) {
      for (const key of Object.values(page.keys)) {
        if (key.look.image) ids.add(key.look.image);
        if (key.lookOn?.image) ids.add(key.lookOn.image);
      }
    }
  }
  return ids;
}
