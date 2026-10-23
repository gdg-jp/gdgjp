/**
 * Wire protocol between controllers (phones and the editor), the OBS dock and
 * the per-deck DeckRoom Durable Object. JSON text frames, except the
 * heartbeat: the literal "ping" → "pong" pair answered by the DO's WebSocket
 * auto-response (it never wakes the object).
 *
 * Controllers only ever say "key X was pressed" (plus a slider value for
 * volume keys); the room resolves the key in the saved layout and sends the
 * dock the steps to run. A controller cannot make the dock send anything that
 * is not on a key of the deck.
 */

import type { DeckLayout, Step } from "~/features/deck/model";
import type { Phase } from "~/features/obs/requests";
import type { ObsState } from "~/features/obs/state";

export const PING = "ping";
export const PONG = "pong";
export const HEARTBEAT_MS = 1000;
export const STALE_MS = 3500;

export type Role = "controller" | "dock";

/** Close codes after which the client should stop and show an error. */
export const CLOSE_REPLACED = 4002;
export const CLOSE_REVOKED = 4003;
export const CLOSE_DELETED = 4004;

export const LOG_LIMIT = 200;

export type LogEntry = {
  id: string;
  at: number;
  by: string;
  keyId: string;
  title: string;
  /** "pending" until the dock answers. */
  status: "pending" | "ok" | "error";
  error: string | null;
};

export type DeckInfo = { id: string; name: string; version: number };

/** What the deck list shows per deck. */
export type DeckSummary = {
  dockOnline: boolean;
  obsConnected: boolean;
  streaming: boolean;
  recording: boolean;
};

// ─── controller ⇄ room ────────────────────────────────────────────────────

export type ControllerMessage =
  | { type: "press"; keyId: string; phase: Phase }
  | { type: "volume"; keyId: string; db: number }
  /** Ask the dock to re-read everything from OBS (editor pickers). */
  | { type: "refresh" };

export type ToControllerMessage =
  | {
      type: "hello";
      deck: DeckInfo;
      layout: DeckLayout;
      obs: ObsState;
      dockOnline: boolean;
      switches: Record<string, boolean>;
      log: LogEntry[];
      serverNow: number;
    }
  | { type: "layout"; deck: DeckInfo; layout: DeckLayout }
  | { type: "obs"; obs: ObsState; serverNow: number }
  | { type: "dock"; online: boolean }
  | { type: "switches"; switches: Record<string, boolean> }
  | { type: "log"; entry: LogEntry };

// ─── dock ⇄ room ──────────────────────────────────────────────────────────

export type DockMessage =
  /** `dockNow` lets the room move the output start times onto its own clock. */
  | { type: "state"; obs: ObsState; dockNow: number }
  | { type: "result"; runId: string; ok: boolean; error: string | null };

export type ToDockMessage =
  | { type: "hello"; deck: DeckInfo; log: LogEntry[] }
  | { type: "run"; runId: string; steps: Step[]; phase: Phase; value?: number }
  | { type: "refresh" }
  | { type: "log"; entry: LogEntry };

export function parseJson<T>(raw: string | ArrayBuffer | null | undefined): T | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
