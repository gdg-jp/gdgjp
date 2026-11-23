import type { Clip } from "~/features/clips/catalog";
import type { CommandResult } from "./ack-tracker";
import {
  type Command,
  type LogEntry,
  type LoopSetting,
  type PlayerDiagnostics,
  type PlayerState,
  type PlayerStatus,
  type RoomConfig,
  defaultLoop,
} from "./protocol";

const ADVANCE_TIMEOUT_MS = 1200;
const METADATA_TIMEOUT_MS = 3000;
const STALL_MS = 1000;

type Listener = () => void;

export class PlayerEngine {
  private audio: HTMLAudioElement;
  private clips: Clip[] = [];
  private byId = new Map<string, Clip>();
  private blobs = new Map<string, string>();
  private failed = new Set<string>();
  private preloading = false;
  private lastClip: Clip | null = null;
  private clipId: string | null = null;
  private status: PlayerStatus = "idle";
  private loops: RoomConfig["loops"] = {};
  private gapEndsAt = 0;
  private gapTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTime = -1;
  private lastAdvanceAt = 0;
  private listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();

  diag: PlayerDiagnostics;

  constructor(
    clips: Clip[],
    private readonly onLog: (entry: Omit<LogEntry, "at">) => void,
  ) {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.diag = {
      preload: { loaded: 0, total: clips.length, failed: [] },
      autoplay: "unknown",
      muted: false,
      volume: 1,
      visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
      stalled: false,
      lastError: null,
      userAgent: navigator.userAgent,
    };
    this.audio.addEventListener("ended", this.onEnded);
    this.audio.addEventListener("error", this.onMediaError);
    this.audio.addEventListener("volumechange", this.onVolume);
    this.audio.addEventListener("pause", this.onExternalPause);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.watchdog = setInterval(this.watch, 250);
    this.setClips(clips);
  }

  private getClip(id: string | null): Clip | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  setClips(clips: Clip[]) {
    this.clips = clips;
    this.byId = new Map(clips.map((c) => [c.id, c]));
    if (this.lastClip && this.lastClip.id === this.clipId && !this.byId.has(this.clipId)) {
      this.byId.set(this.clipId, this.lastClip);
    }
    for (const [id, url] of this.blobs) {
      if (!this.byId.has(id)) {
        URL.revokeObjectURL(url);
        this.blobs.delete(id);
      }
    }
    for (const id of this.failed) if (!this.byId.has(id)) this.failed.delete(id);
    this.recount();
    void this.preload();
  }

  private recount() {
    this.diag.preload = {
      loaded: this.clips.filter((c) => this.blobs.has(c.id)).length,
      total: this.clips.length,
      failed: this.clips.filter((c) => this.failed.has(c.id)).map((c) => c.id),
    };
    this.emit();
  }

  destroy() {
    clearInterval(this.watchdog);
    clearTimeout(this.gapTimer);
    this.audio.pause();
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const url of this.blobs.values()) URL.revokeObjectURL(url);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setConfig(config: RoomConfig) {
    this.loops = config.loops;
  }

  probeAutoplay() {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.diag.autoplay = ctx.state === "running" ? "ok" : "blocked";
      void ctx.close();
    } catch {
      this.diag.autoplay = "unknown";
    }
    if (this.diag.autoplay === "blocked") {
      this.onLog({ level: "error", code: "autoplay-blocked" });
    }
    this.emit();
  }

  unlock() {
    this.diag.autoplay = "ok";
    this.onLog({ level: "info", code: "autoplay-unlocked" });
    this.emit();
  }

  async preload() {
    if (this.preloading) return;
    this.preloading = true;
    try {
      for (;;) {
        const clip = this.clips.find((c) => !this.blobs.has(c.id) && !this.failed.has(c.id));
        if (!clip) return;
        try {
          const res = await fetch(clip.src, { cache: "force-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const url = URL.createObjectURL(await res.blob());
          await verifyDecodable(url);
          if (this.byId.has(clip.id)) this.blobs.set(clip.id, url);
          else URL.revokeObjectURL(url);
        } catch (err) {
          this.failed.add(clip.id);
          this.onLog({
            level: "error",
            code: "preload-failed",
            detail: `${clip.id} ${errText(err)}`,
          });
        }
        this.recount();
      }
    } finally {
      this.preloading = false;
    }
  }

  get state(): PlayerState {
    const clip = this.getClip(this.clipId);
    const durationMs = clip?.durationMs ?? 0;
    const positionMs =
      this.status === "ended" || this.status === "gap"
        ? durationMs
        : Math.min(durationMs, Math.round(this.audio.currentTime * 1000));
    return {
      clipId: this.clipId,
      status: this.status,
      positionMs: clip ? positionMs : 0,
      durationMs,
      gapRemainingMs: this.status === "gap" ? Math.max(0, this.gapEndsAt - Date.now()) : 0,
      diag: { ...this.diag, preload: { ...this.diag.preload } },
    };
  }

  private loopFor(clipId: string): LoopSetting {
    return this.loops[clipId] ?? defaultLoop(this.getClip(clipId)?.loop ?? false);
  }

  execute(cmd: Command): Promise<CommandResult> {
    const run = this.queue.then(() => this.run(cmd));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(cmd: Command): Promise<CommandResult> {
    try {
      switch (cmd.kind) {
        case "play":
          return await this.playFrom(cmd.clipId, cmd.fromMs);
        case "pause":
          return this.pause();
        case "resume":
          if (!this.clipId) return { ok: false, reason: "invalid", detail: "nothing loaded" };
          if (this.status === "playing" || this.status === "gap") return { ok: true };
          return await this.playFrom(
            this.clipId,
            this.status === "ended" ? 0 : this.audio.currentTime * 1000,
          );
        case "restart":
          if (!this.clipId) return { ok: false, reason: "invalid", detail: "nothing loaded" };
          return await this.playFrom(this.clipId, 0);
        case "seek":
          return await this.seek(cmd.ms);
      }
    } catch (err) {
      this.diag.lastError = errText(err);
      return { ok: false, reason: "media-error", detail: errText(err) };
    } finally {
      this.emit();
    }
  }

  private async playFrom(clipId: string, fromMs: number): Promise<CommandResult> {
    const clip = this.getClip(clipId);
    if (!clip) return { ok: false, reason: "unknown-clip" };
    this.clearGap();
    if (this.status === "gap") this.status = "ended";
    await this.load(clip);
    this.audio.currentTime = Math.min(fromMs, clip.durationMs - 50) / 1000;
    try {
      await this.audio.play();
    } catch (err) {
      this.status = this.clipId ? "paused" : "idle";
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        this.diag.autoplay = "blocked";
        this.onLog({ level: "error", code: "autoplay-blocked" });
        return { ok: false, reason: "autoplay-blocked" };
      }
      this.diag.lastError = errText(err);
      return { ok: false, reason: "media-error", detail: errText(err) };
    }
    this.status = "playing";
    this.diag.autoplay = "ok";
    this.markAdvance();
    if (!(await this.waitForAdvance())) {
      this.diag.stalled = true;
      return { ok: false, reason: "not-advancing" };
    }
    return { ok: true };
  }

  private pause(): CommandResult {
    if (this.status === "gap") {
      this.clearGap();
      this.status = "ended";
      return { ok: true };
    }
    if (this.status === "playing") {
      this.status = "paused";
      this.audio.pause();
    }
    return { ok: true };
  }

  private async seek(ms: number): Promise<CommandResult> {
    const clip = this.getClip(this.clipId);
    if (!clip) return { ok: false, reason: "invalid", detail: "nothing loaded" };
    if (this.status === "gap" || this.status === "ended") {
      this.clearGap();
      this.status = "paused";
    }
    const target = Math.min(Math.max(0, ms), clip.durationMs - 50) / 1000;
    const seeked = once(this.audio, "seeked", 1000);
    this.audio.currentTime = target;
    await seeked;
    if (this.status === "playing") {
      this.markAdvance();
      if (!(await this.waitForAdvance())) return { ok: false, reason: "not-advancing" };
    }
    return { ok: true };
  }

  private async load(clip: Clip) {
    const src = this.blobs.get(clip.id) ?? clip.src;
    if (this.clipId === clip.id && this.audio.src === src && this.audio.readyState >= 1) return;
    if (this.status === "playing") this.status = "paused";
    this.audio.pause();
    this.clipId = clip.id;
    this.lastClip = clip;
    this.audio.src = src;
    if (!this.blobs.has(clip.id)) {
      this.onLog({ level: "warn", code: "network-fallback", detail: clip.id });
    }
    await once(this.audio, "loadedmetadata", METADATA_TIMEOUT_MS);
  }

  private waitForAdvance(): Promise<boolean> {
    const start = this.audio.currentTime;
    const deadline = performance.now() + ADVANCE_TIMEOUT_MS;
    return new Promise((resolve) => {
      const tick = () => {
        if (this.audio.currentTime > start + 0.005 || this.audio.ended) return resolve(true);
        if (this.status !== "playing") return resolve(false);
        if (performance.now() > deadline) return resolve(false);
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  private clearGap() {
    clearTimeout(this.gapTimer);
    this.gapTimer = undefined;
  }

  private onEnded = () => {
    const clipId = this.clipId;
    if (!clipId) return;
    const loop = this.loopFor(clipId);
    if (!loop.enabled) {
      this.status = "ended";
      this.emit();
      return;
    }
    const restart = () => {
      void this.execute({ kind: "play", clipId, fromMs: 0 }).then((r) => {
        if (!r.ok) this.onLog({ level: "error", code: "loop-restart-failed", detail: r.reason });
      });
    };
    if (loop.gapSec <= 0) {
      restart();
      return;
    }
    this.status = "gap";
    this.gapEndsAt = Date.now() + loop.gapSec * 1000;
    this.gapTimer = setTimeout(() => {
      if (this.status === "gap" && this.clipId === clipId) restart();
    }, loop.gapSec * 1000);
    this.emit();
  };

  private onMediaError = () => {
    const err = this.audio.error;
    this.diag.lastError = err
      ? `MediaError ${err.code}${err.message ? `: ${err.message}` : ""}`
      : "MediaError";
    this.onLog({ level: "error", code: "media-error", detail: this.diag.lastError });
    this.emit();
  };

  private onVolume = () => {
    this.diag.muted = this.audio.muted;
    this.diag.volume = this.audio.volume;
    if (this.audio.muted || this.audio.volume === 0) {
      this.onLog({ level: "error", code: "muted" });
    }
    this.emit();
  };

  private onExternalPause = () => {
    if (this.status === "playing" && !this.audio.ended) {
      this.status = "paused";
      this.onLog({ level: "error", code: "interrupted" });
      this.emit();
    }
  };

  private onVisibility = () => {
    this.diag.visibility = document.visibilityState === "hidden" ? "hidden" : "visible";
    if (this.diag.visibility === "hidden") this.onLog({ level: "warn", code: "hidden" });
    this.emit();
  };

  private markAdvance() {
    this.lastTime = this.audio.currentTime;
    this.lastAdvanceAt = performance.now();
  }

  private watch = () => {
    if (this.status !== "playing") {
      if (this.diag.stalled) {
        this.diag.stalled = false;
        this.emit();
      }
      return;
    }
    const t = this.audio.currentTime;
    const now = performance.now();
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.lastAdvanceAt = now;
      if (this.diag.stalled) {
        this.diag.stalled = false;
        this.emit();
      }
    } else if (!this.diag.stalled && now - this.lastAdvanceAt > STALL_MS) {
      this.diag.stalled = true;
      this.onLog({ level: "error", code: "stalled", detail: this.clipId ?? "" });
      this.emit();
    }
  };
}

function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener(event, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    target.addEventListener(event, done, { once: true });
  });
}

function verifyDecodable(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    probe.preload = "metadata";
    const timer = setTimeout(() => reject(new Error("decode timeout")), 8000);
    probe.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(timer);
        probe.removeAttribute("src");
        resolve();
      },
      { once: true },
    );
    probe.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error(`MediaError ${probe.error?.code ?? "?"}`));
      },
      { once: true },
    );
    probe.src = url;
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
