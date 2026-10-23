import { describe, expect, it } from "vitest";
import { ROOT_BOARD, emptyLayout, findKey, imageIds, parseLayout } from "./model";

const key = (id: string, behavior: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  title: "t",
  look: { icon: "Radio", image: null, color: "red" },
  lookOn: null,
  confirm: { mode: "none" },
  behavior,
  ...extra,
});

describe("parseLayout", () => {
  it("round-trips a valid layout", () => {
    const layout = emptyLayout(3, 2);
    const root = layout.boards[ROOT_BOARD];
    if (!root?.pages[0]) throw new Error("no page");
    root.pages[0].keys["1"] = key("k1", {
      type: "action",
      action: { op: "stream", mode: "toggle" },
    }) as never;
    expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });

  it("refuses a layout without the root board", () => {
    expect(parseLayout({ cols: 2, rows: 2, boards: {} })).toBeNull();
    expect(parseLayout("nope")).toBeNull();
  });

  it("drops keys outside the grid, with bad actions, or duplicate ids", () => {
    const layout = parseLayout({
      cols: 2,
      rows: 1,
      boards: {
        root: {
          id: "root",
          name: "x",
          pages: [
            {
              id: "p1",
              keys: {
                "0": key("a", { type: "action", action: { op: "scene", scene: { name: "Main" } } }),
                "1": key("a", { type: "action", action: { op: "stream" } }),
                "5": key("c", { type: "action", action: { op: "stream" } }),
              },
            },
            {
              id: "p2",
              keys: { "0": key("d", { type: "action", action: { op: "nope" } }) },
            },
          ],
        },
      },
    });
    expect(layout?.boards.root?.pages[0]?.keys).toEqual({
      "0": expect.objectContaining({ id: "a" }),
    });
    expect(layout?.boards.root?.pages[1]?.keys).toEqual({});
  });

  it("only keeps folder keys that point at an existing folder", () => {
    const layout = parseLayout({
      cols: 2,
      rows: 1,
      boards: {
        root: {
          id: "root",
          name: "Home",
          pages: [
            {
              id: "p",
              keys: {
                "0": key("f1", { type: "folder", board: "fold" }),
                "1": key("f2", { type: "folder", board: "missing" }),
              },
            },
          ],
        },
        fold: { id: "fold", name: "Folder", pages: [] },
      },
    });
    expect(Object.keys(layout?.boards.root?.pages[0]?.keys ?? {})).toEqual(["0"]);
    // A board with no pages gets one empty page.
    expect(layout?.boards.fold?.pages).toHaveLength(1);
  });

  it("clamps grid size, hold time and strips control characters", () => {
    const layout = parseLayout({
      cols: 99,
      rows: 0,
      boards: {
        root: {
          id: "root",
          name: "Home",
          pages: [
            {
              id: "p",
              keys: {
                "0": key(
                  "k",
                  { type: "action", action: { op: "record", mode: "off" } },
                  {
                    title: "a\u0000b",
                    confirm: { mode: "hold", ms: 99_999 },
                    look: { icon: "<script>", image: "../x", color: "pink" },
                  },
                ),
              },
            },
          ],
        },
      },
    });
    expect(layout?.cols).toBe(12);
    expect(layout?.rows).toBe(1);
    const k = layout?.boards.root?.pages[0]?.keys["0"];
    expect(k?.title).toBe("ab");
    expect(k?.confirm).toEqual({ mode: "hold", ms: 5000 });
    expect(k?.look).toEqual({ icon: null, image: null, color: "neutral" });
  });
});

describe("findKey / imageIds", () => {
  it("finds keys in folders and lists images", () => {
    const layout = parseLayout({
      cols: 2,
      rows: 1,
      boards: {
        root: { id: "root", name: "Home", pages: [{ id: "p", keys: {} }] },
        f: {
          id: "f",
          name: "F",
          pages: [
            {
              id: "q",
              keys: {
                "1": key(
                  "deep",
                  { type: "back" },
                  {
                    look: { icon: null, image: "img1", color: "neutral" },
                    lookOn: { icon: null, image: "img2", color: "red" },
                  },
                ),
              },
            },
          ],
        },
      },
    });
    if (!layout) throw new Error("invalid");
    expect(findKey(layout, "deep")?.behavior).toEqual({ type: "back" });
    expect(findKey(layout, "nope")).toBeNull();
    expect([...imageIds(layout)].sort()).toEqual(["img1", "img2"]);
  });
});
