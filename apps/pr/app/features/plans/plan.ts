/** Mirrors skills/pr-plan/references/output.schema.json. */
export type PlanItem = {
  ref: string;
  kind: string;
  channel: string | null;
  dueAt: string;
  title: string;
  speakerId: string | null;
  sessionId: string | null;
  segmentId: string | null;
  blockedBy: string[];
  derivedFrom: string | null;
  offsetMinutes: number | null;
  purpose: string | null;
  suggestionOnly: boolean | null;
  variant: string | null;
  assigneeRole: string | null;
};

export type PlanBody = {
  strategyMd: string;
  goalCurve: { date: string; applications: number }[];
  channelMix: {
    channel: string;
    label: string | null;
    adopt: boolean;
    reason: string;
    weight: number | null;
  }[];
  budgetAllocation: {
    totalYen: number;
    printYen: number;
    adsYen: number;
    x: number;
    ig: number;
    byWeek: { weekOf: string; x: number; ig: number; print: number }[];
    flights: {
      medium: "x_ads" | "ig_ads" | "print";
      name: string;
      startDaysBefore: number;
      endDaysBefore: number;
      plannedYen: number;
      phases: { fromDay: number; toDay: number; objective: string }[];
    }[];
  };
  scheduleItems: PlanItem[];
  preEvents: { name: string; date: string; leadsTo: string }[];
  outreach: { organization: string; kind: string; ownerRole: string | null; pitchMd: string }[];
  connectionsToUse: { name: string; why: string }[];
  noveltyIdeas: { kind: string; idea: string }[];
  segmentContentIdeas: { segmentId: string; idea: string }[];
  surveyQuestions: {
    title: string;
    answerType: string;
    required: boolean;
    options: string[] | null;
  }[];
  notes: string | null;
};

export type Plan = {
  id: number;
  campaignId: number;
  version: number;
  body: PlanBody;
  status: "draft" | "adopted" | "superseded";
  jobId: string | null;
  author: string;
  playbookVersion: string;
  checkResults: import("@skills/pr-playbook/scripts/checks/index.mjs").CheckResult[];
  createdAt: number;
};
