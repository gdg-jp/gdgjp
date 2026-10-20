/**
 * Wire protocol between the control room, speaker pages, OBS output pages and
 * the per-stage StageRoom Durable Object. Everything is JSON text frames
 * except the heartbeat, the literal "ping" → "pong" pair answered by the DO's
 * WebSocket auto-response (it never wakes the object).
 *
 * Media never passes through here: each page holds its own Cloudflare Realtime
 * SFU session and the room only tells everyone which SFU session/track names to
 * pull.
 */

export const PING = "ping";
export const PONG = "pong";
export const HEARTBEAT_MS = 1000;
export const STALE_MS = 3500;

export const SLOTS = ["A", "B", "C", "D"] as const;
export type Slot = (typeof SLOTS)[number];

export const OUTPUT_KINDS = ["camera", "screen", "mic"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export type Role = "operator" | "speaker" | "output";

/** Close codes after which the client should stop and show an error. */
export const CLOSE_REPLACED = 4002;
export const CLOSE_REVOKED = 4003;
export const CLOSE_DELETED = 4004;

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

export function isOutputKind(value: unknown): value is OutputKind {
  return typeof value === "string" && (OUTPUT_KINDS as readonly string[]).includes(value);
}

export function clampAttenDb(value: number): number {
  return Math.min(DENOISE_MAX_DB, Math.max(DENOISE_MIN_DB, Math.round(value)));
}

export function slotsOf(count: number): Slot[] {
  return SLOTS.slice(0, Math.min(Math.max(count, 1), SLOTS.length));
}

/** SFU track names a peer has published. Every page publishes all four up front. */
export type Tracks = {
  mic: string | null;
  camera: string | null;
  screen: string | null;
  screenAudio: string | null;
};

export const NO_TRACKS: Tracks = { mic: null, camera: null, screen: null, screenAudio: null };

/**
 * Which video tracks the SFU actually took as simulcast (f/h/q layers).
 * Pullers ask for a layer only when this says the layers exist; otherwise
 * they pull the single stream as before (other browsers, older pages).
 */
export type Simulcast = { camera: boolean; screen: boolean };

export const NO_SIMULCAST: Simulcast = { camera: false, screen: false };

export type Quality = "good" | "fair" | "poor";

/** Operator-set DeepFilterNet3 noise suppression for one participant. */
export type DenoiseSetting = {
  on: boolean;
  /** Attenuation limit in dB: how far noise may be pulled down. */
  attenDb: number;
};

export const DENOISE_MIN_DB = 6;
export const DENOISE_MAX_DB = 100;
export const DEFAULT_DENOISE: DenoiseSetting = { on: true, attenDb: 80 };

/**
 * What a page's mic actually goes through. Anything but "active" (or "off"
 * when the operator turned it off) means the browser's own suppression is in
 * use instead.
 */
export const DENOISE_STATES = ["active", "loading", "unsupported", "overload", "off"] as const;
export type DenoiseState = (typeof DENOISE_STATES)[number];

/** What a page reports about its own media. */
export type SelfReport = {
  sfuSessionId: string | null;
  tracks: Tracks;
  simulcast: Simulcast;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  screenAudio: boolean;
  quality: Quality | null;
  /** Operator only: the mic is open toward speakers right now. */
  talking: boolean;
  denoiseState: DenoiseState | null;
};

export const EMPTY_REPORT: SelfReport = {
  sfuSessionId: null,
  tracks: NO_TRACKS,
  simulcast: NO_SIMULCAST,
  mic: false,
  cam: false,
  screen: false,
  screenAudio: false,
  quality: null,
  talking: false,
  denoiseState: null,
};

export type Peer = SelfReport & {
  id: string;
  role: "speaker" | "operator";
  name: string;
  online: boolean;
  /** Last connect/disconnect time (server clock). */
  since: number;
  /** Speakers only; kept across disconnects. Operators always use the default. */
  denoise: DenoiseSetting;
};

export type Timer = {
  durationMs: number;
  /** Server time the current run started; null while stopped. */
  startedAt: number | null;
  /** Elapsed before `startedAt` (accumulated across pauses). */
  elapsedMs: number;
};

export const DEFAULT_TIMER: Timer = { durationMs: 20 * 60_000, startedAt: null, elapsedMs: 0 };

export type MessageKind = "chat" | "cue";

export type Message = {
  id: string;
  kind: MessageKind;
  from: { id: string; name: string; role: "speaker" | "operator" };
  /** Recipient participant id; null = everyone (operator → all speakers, speaker → operators). */
  to: string | null;
  text: string;
  at: number;
};

export type StageMeta = { id: string; name: string; slotCount: number };

/** The control room sees everything. */
export type OperatorView = {
  role: "operator";
  serverNow: number;
  stage: StageMeta;
  onAir: boolean;
  slots: Partial<Record<Slot, string | null>>;
  timer: Timer;
  speakers: Peer[];
  operators: Peer[];
  messages: Message[];
  selfId: string;
};

/** A speaker sees operators, its own slot, and messages meant for it. */
export type SpeakerView = {
  role: "speaker";
  serverNow: number;
  stage: { id: string; name: string };
  onAir: boolean;
  slot: Slot | null;
  timer: Timer;
  /** The operator's noise-suppression choice for this speaker (never shown to them). */
  denoise: DenoiseSetting;
  operators: Peer[];
  messages: Message[];
  selfId: string;
};

/** An OBS output sees only the peer assigned to its slot. */
export type OutputView = {
  role: "output";
  serverNow: number;
  slot: Slot;
  peer: Peer | null;
};

export type View = OperatorView | SpeakerView | OutputView;

export type ToClientMessage = { type: "state"; view: View };

export type ClientMessage =
  | { type: "self"; report: Partial<SelfReport> }
  | { type: "name"; name: string }
  | { type: "assign"; slot: Slot; participantId: string | null }
  | { type: "onAir"; value: boolean }
  | { type: "timer"; action: "start" | "pause" | "reset"; durationMs?: number }
  | { type: "message"; kind: MessageKind; to: string | null; text: string }
  | { type: "remove"; participantId: string }
  | { type: "denoise"; participantId: string; on?: boolean; attenDb?: number }
  | { type: "reset" };

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_NAME_LENGTH = 40;

export function parseJson<T>(raw: ArrayBuffer | string): T | null {
  try {
    return JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as T;
  } catch {
    return null;
  }
}
