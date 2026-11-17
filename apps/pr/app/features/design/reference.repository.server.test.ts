import { describe, expect, it } from "vitest";
import { type DesignReference, pickReferences } from "./reference.repository.server";

describe("pickReferences", () => {
  const ref = (id: string, kind: DesignReference["kind"], madeOn: string): DesignReference => ({
    id,
    chapterId: 1,
    kind,
    event: "",
    madeOn,
    note: "",
    contentType: "image/jpeg",
    bytes: 1,
    r2Key: id,
    createdBy: "u",
    createdAt: 0,
  });
  const all = [
    ref("t-old", "thumbnail", "2026-07-01"),
    ref("t-new", "thumbnail", "2026-10-01"),
    ref("s-new", "session", "2026-10-01"),
    ref("s-old", "session", "2026-08-01"),
    ref("a", "ad", "2026-10-01"),
  ];
  it("prefers the matching kind, newest first, then the face", () => {
    expect(pickReferences(all, "session", 3).map((r) => r.id)).toEqual(["s-new", "s-old", "t-new"]);
  });
  it("for the kit shows the faces first and one of each other kind", () => {
    expect(pickReferences(all, "kit", 4).map((r) => r.id)).toEqual([
      "t-new",
      "t-old",
      "s-new",
      "a",
    ]);
  });
});
