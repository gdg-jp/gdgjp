import type { UploadedClip } from "~/features/clips/catalog";

export const PING = "ping";

export function roomName(track: string): string {
  return `track:${track}`;
}
export const PONG = "pong";

export const CLOSE_REPLACED = 4000;
export const CLOSE_TOKEN_ROTATED = 4001;

export type PlayerStatus = "idle" | "playing" | "paused" | "ended" | "gap";

export type LoopSetting = { enabled: boolean; gapSec: number };

export type PlayerDiagnostics = {
  preload: { loaded: number; total: number; failed: string[] };
  autoplay: "ok" | "blocked" | "unknown";
  muted: boolean;
  volume: number;
  visibility: "visible" | "hidden";
  stalled: boolean;
  lastError: string | null;
  userAgent: string;
};

export type PlayerState = {
  clipId: string | null;
  status: PlayerStatus;
  positionMs: number;
  durationMs: number;
  gapRemainingMs: number;
  diag: PlayerDiagnostics;
};

export type Command =
  | { kind: "play"; clipId: string; fromMs: number }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "restart" }
  | { kind: "seek"; ms: number };

export type FailureReason =
  | "offline"
  | "no-player"
  | "timeout"
  | "autoplay-blocked"
  | "media-error"
  | "not-advancing"
  | "unknown-clip"
  | "invalid";

export type LogEntry = {
  at: number;
  level: "info" | "warn" | "error";
  code: string;
  detail?: string;
};

export type PlayerPresence = {
  connId: string;
  connectedAt: number;
  lastSeenAt: number;
  state: PlayerState | null;
};

export type RoomConfig = {
  played: Record<string, true>;
  loops: Record<string, LoopSetting>;
};

export type ControllerMessage =
  | { type: "cmd"; id: string; cmd: Command }
  | { type: "setLoop"; clipId: string; setting: LoopSetting }
  | { type: "setPlayed"; clipId: string; value: boolean }
  | { type: "resetPlayed" }
  | { type: "rotateToken" }
  /**
   * Sent every HEARTBEAT_MS and relayed to players, which answer with a state
   * report. A hidden page's timers can be throttled to once a minute, but its
   * message handlers are not, so this keeps a hidden OBS source visibly alive.
   */
  | { type: "probe" };

export type PlayerMessage =
  | { type: "state"; state: PlayerState }
  | { type: "ack"; id: string; ok: true; state: PlayerState }
  | {
      type: "ack";
      id: string;
      ok: false;
      reason: FailureReason;
      detail?: string;
      state: PlayerState;
    }
  | { type: "log"; entry: Omit<LogEntry, "at"> };

export type ToControllerMessage =
  | {
      type: "snapshot";
      serverNow: number;
      token: string;
      config: RoomConfig;
      players: PlayerPresence[];
      log: LogEntry[];
      clips: UploadedClip[];
    }
  | { type: "player"; serverNow: number; presence: PlayerPresence }
  | { type: "playerGone"; connId: string }
  | { type: "config"; config: RoomConfig }
  | { type: "token"; token: string }
  | { type: "catalog"; clips: UploadedClip[] }
  | { type: "result"; id: string; ok: true }
  | { type: "result"; id: string; ok: false; reason: FailureReason; detail?: string }
  | { type: "log"; entry: LogEntry };

export type ToPlayerMessage =
  | { type: "cmd"; id: string; cmd: Command }
  | { type: "config"; config: RoomConfig }
  | { type: "catalog"; clips: UploadedClip[] }
  | { type: "probe" };

export const ACK_TIMEOUT_MS = 1500;
export const HEARTBEAT_MS = 1000;
export const STALE_MS = 3000;
export const REPORT_ACTIVE_MS = 250;
export const REPORT_IDLE_MS = 1000;

export const MAX_LOOP_GAP_SEC = 600;

export function defaultLoop(clipLoop: boolean): LoopSetting {
  return { enabled: clipLoop, gapSec: 0 };
}

export function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
