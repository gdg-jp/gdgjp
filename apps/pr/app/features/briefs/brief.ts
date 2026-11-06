import briefSchema from "@skills/pr-playbook/references/brief.schema.json";
import { validateSchema } from "@skills/pr-playbook/scripts/checks/index.mjs";

/** Mirrors skills/pr-playbook/references/brief.schema.json (the source of truth). */
export type SessionStatus = "tba" | "confirmed" | "public";
export type SessionFlag = "no_recording" | "english" | "onsite_only" | "bring_pc";

export type Brief = {
  event: {
    name: string;
    officialSeries?: string;
    startAt: string;
    endAt: string;
    venue: string;
    address?: string;
    format: "onsite" | "online" | "hybrid";
    fee: string;
    capacity?: number;
    connpassUrl?: string;
    hashtag?: string;
    streamUrls?: Record<string, string>;
  };
  metaThemes: string[];
  audienceSegments: { id: string; label: string; note?: string }[];
  goals: {
    applications: number;
    curve?: { date: string; applications: number }[];
    bySegment?: Record<string, number>;
  };
  speakers: {
    id: string;
    name: string;
    role: string;
    org?: string;
    xHandle?: string;
    followers?: number;
    imageUrl?: string;
    tier: "normal" | "high";
    sessionIds?: string[];
  }[];
  sessions: {
    id: string;
    title: string;
    abstract?: string;
    track?: string;
    startAt?: string;
    endAt?: string;
    speakerIds: string[];
    keywords?: string[];
    status: SessionStatus;
    publishAfter?: string;
    flags?: SessionFlag[];
  }[];
  budget: { totalYen: number; printYen?: number; adsSplit?: { x?: number; ig?: number } };
  skin?: {
    bg?: string;
    panelBg?: string;
    accent?: string[];
    textColor?: string;
    headingFont?: string;
    tone?: string;
    referenceAssetUrls?: string[];
    brandGuideUrl?: string;
  };
  copyConstraints?: string[];
  chapters?: { chapterId: number; role: "host" | "co-host"; name?: string }[];
  accounts?: {
    kind: "x" | "ig" | "connpass_group";
    handle: string;
    chapterId?: number;
    role: "primary" | "mirror";
  }[];
  preEvents?: { name: string; date: string; venue?: string; url?: string; leadsTo?: string }[];
  novelty?: string[];
  connections?: {
    kind: string;
    name: string;
    relation?: string;
    channel?: string;
    owner?: string;
  }[];
  constraints?: string[];
  notes?: string;
};

export const BRIEF_SCHEMA = briefSchema;
export const BRIEF_REQUIRED: readonly string[] = briefSchema.required;

/**
 * Drop empty strings, nulls and empty objects so optional keys are simply absent. Arrays stay
 * (a session may legitimately have no speakers); empty entries inside them go.
 */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact).filter((v) => !isEmpty(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const next = compact(child);
      if (!isEmpty(next)) out[key] = next;
    }
    return out as T;
  }
  return value;
}
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return false;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export type BriefParse = { ok: true; brief: Brief } | { ok: false; errors: string[] };

export function parseBrief(value: unknown): BriefParse {
  const brief = compact(value);
  const errors = validateSchema(BRIEF_SCHEMA, brief);
  if (errors.length) return { ok: false, errors };
  const typed = brief as Brief;
  const sessionIds = new Set(typed.sessions.map((s) => s.id));
  const speakerIds = new Set(typed.speakers.map((s) => s.id));
  const extra: string[] = [];
  if (sessionIds.size !== typed.sessions.length) extra.push("$.sessions: id が重複している");
  if (speakerIds.size !== typed.speakers.length) extra.push("$.speakers: id が重複している");
  for (const session of typed.sessions) {
    for (const id of session.speakerIds)
      if (!speakerIds.has(id)) extra.push(`$.sessions(${session.id}): 登壇者 ${id} が無い`);
  }
  if (Number.isNaN(Date.parse(typed.event.startAt))) extra.push("$.event.startAt: 日時が読めない");
  return extra.length ? { ok: false, errors: extra } : { ok: true, brief: typed };
}

/** A brief that passes the schema, for a campaign that has none yet. */
export function emptyBrief(name: string, startAt: string | null, venue: string | null): Brief {
  return {
    event: {
      name,
      startAt: startAt ?? "",
      endAt: startAt ?? "",
      venue: venue ?? "",
      format: "onsite",
      fee: "無料",
    },
    metaThemes: [],
    audienceSegments: [],
    goals: { applications: 0 },
    speakers: [],
    sessions: [],
    budget: { totalYen: 0 },
  };
}
