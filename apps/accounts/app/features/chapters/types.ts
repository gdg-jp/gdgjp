export type ChapterKind = "gdg" | "gdgoc";
export type ChapterRegion =
  | "hokkaido"
  | "tohoku"
  | "kanto"
  | "chubu"
  | "kansai"
  | "chugoku"
  | "shikoku"
  | "kyushu"
  | "other";
export type Chapter = {
  id: number;
  slug: string;
  name: string;
  kind: ChapterKind;
  region: ChapterRegion;
  createdAt: number;
};

export type ChapterWithCounts = Chapter & {
  activeCount: number;
  pendingCount: number;
};
