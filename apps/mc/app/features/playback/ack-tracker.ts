import { ACK_TIMEOUT_MS, type FailureReason } from "./protocol";

export type CommandResult = { ok: true } | { ok: false; reason: FailureReason; detail?: string };

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export class AckTracker {
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: unknown }>();

  constructor(
    private readonly timeoutMs = ACK_TIMEOUT_MS,
    private readonly timers: Timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  ) {}

  track(id: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => {
        this.settle(id, { ok: false, reason: "timeout" });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  settle(id: string, result: CommandResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.timers.clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  failAll(reason: FailureReason) {
    for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, reason });
  }

  get size(): number {
    return this.pending.size;
  }
}
