import type { Method, Prize } from "~/features/prizes/prize";

export type Project = {
  slug: string;
  name: string;
  chapterId: number;
  chapterSlug: string;
  open: boolean;
  method: Method;
  /** Expected number of visitors for the "box" method. */
  expected: number;
  draws: number;
  /** Increments on every settings save. */
  revision: number;
  updatedAt: number;
  prizes: Prize[];
};

export type ProjectSummary = Omit<Project, "prizes"> & { prizeCount: number };
