import {
  CLOSE_REPLACED,
  CLOSE_TOKEN_ROTATED,
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
  onOpen?: () => void;
  onRejected?: (code: number) => void;
  onRtt?: (ms: number) => void;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
};

export function reconnectDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(2000, 500 * 2 ** (attempt - 1));
}

const FATAL_CODES = new Set([CLOSE_TOKEN_ROTATED]);
const CONNECT_TIMEOUT_MS = 4000;

export class ReliableSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPong = 0;
  private lastPingAt = 0;
  private stopped = false;
  private status: SocketStatus = "connecting";
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;

  constructor(private readonly opts: ReliableSocketOptions) {
    this.WS = opts.WebSocketImpl ?? WebSocket;
    this.now = opts.now ?? (() => Date.now());
  }

  start() {
    this.stopped = false;
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
        this.retryTimer = setTimeout(this.connect, 5000);
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {};
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
      old.close(CLOSE_REPLACED, "replaced");
    } catch {}
  }

  private forceReconnect = () => {
    this.detach();
    this.setStatus("offline");
    this.scheduleRetry();
  };

  private heartbeat = () => {
    if (this.stopped) return;
    if (this.ws?.readyState === this.WS.OPEN) {
      if (this.now() - this.lastPong > STALE_MS) {
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
    if (this.stopped || this.isOpen) return;
    this.attempt = 0;
    this.connect();
  };

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.kick();
  };
}
