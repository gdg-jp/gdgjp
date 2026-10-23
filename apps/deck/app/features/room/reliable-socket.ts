import {
  CLOSE_DELETED,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  HEARTBEAT_MS,
  PING,
  PONG,
  STALE_MS,
} from "./protocol";

export type SocketStatus = "connecting" | "open" | "offline";

export type ReliableSocketOptions = {
  url: () => string;
  onMessage: (data: string) => void;
  onStatus: (status: SocketStatus) => void;
  /** Fires on every open, including reconnects (send hello/state here). */
  onOpen?: () => void;
  /** Fires when the server refuses us for good (e.g. rotated player token). */
  onRejected?: (code: number) => void;
  onRtt?: (ms: number) => void;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
};

/** Delay before reconnect attempt `n` (0-based): instant, then 0.5s → 2s cap. */
export function reconnectDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(2000, 500 * 2 ** (attempt - 1));
}

/** Close codes after which retrying cannot help. */
/**
 * Hidden pages (a phone in the pocket, an OBS dock in a background tab) get
 * their timers throttled to about once a minute, so a missed pong there is not
 * a dead path.
 */
const HIDDEN_STALE_MS = 65_000;

function staleAfter(): number {
  return typeof document !== "undefined" && document.visibilityState === "hidden"
    ? HIDDEN_STALE_MS
    : STALE_MS;
}

const FATAL_CODES = new Set([CLOSE_REPLACED, CLOSE_REVOKED, CLOSE_DELETED]);
const CONNECT_TIMEOUT_MS = 4000;

/**
 * A WebSocket that does not give up.
 *
 * - Sends "ping" every HEARTBEAT_MS; no "pong" within STALE_MS means the path
 *   is dead even if the browser still thinks the socket is open (Wi-Fi drops
 *   often never deliver a close), so it force-closes and reconnects.
 * - Reconnects immediately, then with a short capped backoff, forever.
 * - Retries at once on `online`, `visibilitychange` → visible, and `focus`.
 */
export class ReliableSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPong = 0;
  private lastPingAt = 0;
  private stopped = false;
  /** Replaced by another tab/dock, or the deck is gone: only `start()` may connect again. */
  private givenUp = false;
  private status: SocketStatus = "connecting";
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;

  constructor(private readonly opts: ReliableSocketOptions) {
    this.WS = opts.WebSocketImpl ?? WebSocket;
    this.now = opts.now ?? (() => Date.now());
  }

  start() {
    this.stopped = false;
    this.givenUp = false;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.kick);
      window.addEventListener("focus", this.kick);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.heartbeatTimer = setInterval(this.heartbeat, HEARTBEAT_MS);
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.kick);
      window.removeEventListener("focus", this.kick);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    this.ws?.close(1000, "stop");
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.status === "open" && this.ws?.readyState === this.WS.OPEN;
  }

  /** Returns false (and sends nothing) unless the socket is verifiably alive. */
  send(data: string): boolean {
    if (!this.isOpen || !this.ws) return false;
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus(status);
  }

  private connect = () => {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    this.detach();
    if (this.status !== "open") this.setStatus(this.attempt === 0 ? "connecting" : "offline");

    let ws: WebSocket;
    try {
      ws = new this.WS(this.opts.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.connectTimer = setTimeout(() => {
      if (ws.readyState !== this.WS.OPEN) this.forceReconnect();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.lastPong = this.now();
      this.setStatus("open");
      this.opts.onOpen?.();
    };
    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data === PONG) {
        this.lastPong = this.now();
        if (this.lastPingAt) this.opts.onRtt?.(this.lastPong - this.lastPingAt);
        return;
      }
      this.opts.onMessage(data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus("offline");
      if (FATAL_CODES.has(event.code)) {
        this.opts.onRejected?.(event.code);
        // Another tab took over this participant, or the stage is gone:
        // retrying would only fight the other tab.
        if (event.code === CLOSE_REPLACED || event.code === CLOSE_DELETED) {
          this.givenUp = true;
          return;
        }
        // A reissued token stays wrong until the page is reloaded with the
        // new one, but keep trying slowly so a transient mistake heals itself.
        this.retryTimer = setTimeout(this.connect, 5000);
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
  };

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(this.connect, delay);
  }

  private detach() {
    if (!this.ws) return;
    const old = this.ws;
    this.ws = null;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try {
      old.close(4000, "replaced");
    } catch {
      // ignore
    }
  }

  private forceReconnect = () => {
    this.detach();
    this.setStatus("offline");
    this.scheduleRetry();
  };

  private heartbeat = () => {
    if (this.stopped) return;
    if (this.ws?.readyState === this.WS.OPEN) {
      if (this.now() - this.lastPong > staleAfter()) {
        this.forceReconnect();
        return;
      }
      this.lastPingAt = this.now();
      try {
        this.ws.send(PING);
      } catch {
        this.forceReconnect();
      }
    }
  };

  private kick = () => {
    if (this.stopped || this.givenUp || this.isOpen) return;
    this.attempt = 0;
    this.connect();
  };

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.kick();
  };
}
