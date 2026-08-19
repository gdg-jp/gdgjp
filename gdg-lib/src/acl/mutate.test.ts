import { describe, expect, it } from "vitest";
import { canMutatePage } from "./mutate";
import type { PageSubject, PermissionClass } from "./types";

const page = (visibility: string, chapterId: string | null): PageSubject => ({
  visibility,
  chapterId,
  access: [],
});
const member = (chapterId: string): PermissionClass => ({ chapterId, role: "member" });
const organizer = (chapterId: string): PermissionClass => ({ chapterId, role: "organizer" });

describe("canMutatePage", () => {
  it("fails closed for empty classes", () => {
    expect(canMutatePage([], page("public", null))).toBe(false);
    expect(canMutatePage([], page("restricted", "tokyo"))).toBe(false);
  });

  it("allows organizers across chapters and members only in their chapter", () => {
    expect(canMutatePage([organizer("osaka")], page("restricted", "tokyo"))).toBe(true);
    expect(canMutatePage([member("osaka")], page("restricted", "tokyo"))).toBe(false);
    expect(canMutatePage([member("tokyo")], page("restricted", "tokyo"))).toBe(true);
  });

  it("allows member classes to mutate public/unlisted pages but rejects unknown visibility", () => {
    expect(canMutatePage([member("osaka")], page("public", null))).toBe(true);
    expect(canMutatePage([member("osaka")], page("unlisted", null))).toBe(true);
    expect(canMutatePage([member("osaka")], page("future", "tokyo"))).toBe(false);
  });
});
