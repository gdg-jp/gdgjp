import { describe, expect, it } from "vitest";
import { shouldStartChapterOnboarding } from "./onboarding-policy";

describe("shouldStartChapterOnboarding", () => {
  it("starts when the user has no memberships and has not skipped", () => {
    expect(shouldStartChapterOnboarding(0, false)).toBe(true);
  });

  it("does not start when the user already has a membership", () => {
    expect(shouldStartChapterOnboarding(1, false)).toBe(false);
  });

  it("does not start when the session skip cookie is present", () => {
    expect(shouldStartChapterOnboarding(0, true)).toBe(false);
  });
});
