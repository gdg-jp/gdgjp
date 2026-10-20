import {
  type ClientMessage,
  DEFAULT_DENOISE,
  DEFAULT_TIMER,
  DENOISE_STATES,
  EMPTY_REPORT,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  type Message,
  NO_SIMULCAST,
  type OperatorView,
  type OutputView,
  type Peer,
  type SelfReport,
  type Slot,
  type SpeakerView,
  type StageMeta,
  type Timer,
  clampAttenDb,
  isSlot,
  slotsOf,
} from "./protocol";

/**
 * Everything the StageRoom persists. Pure functions here; the Durable Object
 * only loads, applies and saves, so all rules are unit-testable.
 */
export type RoomData = {
  onAir: boolean;
  slots: Partial<Record<Slot, string | null>>;
  timer: Timer;
  /** Speakers survive disconnects (so they return to their slot); operators do not. */
  peers: Record<string, Peer>;
  messages: Message[];
};

export const MESSAGE_LIMIT = 200;

export function emptyRoom(): RoomData {
  return { onAir: false, slots: {}, timer: DEFAULT_TIMER, peers: {}, messages: [] };
}

export type Sender = { id: string; role: "operator" | "speaker"; name: string };

export function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_NAME_LENGTH) : "";
}

/** Milliseconds left on the timer; negative once overrun. */
export function timerRemaining(timer: Timer, now: number): number {
  const running = timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt);
  return timer.durationMs - timer.elapsedMs - running;
}

export function connectPeer(data: RoomData, sender: Sender, now: number): RoomData {
  const existing = data.peers[sender.id];
  const peer: Peer = existing
    ? {
        ...existing,
        name: sender.name || existing.name,
        online: true,
        since: now,
        // Rooms saved before noise suppression existed lack these.
        denoise: existing.denoise ?? DEFAULT_DENOISE,
        denoiseState: existing.denoiseState ?? null,
        simulcast: existing.simulcast ?? NO_SIMULCAST,
      }
    : {
        ...EMPTY_REPORT,
        id: sender.id,
        role: sender.role,
        name: sender.name,
        online: true,
        since: now,
        denoise: DEFAULT_DENOISE,
      };
  return { ...data, peers: { ...data.peers, [sender.id]: peer } };
}

export function disconnectPeer(data: RoomData, id: string, now: number): RoomData {
  const peer = data.peers[id];
  if (!peer) return data;
  if (peer.role === "operator") {
    const { [id]: _gone, ...rest } = data.peers;
    return { ...data, peers: rest };
  }
  // The SFU session dies with the page; keep the speaker (and its slot) so a
  // reload or reconnect lands back in place, but drop what can no longer play.
  return {
    ...data,
    peers: {
      ...data.peers,
      [id]: {
        ...peer,
        online: false,
        since: now,
        talking: false,
        quality: null,
        denoiseState: null,
        simulcast: NO_SIMULCAST,
      },
    },
  };
}

function sanitizeReport(report: Partial<SelfReport>): Partial<SelfReport> {
  const out: Partial<SelfReport> = {};
  if (report.sfuSessionId === null || typeof report.sfuSessionId === "string") {
    out.sfuSessionId = report.sfuSessionId;
  }
  if (report.tracks && typeof report.tracks === "object") {
    const t = report.tracks;
    const str = (v: unknown) => (typeof v === "string" && v.length <= 128 ? v : null);
    out.tracks = {
      mic: str(t.mic),
      camera: str(t.camera),
      screen: str(t.screen),
      screenAudio: str(t.screenAudio),
    };
  }
  if (report.simulcast && typeof report.simulcast === "object") {
    out.simulcast = {
      camera: report.simulcast.camera === true,
      screen: report.simulcast.screen === true,
    };
  }
  for (const key of ["mic", "cam", "screen", "screenAudio", "talking"] as const) {
    if (typeof report[key] === "boolean") out[key] = report[key];
  }
  if (report.quality === null || ["good", "fair", "poor"].includes(report.quality as string)) {
    out.quality = report.quality;
  }
  if (
    report.denoiseState === null ||
    (DENOISE_STATES as readonly string[]).includes(report.denoiseState as string)
  ) {
    out.denoiseState = report.denoiseState;
  }
  return out;
}

export type ApplyResult = { data: RoomData; changed: boolean };

const unchanged = (data: RoomData): ApplyResult => ({ data, changed: false });

export function applyMessage(
  data: RoomData,
  meta: StageMeta,
  sender: Sender,
  msg: ClientMessage,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): ApplyResult {
  const isOperator = sender.role === "operator";
  switch (msg.type) {
    case "self": {
      const peer = data.peers[sender.id];
      if (!peer || !msg.report || typeof msg.report !== "object") return unchanged(data);
      const next = { ...peer, ...sanitizeReport(msg.report) };
      if (JSON.stringify(next) === JSON.stringify(peer)) return unchanged(data);
      return { data: { ...data, peers: { ...data.peers, [sender.id]: next } }, changed: true };
    }
    case "name": {
      const peer = data.peers[sender.id];
      const name = cleanName(msg.name);
      if (!peer || !name || name === peer.name) return unchanged(data);
      return {
        data: { ...data, peers: { ...data.peers, [sender.id]: { ...peer, name } } },
        changed: true,
      };
    }
    case "assign": {
      if (!isOperator || !isSlot(msg.slot) || !slotsOf(meta.slotCount).includes(msg.slot)) {
        return unchanged(data);
      }
      const target = msg.participantId;
      if (target !== null && data.peers[target]?.role !== "speaker") return unchanged(data);
      const slots = { ...data.slots };
      // A speaker occupies at most one slot: moving it frees the old one.
      if (target !== null) {
        for (const s of Object.keys(slots) as Slot[]) if (slots[s] === target) slots[s] = null;
      }
      slots[msg.slot] = target;
      return { data: { ...data, slots }, changed: true };
    }
    case "onAir": {
      if (!isOperator || typeof msg.value !== "boolean" || msg.value === data.onAir) {
        return unchanged(data);
      }
      return { data: { ...data, onAir: msg.value }, changed: true };
    }
    case "timer": {
      if (!isOperator) return unchanged(data);
      const t = data.timer;
      let timer: Timer = t;
      if (msg.action === "start" && t.startedAt === null) {
        timer = { ...t, startedAt: now };
      } else if (msg.action === "pause" && t.startedAt !== null) {
        timer = { ...t, startedAt: null, elapsedMs: t.elapsedMs + Math.max(0, now - t.startedAt) };
      } else if (msg.action === "reset") {
        const durationMs =
          typeof msg.durationMs === "number" && msg.durationMs > 0 && msg.durationMs <= 6 * 3600_000
            ? Math.round(msg.durationMs)
            : t.durationMs;
        timer = { durationMs, startedAt: null, elapsedMs: 0 };
      }
      if (timer === t) return unchanged(data);
      return { data: { ...data, timer }, changed: true };
    }
    case "message": {
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      if (!text) return unchanged(data);
      const kind = isOperator && msg.kind === "cue" ? "cue" : "chat";
      // Speakers always write to the operators; operators address one speaker or all.
      const to =
        isOperator && typeof msg.to === "string" && data.peers[msg.to]?.role === "speaker"
          ? msg.to
          : null;
      const message: Message = {
        id: newId(),
        kind,
        from: { id: sender.id, name: sender.name, role: sender.role },
        to,
        text,
        at: now,
      };
      return {
        data: { ...data, messages: [...data.messages, message].slice(-MESSAGE_LIMIT) },
        changed: true,
      };
    }
    case "remove": {
      const peer = data.peers[msg.participantId];
      if (!isOperator || !peer || peer.role !== "speaker" || peer.online) return unchanged(data);
      const { [msg.participantId]: _gone, ...peers } = data.peers;
      const slots = { ...data.slots };
      for (const s of Object.keys(slots) as Slot[]) {
        if (slots[s] === msg.participantId) slots[s] = null;
      }
      return { data: { ...data, peers, slots }, changed: true };
    }
    case "denoise": {
      const peer = data.peers[msg.participantId];
      if (!isOperator || !peer || peer.role !== "speaker") return unchanged(data);
      const current = peer.denoise ?? DEFAULT_DENOISE;
      const denoise = {
        on: typeof msg.on === "boolean" ? msg.on : current.on,
        attenDb:
          typeof msg.attenDb === "number" && Number.isFinite(msg.attenDb)
            ? clampAttenDb(msg.attenDb)
            : current.attenDb,
      };
      if (denoise.on === current.on && denoise.attenDb === current.attenDb) {
        return unchanged(data);
      }
      return {
        data: { ...data, peers: { ...data.peers, [peer.id]: { ...peer, denoise } } },
        changed: true,
      };
    }
    case "reset": {
      if (!isOperator) return unchanged(data);
      const peers: Record<string, Peer> = {};
      for (const [id, peer] of Object.entries(data.peers)) if (peer.online) peers[id] = peer;
      return {
        data: { onAir: false, slots: {}, timer: DEFAULT_TIMER, peers, messages: [] },
        changed: true,
      };
    }
    default:
      return unchanged(data);
  }
}

function byName(a: Peer, b: Peer): number {
  return a.since - b.since || a.name.localeCompare(b.name);
}

function peersOf(data: RoomData, role: Peer["role"]): Peer[] {
  return Object.values(data.peers)
    .filter((p) => p.role === role)
    .sort(byName);
}

export function slotOf(data: RoomData, meta: StageMeta, peerId: string): Slot | null {
  return slotsOf(meta.slotCount).find((s) => data.slots[s] === peerId) ?? null;
}

export function operatorView(
  data: RoomData,
  meta: StageMeta,
  selfId: string,
  now: number,
): OperatorView {
  const slots: OperatorView["slots"] = {};
  for (const s of slotsOf(meta.slotCount)) slots[s] = data.slots[s] ?? null;
  return {
    role: "operator",
    serverNow: now,
    stage: meta,
    onAir: data.onAir,
    slots,
    timer: data.timer,
    speakers: peersOf(data, "speaker"),
    operators: peersOf(data, "operator"),
    messages: data.messages,
    selfId,
  };
}

export function speakerView(
  data: RoomData,
  meta: StageMeta,
  selfId: string,
  now: number,
): SpeakerView {
  return {
    role: "speaker",
    serverNow: now,
    stage: { id: meta.id, name: meta.name },
    onAir: data.onAir,
    slot: slotOf(data, meta, selfId),
    timer: data.timer,
    denoise: data.peers[selfId]?.denoise ?? DEFAULT_DENOISE,
    operators: peersOf(data, "operator"),
    messages: data.messages.filter(
      (m) =>
        m.from.id === selfId || m.to === selfId || (m.to === null && m.from.role === "operator"),
    ),
    selfId,
  };
}

export function outputView(data: RoomData, slot: Slot, now: number): OutputView {
  const id = data.slots[slot];
  return { role: "output", serverNow: now, slot, peer: id ? (data.peers[id] ?? null) : null };
}

export type StageSummary = { onAir: boolean; outputs: number; participants: number };

export function summarize(data: RoomData, meta: StageMeta): StageSummary {
  const outputs = slotsOf(meta.slotCount).filter((s) => {
    const id = data.slots[s];
    return id ? data.peers[id]?.online === true : false;
  }).length;
  const participants = Object.values(data.peers).filter(
    (p) => p.role === "speaker" && p.online,
  ).length;
  return { onAir: data.onAir, outputs, participants };
}
