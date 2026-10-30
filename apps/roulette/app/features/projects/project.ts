import type { Mode, Prize } from "~/features/prizes/prize";

export type Project = {
  slug: string;
  name: string;
  chapterId: number;
  chapterSlug: string;
  open: boolean;
  mode: Mode;
  /** Expected number of visitors for the standard and evil modes. */
  expected: number;
  draws: number;
  /** Increments on every settings save. */
  revision: number;
  updatedAt: number;
  prizes: Prize[];
};

/** Without prizes, so also without the mode (evil is told apart by its prizes). */
export type ProjectSummary = Omit<Project, "prizes" | "mode"> & { prizeCount: number };
