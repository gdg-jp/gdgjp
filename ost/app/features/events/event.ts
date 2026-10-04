export type OstEvent = {
  slug: string;
  title: string;
  chapterId: number;
  chapterSlug: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
