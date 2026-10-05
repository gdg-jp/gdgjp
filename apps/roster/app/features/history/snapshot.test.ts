import { describe, expect, it } from "vitest";
import { assignmentKey } from "~/features/solver/types";
import {
  SNAPSHOT_VERSION,
  fromSnapshot,
  parseSnapshot,
  serializeSnapshot,
  toSnapshot,
} from "./snapshot";

describe("toSnapshot / fromSnapshot", () => {
  it("round-trips a full Assignments map, including locked and all id fields", () => {
    const original = new Map([
      [assignmentKey("app_1", "slot_0"), { trackId: "trk_a", roleId: "reception", locked: true }],
      [assignmentKey("app_2", "slot_0"), { trackId: "trk_a", roleId: "guide", locked: false }],
      [assignmentKey("app_1", "slot_1"), { trackId: "trk_b", roleId: "mc", locked: false }],
    ]);

    const snapshot = toSnapshot(original);
    expect(snapshot.v).toBe(SNAPSHOT_VERSION);
    const restored = fromSnapshot(snapshot);

    expect(restored).toEqual(original);
  });

  it("round-trips an empty Assignments map", () => {
    const original: ReturnType<typeof fromSnapshot> = new Map();
    expect(fromSnapshot(toSnapshot(original))).toEqual(original);
  });

  it("preserves locked=true through a JSON string round trip (serializeSnapshot/parseSnapshot)", () => {
    const original = new Map([
      [assignmentKey("app_1", "slot_0"), { trackId: "trk_a", roleId: "reception", locked: true }],
    ]);
    const json = serializeSnapshot(original);
    expect(parseSnapshot(json)).toEqual(original);
  });

  it("does not confuse trackId and roleId on round trip", () => {
    // A regression a naive positional-array encoding could introduce
    // silently; keying by { a, s, t, r, l } object fields instead of a
    // tuple is what prevents it.
    const original = new Map([
      [
        assignmentKey("app_1", "slot_0"),
        { trackId: "roleish_track", roleId: "trackish_role", locked: false },
      ],
    ]);
    const restored = fromSnapshot(toSnapshot(original));
    expect(restored.get(assignmentKey("app_1", "slot_0"))).toEqual({
      trackId: "roleish_track",
      roleId: "trackish_role",
      locked: false,
    });
  });

  it("serializes to the documented short-key JSON shape", () => {
    const original = new Map([
      [assignmentKey("app_1", "slot_3"), { trackId: "track_a", roleId: "mc", locked: false }],
    ]);
    expect(JSON.parse(serializeSnapshot(original))).toEqual({
      v: 1,
      items: [{ a: "app_1", s: "slot_3", t: "track_a", r: "mc", l: 0 }],
    });
  });
});

describe("fromSnapshot / parseSnapshot — version guard", () => {
  it("throws on an unrecognized v instead of silently misreading it", () => {
    expect(() => fromSnapshot({ v: 2, items: [] })).toThrow(/Unsupported snapshot version/);
  });

  it("throws when v is missing entirely", () => {
    expect(() => fromSnapshot({ items: [] })).toThrow(/Unsupported snapshot version/);
  });

  it("throws via parseSnapshot on a v:2 JSON string, without returning a corrupted map", () => {
    expect(() => parseSnapshot(JSON.stringify({ v: 2, items: [{ a: "x" }] }))).toThrow(
      /Unsupported snapshot version/,
    );
  });

  it("throws when items contains a malformed entry (missing a required field)", () => {
    expect(() =>
      fromSnapshot({ v: 1, items: [{ a: "app_1", s: "slot_0", t: "trk_a", r: "mc" }] }),
    ).toThrow(/Unsupported snapshot version/);
  });

  it("throws on non-object input", () => {
    expect(() => fromSnapshot(null)).toThrow(/Unsupported snapshot version/);
    expect(() => fromSnapshot("not an object")).toThrow(/Unsupported snapshot version/);
  });
});
