import { describe, expect, it } from "vitest";
import { canClassesSeePage } from "./access";
import type { PageSubject, PermissionClass } from "./types";

const TOKYO_MEMBER: PermissionClass = { chapterId: "tokyo", role: "member" };
const TOKYO_ORGANIZER: PermissionClass = { chapterId: "tokyo", role: "organizer" };
const OSAKA_MEMBER: PermissionClass = { chapterId: "osaka", role: "member" };
const page = (visibility: string, access: PageSubject["access"] = []): PageSubject => ({
  visibility,
  chapterId: null,
  access,
});

describe("canClassesSeePage", () => {
  it("allows public and unlisted pages and rejects unknown visibility", () => {
    expect(canClassesSeePage(page("public"), [])).toBe(true);
    expect(canClassesSeePage(page("unlisted"), [])).toBe(true);
    expect(canClassesSeePage(page("future"), [TOKYO_MEMBER])).toBe(false);
  });

  it("requires classes for member and organizer pages", () => {
    expect(canClassesSeePage(page("member"), [])).toBe(false);
    expect(canClassesSeePage(page("member"), [TOKYO_MEMBER])).toBe(true);
    expect(canClassesSeePage(page("organizer"), [TOKYO_MEMBER])).toBe(false);
    expect(canClassesSeePage(page("organizer"), [TOKYO_ORGANIZER])).toBe(true);
  });

  it("matches chapter grants and ignores email grants", () => {
    const restricted = page("restricted", [
      { subjectType: "chapter", subjectKey: "tokyo" },
      { subjectType: "email", subjectKey: "a@example.com" },
    ]);
    expect(canClassesSeePage(restricted, [TOKYO_MEMBER])).toBe(true);
    expect(
      canClassesSeePage(page("restricted", [{ subjectType: "email", subjectKey: "a" }]), [
        TOKYO_MEMBER,
      ]),
    ).toBe(false);
    expect(
      canClassesSeePage(page("restricted", [{ subjectType: "chapter", subjectKey: "osaka" }]), [
        TOKYO_MEMBER,
      ]),
    ).toBe(false);
    expect(canClassesSeePage(restricted, [OSAKA_MEMBER])).toBe(false);
  });
});
