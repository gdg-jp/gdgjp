import type { Chapter } from "~/features/chapters/types";

export type OnboardingChapter = Pick<Chapter, "id" | "slug" | "name" | "kind" | "region">;
