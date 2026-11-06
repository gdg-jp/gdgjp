export type AnalyzeReport = {
  reportMd: string;
  findings: { metric: string; observation: string; evidence: string }[];
  budgetReallocation: {
    byMedium: { x_ads: number; ig_ads: number; print: number };
    rationaleMd: string;
  };
  creativeChanges: {
    assetId: number | null;
    templateId: string;
    reason: string;
    slotHints: string;
  }[];
  scheduleChanges: {
    action: "add" | "move" | "drop";
    itemId: number | null;
    kind: string | null;
    dueAt: string | null;
    title: string | null;
    reason: string;
  }[];
  perPerson: { userId: string; thisWeek: string[]; overdue: string[] }[];
  nextWeekFocusMd: string;
};
