import { type Segment, isTrack } from "./catalog";

export type ClipInput = {
  track: string | null;
  after: string | null;
  title: string;
  segments: Segment[];
};

export type NewClipInput = ClipInput & { id: string; file: string; durationMs: number };

export const UPLOAD_ID_RE = /^U-[0-9a-f]{10}$/;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_DURATION_MS = 30 * 60 * 1000;
export const UPLOAD_ACCEPT = ".wav,.mp3,.ogg,.flac,.aac,audio/wav,audio/mpeg,audio/ogg,audio/flac";

export function newUploadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `U-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function audioMimeType(type: string, name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const t = type.toLowerCase();
  if (t.includes("wav") || ext === "wav") return "audio/wav";
  if (t === "audio/mpeg" || t === "audio/mp3" || ext === "mp3") return "audio/mp3";
  if (t.includes("ogg") || ext === "ogg") return "audio/ogg";
  if (t.includes("flac") || ext === "flac") return "audio/flac";
  if (t.includes("aac") || ext === "aac") return "audio/aac";
  return null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

function parseSegments(v: unknown, durationMs: number): Segment[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500) return null;
  const out: Segment[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) return null;
    const { s, e, t } = raw as Record<string, unknown>;
    if (typeof s !== "number" || typeof e !== "number" || typeof t !== "string") return null;
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) return null;
    if (durationMs > 0 && e > durationMs + 50) return null;
    if (!t.trim() || t.length > 2000) return null;
    out.push({ s: Math.round(s), e: Math.round(e), t: t.trim() });
  }
  return out;
}

export function parseClipInput(body: unknown, durationMs: number): Parsed<ClipInput> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body" };
  const b = body as Record<string, unknown>;
  const track =
    b.track === null ? null : isTrack(b.track as string) ? (b.track as string) : undefined;
  if (track === undefined) return { ok: false, error: "track" };
  const after = b.after === null ? null : str(b.after, 64);
  if (after === null && b.after !== null) return { ok: false, error: "after" };
  const title = str(b.title, 200);
  if (!title) return { ok: false, error: "title" };
  const segments = parseSegments(b.segments, durationMs);
  if (!segments) return { ok: false, error: "segments" };
  return { ok: true, value: { track, after, title, segments } };
}

export function parseNewClipInput(body: unknown): Parsed<NewClipInput> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body" };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" && UPLOAD_ID_RE.test(b.id) ? b.id : null;
  if (!id) return { ok: false, error: "id" };
  const file = str(b.file, 200);
  if (!file) return { ok: false, error: "file" };
  const durationMs = b.durationMs;
  if (typeof durationMs !== "number" || !(durationMs > 0) || durationMs > MAX_DURATION_MS) {
    return { ok: false, error: "durationMs" };
  }
  const rest = parseClipInput(body, durationMs);
  if (!rest.ok) return rest;
  return { ok: true, value: { ...rest.value, id, file, durationMs: Math.round(durationMs) } };
}
