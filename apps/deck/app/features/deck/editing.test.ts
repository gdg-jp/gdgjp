import { describe, expect, it } from "vitest";
import { defaultAction } from "~/features/obs/actions";
import {
  addFolder,
  droppedByResize,
  incompleteKeys,
  moveKey,
  newKey,
  removeBoard,
  resize,
  setKey,
  withAction,
} from "./editing";
import { ROOT_BOARD, emptyLayout } from "./model";

describe("editing", () => {
  it("defaults stream/record stop keys to hold-to-confirm", () => {
    expect(newKey({ type: "action", action: { op: "stream", mode: "toggle" } }).confirm).toEqual({
      mode: "hold",
      ms: 1500,
    });
    expect(newKey({ type: "action", action: { op: "stream", mode: "on" } }).confirm).toEqual({
      mode: "none",
    });
    const k = newKey({ type: "action", action: defaultAction("scene") });
    expect(withAction(k, { op: "record", mode: "off" }).confirm.mode).toBe("hold");
  });

  it("moves, resizes and removes folders", () => {
    let layout = emptyLayout(3, 2);
    const a = newKey({ type: "back" });
    layout = setKey(layout, ROOT_BOARD, 0, 5, a); // row 1, col 2
    layout = moveKey(layout, ROOT_BOARD, 0, 5, 0);
    expect(layout.boards.root?.pages[0]?.keys["0"]?.id).toBe(a.id);
    layout = moveKey(layout, ROOT_BOARD, 0, 0, 4); // row 1, col 1
    expect(droppedByResize(layout, 1, 2)).toBe(1);
    const grown = resize(layout, 4, 2);
    expect(grown.boards.root?.pages[0]?.keys["5"]?.id).toBe(a.id); // still row 1, col 1

    const folder = addFolder(layout, "Scenes");
    if (!folder) throw new Error("no folder");
    layout = setKey(
      folder.layout,
      ROOT_BOARD,
      0,
      1,
      newKey({ type: "folder", board: folder.boardId }),
    );
    layout = removeBoard(layout, folder.boardId);
    expect(layout.boards[folder.boardId]).toBeUndefined();
    expect(layout.boards.root?.pages[0]?.keys["1"]).toBeUndefined();
  });

  it("finds keys the server would drop", () => {
    const layout = setKey(
      emptyLayout(),
      ROOT_BOARD,
      0,
      0,
      newKey({ type: "action", action: defaultAction("scene") }),
    );
    expect(incompleteKeys(layout)).toHaveLength(1);
  });
});
