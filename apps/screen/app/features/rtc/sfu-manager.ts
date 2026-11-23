import {
  type PulledTrack,
  type PushKey,
  type PushSpec,
  type RemoteRef,
  SfuConnection,
  remoteKey,
} from "./sfu-client";

export type SfuStatus = "connecting" | "connected" | "reconnecting";

export type SfuSnapshot = {
  sessionId: string | null;
  status: SfuStatus;
  remote: ReadonlyMap<string, MediaStreamTrack>;
  layered: readonly PushKey[];
};

export type PublishSlot = Omit<PushSpec, "track">;

const RETRY_PULL_MS = 2000;

export function rebuildDelay(attempt: number): number {
  return Math.min(4000, 500 * 2 ** Math.max(0, attempt));
}

export class SfuManager {
  private conn: SfuConnection | null = null;
  private local = new Map<PushKey, MediaStreamTrack | null>();
  private wanted = new Map<string, RemoteRef>();
  private have = new Map<string, PulledTrack>();
  private listeners = new Set<() => void>();
  private snapshot: SfuSnapshot = {
    sessionId: null,
    status: "connecting",
    remote: new Map(),
    layered: [],
  };
  private stopped = false;
  private attempt = 0;
  private syncing = false;
  private resync = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(
    private readonly stageId: string,
    private readonly auth: string | null,
    private readonly publish: PublishSlot[],
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  get connection(): SfuConnection | null {
    return this.conn;
  }

  start() {
    this.stopped = false;
    void this.build();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.rebuildTimer);
    this.conn?.close();
    this.conn = null;
  }

  setLocal(key: PushKey, track: MediaStreamTrack | null) {
    this.local.set(key, track);
    void this.conn?.replace(key, track).catch(() => undefined);
  }

  want(refs: RemoteRef[]) {
    const next = new Map(refs.map((r) => [remoteKey(r), r]));
    const same =
      next.size === this.wanted.size && [...next.keys()].every((k) => this.wanted.has(k));
    if (same) return;
    this.wanted = next;
    void this.sync();
  }

  private emit(patch: Partial<SfuSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private remoteMap(): Map<string, MediaStreamTrack> {
    return new Map([...this.have].map(([k, v]) => [k, v.track]));
  }

  private async build() {
    const generation = ++this.generation;
    this.conn?.close();
    this.have.clear();
    this.emit({
      status: this.snapshot.sessionId ? "reconnecting" : "connecting",
      remote: new Map(),
    });
    const conn = new SfuConnection(this.stageId, this.auth, () => this.fail(generation));
    this.conn = conn;
    conn.pc.addEventListener("iceconnectionstatechange", () => {
      if (generation !== this.generation) return;
      const s = conn.pc.iceConnectionState;
      if (s === "connected" || s === "completed") {
        this.attempt = 0;
        this.emit({ status: "connected" });
      }
    });
    try {
      const sessionId = await conn.open();
      if (generation !== this.generation) return;
      if (this.publish.length > 0) {
        await conn.push(
          this.publish.map((slot) => ({ ...slot, track: this.local.get(slot.key) ?? null })),
        );
      }
      if (generation !== this.generation) return;
      const layered = this.publish.filter((s) => conn.simulcasting(s.key)).map((s) => s.key);
      this.emit({ sessionId, layered });
      await this.sync();
    } catch {
      this.fail(generation);
    }
  }

  private fail(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    const delay = rebuildDelay(this.attempt);
    this.attempt += 1;
    this.emit({ status: "reconnecting" });
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => void this.build(), delay);
  }

  private async sync(): Promise<void> {
    const conn = this.conn;
    if (!conn?.sessionId || this.stopped) return;
    if (this.syncing) {
      this.resync = true;
      return;
    }
    this.syncing = true;
    const generation = this.generation;
    try {
      const stale = [...this.have].filter(([k]) => !this.wanted.has(k));
      if (stale.length > 0) {
        for (const [k] of stale) this.have.delete(k);
        this.emit({ remote: this.remoteMap() });
        await conn.unpull(stale.map(([, v]) => v.mid)).catch(() => undefined);
      }
      const missing = [...this.wanted].filter(([k]) => !this.have.has(k)).map(([, r]) => r);
      if (missing.length > 0) {
        const pulled = await conn.pull(missing);
        if (generation !== this.generation) return;
        for (const p of pulled) {
          const key = remoteKey(p);
          if (this.wanted.has(key)) this.have.set(key, p);
        }
        this.emit({ remote: this.remoteMap() });
        if (pulled.length < missing.length) this.scheduleRetry();
      }
    } catch {
      this.fail(generation);
    } finally {
      this.syncing = false;
      if (this.resync) {
        this.resync = false;
        void this.sync();
      }
    }
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.sync(), RETRY_PULL_MS);
  }
}
