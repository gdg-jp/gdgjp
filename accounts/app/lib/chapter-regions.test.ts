import { describe, expect, it } from "vitest";
import { CHAPTER_REGIONS, isChapterRegion, isOnboardingVisibleSlug } from "./chapter-regions";

describe("chapter-regions", () => {
  it("lists regions north to south then other", () => {
    expect(CHAPTER_REGIONS[0]).toBe("hokkaido");
    expect(CHAPTER_REGIONS.at(-1)).toBe("other");
  });

  it("validates region strings", () => {
    expect(isChapterRegion("kanto")).toBe(true);
    expect(isChapterRegion("midwest")).toBe(false);
  });

  it("hides demo and gde from onboarding", () => {
    expect(isOnboardingVisibleSlug("gdg-tokyo")).toBe(true);
    expect(isOnboardingVisibleSlug("demo")).toBe(false);
    expect(isOnboardingVisibleSlug("gde")).toBe(false);
  });
});
