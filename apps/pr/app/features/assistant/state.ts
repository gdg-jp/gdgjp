import type { Brief } from "~/features/briefs/brief";

/** Where a campaign is: what the progress bar shows and what the assistant reads first. */
export const PHASES = ["prepare", "plan", "promote", "event", "retro"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  prepare: "準備",
  plan: "計画",
  promote: "告知中",
  event: "当日",
  retro: "振り返り",
};

/** What a brief still lacks before a plan makes sense. */
export function briefGaps(brief: Brief | null): string[] {
  if (!brief) return ["イベントの情報"];
  const gaps: string[] = [];
  if (!brief.event.startAt || Number.isNaN(Date.parse(brief.event.startAt))) gaps.push("日時");
  if (!brief.event.venue && brief.event.format !== "online") gaps.push("会場");
  if (!(brief.goals.applications > 0)) gaps.push("申込目標");
  return gaps;
}

export function phaseOf(input: {
  status: "draft" | "active" | "closed";
  briefReady: boolean;
  planAdopted: boolean;
  eventAt: number | null;
  endAt: number | null;
  now: number;
}): Phase {
  if (input.status === "closed") return "retro";
  if (input.eventAt && input.now >= input.eventAt - 6 * 3600) {
    const end = input.endAt ?? input.eventAt + 12 * 3600;
    return input.now <= end + 6 * 3600 ? "event" : "retro";
  }
  if (!input.briefReady) return "prepare";
  if (!input.planAdopted) return "plan";
  return "promote";
}
