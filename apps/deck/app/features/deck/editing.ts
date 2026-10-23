/**
 * Pure edits on a draft layout for the editor. Each returns a new layout.
 */

import { type ObsAction, isDangerous, parseAction } from "~/features/obs/actions";
import {
  type Behavior,
  type Board,
  DEFAULT_LOOK,
  type DeckLayout,
  type Key,
  MAX_BOARDS,
  MAX_COLS,
  MAX_PAGES,
  MAX_ROWS,
  ROOT_BOARD,
  clampInt,
  emptyPage,
  newId,
} from "./model";

export const HOLD_DEFAULT_MS = 1500;

export function newKey(behavior: Behavior): Key {
  return {
    id: newId(),
    title: "",
    look: { ...DEFAULT_LOOK },
    lookOn: null,
    confirm: confirmFor(behavior),
    behavior,
  };
}

/** Stream / record stop keys start as hold-to-confirm. */
export function confirmFor(behavior: Behavior): Key["confirm"] {
  if (behavior.type === "action" && isDangerous(behavior.action)) {
    return { mode: "hold", ms: HOLD_DEFAULT_MS };
  }
  return { mode: "none" };
}

/** Changing a key's action to a dangerous one turns hold-to-confirm on (once). */
export function withAction(key: Key, action: ObsAction): Key {
  const before = key.behavior.type === "action" ? key.behavior.action : null;
  const behavior: Behavior = { type: "action", action };
  const becameDangerous = isDangerous(action) && !(before && isDangerous(before));
  return {
    ...key,
    behavior,
    confirm: becameDangerous && key.confirm.mode === "none" ? confirmFor(behavior) : key.confirm,
  };
}

function updateBoard(layout: DeckLayout, boardId: string, fn: (b: Board) => Board): DeckLayout {
  const board = layout.boards[boardId];
  if (!board) return layout;
  return { ...layout, boards: { ...layout.boards, [boardId]: fn(board) } };
}

export function setKey(
  layout: DeckLayout,
  boardId: string,
  pageIndex: number,
  slot: number,
  key: Key | null,
): DeckLayout {
  return updateBoard(layout, boardId, (b) => ({
    ...b,
    pages: b.pages.map((p, i) => {
      if (i !== pageIndex) return p;
      const keys = { ...p.keys };
      if (key) keys[String(slot)] = key;
      else delete keys[String(slot)];
      return { ...p, keys };
    }),
  }));
}

/** Moves a key to another slot of the same page, swapping with whatever is there. */
export function moveKey(
  layout: DeckLayout,
  boardId: string,
  pageIndex: number,
  from: number,
  to: number,
): DeckLayout {
  if (from === to) return layout;
  return updateBoard(layout, boardId, (b) => ({
    ...b,
    pages: b.pages.map((p, i) => {
      if (i !== pageIndex) return p;
      const keys = { ...p.keys };
      const a = keys[String(from)];
      const c = keys[String(to)];
      if (a) keys[String(to)] = a;
      else delete keys[String(to)];
      if (c) keys[String(from)] = c;
      else delete keys[String(from)];
      return { ...p, keys };
    }),
  }));
}

export function addPage(layout: DeckLayout, boardId: string): DeckLayout {
  return updateBoard(layout, boardId, (b) =>
    b.pages.length >= MAX_PAGES ? b : { ...b, pages: [...b.pages, emptyPage()] },
  );
}

export function removePage(layout: DeckLayout, boardId: string, pageIndex: number): DeckLayout {
  return updateBoard(layout, boardId, (b) => {
    if (b.pages.length <= 1) return { ...b, pages: [emptyPage()] };
    return { ...b, pages: b.pages.filter((_, i) => i !== pageIndex) };
  });
}

export function movePage(
  layout: DeckLayout,
  boardId: string,
  from: number,
  to: number,
): DeckLayout {
  return updateBoard(layout, boardId, (b) => {
    if (to < 0 || to >= b.pages.length) return b;
    const pages = b.pages.slice();
    const [page] = pages.splice(from, 1);
    if (page) pages.splice(to, 0, page);
    return { ...b, pages };
  });
}

/** A new folder board, with a "back" key in its first slot. */
export function addFolder(
  layout: DeckLayout,
  name: string,
): { layout: DeckLayout; boardId: string } | null {
  if (Object.keys(layout.boards).length >= MAX_BOARDS) return null;
  const boardId = newId();
  const back = newKey({ type: "back" });
  back.title = "戻る";
  back.look = { ...back.look, icon: "ChevronLeft" };
  const page = emptyPage();
  page.keys["0"] = back;
  return {
    boardId,
    layout: {
      ...layout,
      boards: {
        ...layout.boards,
        [boardId]: { id: boardId, name: name || "フォルダ", pages: [page] },
      },
    },
  };
}

export function renameBoard(layout: DeckLayout, boardId: string, name: string): DeckLayout {
  return updateBoard(layout, boardId, (b) => ({ ...b, name: name.slice(0, 40) || b.name }));
}

/** Deletes a folder and every key that opened it. */
export function removeBoard(layout: DeckLayout, boardId: string): DeckLayout {
  if (boardId === ROOT_BOARD || !layout.boards[boardId]) return layout;
  const boards: Record<string, Board> = {};
  for (const [id, board] of Object.entries(layout.boards)) {
    if (id === boardId) continue;
    boards[id] = {
      ...board,
      pages: board.pages.map((p) => ({
        ...p,
        keys: Object.fromEntries(
          Object.entries(p.keys).filter(
            ([, k]) => !(k.behavior.type === "folder" && k.behavior.board === boardId),
          ),
        ),
      })),
    };
  }
  return { ...layout, boards };
}

/** Changes the grid size, keeping every key at its row/column; keys outside the new grid are dropped. */
export function resize(layout: DeckLayout, cols: number, rows: number): DeckLayout {
  const c = clampInt(cols, 1, MAX_COLS, layout.cols);
  const r = clampInt(rows, 1, MAX_ROWS, layout.rows);
  const boards: Record<string, Board> = {};
  for (const [id, board] of Object.entries(layout.boards)) {
    boards[id] = {
      ...board,
      pages: board.pages.map((p) => {
        const keys: Record<string, Key> = {};
        for (const [slot, key] of Object.entries(p.keys)) {
          const index = Number(slot);
          const row = Math.floor(index / layout.cols);
          const col = index % layout.cols;
          if (row < r && col < c) keys[String(row * c + col)] = key;
        }
        return { ...p, keys };
      }),
    };
  }
  return { cols: c, rows: r, boards };
}

/** Keys that resizing to cols × rows would drop. */
export function droppedByResize(layout: DeckLayout, cols: number, rows: number): number {
  let n = 0;
  for (const board of Object.values(layout.boards)) {
    for (const p of board.pages) {
      for (const slot of Object.keys(p.keys)) {
        const index = Number(slot);
        if (Math.floor(index / layout.cols) >= rows || index % layout.cols >= cols) n++;
      }
    }
  }
  return n;
}

/** Actions on the key the server would drop (missing scene name…). */
export function keyIsIncomplete(key: Key): boolean {
  const b = key.behavior;
  const bad = (a: ObsAction) => parseAction(a) === null;
  if (b.type === "action") return bad(b.action);
  if (b.type === "multi") return b.steps.some((s) => s.type === "obs" && bad(s.action));
  if (b.type === "multiSwitch") {
    return [...b.a, ...b.b].some((s) => s.type === "obs" && bad(s.action));
  }
  return false;
}

export function incompleteKeys(layout: DeckLayout): Key[] {
  const out: Key[] = [];
  for (const board of Object.values(layout.boards)) {
    for (const page of board.pages) {
      for (const key of Object.values(page.keys)) if (keyIsIncomplete(key)) out.push(key);
    }
  }
  return out;
}
