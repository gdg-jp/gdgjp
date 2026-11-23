import type { ChapterRegion } from "~/features/chapters/types";

export const CHAPTER_REGIONS: readonly ChapterRegion[] = [
  "hokkaido",
  "tohoku",
  "kanto",
  "chubu",
  "kansai",
  "chugoku",
  "shikoku",
  "kyushu",
  "other",
] as const;

const REGION_SET = new Set<string>(CHAPTER_REGIONS);

export function isChapterRegion(value: string): value is ChapterRegion {
  return REGION_SET.has(value);
}

export const ONBOARDING_HIDDEN_SLUGS = new Set(["demo", "gde"]);

export function isOnboardingVisibleSlug(slug: string): boolean {
  return !ONBOARDING_HIDDEN_SLUGS.has(slug);
}
