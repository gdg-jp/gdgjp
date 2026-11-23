import type { Mode, Prize } from "~/features/prizes/prize";

export type Project = {
  slug: string;
  name: string;
  chapterId: number;
  chapterSlug: string;
  open: boolean;
  mode: Mode;
  expected: number;
  draws: number;
  revision: number;
  updatedAt: number;
  prizes: Prize[];
};

export type ProjectSummary = Omit<Project, "prizes" | "mode"> & { prizeCount: number };
