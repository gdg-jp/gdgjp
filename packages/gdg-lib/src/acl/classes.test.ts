import { describe, expect, it } from "vitest";
import { canAccessSource, canClassesAccessSource } from "./access";
import type { PermissionClass } from "./types";

const classes: readonly (readonly PermissionClass[])[] = [
  [],
  [{ chapterId: "tokyo", role: "member" }],
  [{ chapterId: "tokyo", role: "organizer" }],
  [{ chapterId: "osaka", role: "member" }],
  [
    { chapterId: "tokyo", role: "member" },
    { chapterId: "osaka", role: "organizer" },
  ],
];

describe("class/source evaluator equivalence", () => {
  it("matches canAccessSource when admin and ownership shortcuts are absent", () => {
    for (const visibility of [
      "private",
      "member",
      "organizer",
      "chapter-member",
      "chapter-organizer",
      "future",
    ]) {
      for (const permissionClasses of classes) {
        const chapterId = visibility.startsWith("chapter-") ? "tokyo" : null;
        const source = { visibility, chapterId };
        const chapters = permissionClasses.map((permissionClass) => ({
          chapterId: permissionClass.chapterId,
          role: permissionClass.role,
        }));
        expect(canClassesAccessSource(source, permissionClasses)).toBe(
          canAccessSource(
            { addedBy: "owner", ...source },
            { id: "other", isAdmin: false },
            chapters,
          ),
        );
      }
    }
  });

  it("never grants private sources to classes", () => {
    expect(
      canClassesAccessSource({ visibility: "private", chapterId: null }, classes[4] ?? []),
    ).toBe(false);
  });
});
