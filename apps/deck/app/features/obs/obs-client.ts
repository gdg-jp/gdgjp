/**
 * Minimal obs-websocket v5 client for the browser (the OBS custom dock).
 *
 * Hello → Identify (with the SHA-256 challenge when a password is set) →
 * Identified; then requests (op 6/7), request batches (op 8/9) and events
 * (op 5). Reconnects forever while started.
 */

export const OBS_DEFAULT_URL = "ws://127.0.0.1:4455";

/** General … Ui (every non-high-volume category). */
const EVENT_SUBSCRIPTIONS = (1 << 11) - 1;

const OP = {
  hello: 0,
  identify: 1,
  identified: 2,
  event: 5,
  request: 6,
  requestResponse: 7,
  requestBatch: 8,
  requestBatchResponse: 9,
} as const;

export type ObsStatus = "connecting" | "open" | "offline" | "auth-failed";

export type RequestStatus = { result: boolean; code: number; comment?: string };

export type BatchResult = {
  requestType: string;
  requestStatus: RequestStatus;
  responseData?: Record<string, unknown>;
};

export class ObsRequestError extends Error {
  constructor(
    readonly requestType: string,
    readonly status: RequestStatus,
  ) {
    super(
      status.comment
        ? `${requestType}: ${status.comment}`
        : `${requestType} failed (${status.code})`,
    );
  }
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** obs-websocket's auth string: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export async function obsAuth(password: string, salt: string, challenge: string): Promise<string> {
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export type ObsClientOptions = {
  url: () => string;
  password: () => string;
  onStatus: (status: ObsStatus, detail?: string) => void;
  onIdentified: (hello: { obsWebSocketVersion?: string }) => void;
  onEvent: (type: string, data: Record<string, unknown>) => void;
  WebSocketImpl?: typeof WebSocket;
};

const REQUEST_TIMEOUT_MS = 10_000;

export class ObsClient {
  private ws: WebSocket | null = null;
  private stopped = true;
  private identified = false;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private readonly WS: typeof WebSocket;

  constructor(private readonly opts: ObsClientOptions) {
    this.WS = opts.WebSocketImpl ?? WebSocket;
  }

  get isReady(): boolean {
    return this.identified && this.ws?.readyState === this.WS.OPEN;
  }

  start() {
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.teardown("stopped");
  }

  /** Reconnect now (password or address changed). */
  restart() {
    clearTimeout(this.retryTimer);
    this.teardown("restart");
    this.attempt = 0;
    if (!this.stopped) this.connect();
  }

  request<T = Record<string, unknown>>(
    requestType: string,
    requestData?: Record<string, unknown>,
  ): Promise<T> {
    return this.call(OP.request, { requestType, requestData }) as Promise<T>;
  }

  /** Runs requests in one round trip; failures do not stop the rest. */
  batch(
    requests: { requestType: string; requestData?: Record<string, unknown> }[],
  ): Promise<BatchResult[]> {
    if (requests.length === 0) return Promise.resolve([]);
    return this.call(OP.requestBatch, { haltOnFailure: false, requests }) as Promise<BatchResult[]>;
  }

  private call(op: number, d: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!ws || !this.isReady) return Promise.reject(new Error("OBS に接続していません"));
    const requestId = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("OBS が応答しません"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ op, d: { ...d, requestId } }));
    });
  }

  private connect() {
    if (this.stopped) return;
    this.opts.onStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new this.WS(this.opts.url());
    } catch (e) {
      this.opts.onStatus("offline", e instanceof Error ? e.message : String(e));
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (event) => {
      if (this.ws !== ws || typeof event.data !== "string") return;
      void this.onMessage(ws, event.data);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.identified = false;
      this.failPending("OBS との接続が切れました");
      // 4009 = authentication failed: retrying with the same password cannot help.
      if (event.code === 4009) {
        this.opts.onStatus("auth-failed", "パスワードが違います");
        return;
      }
      this.opts.onStatus("offline", event.reason || undefined);
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows.
    };
  }

  private async onMessage(ws: WebSocket, raw: string) {
    let msg: { op: number; d: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const d = msg.d ?? {};
    switch (msg.op) {
      case OP.hello: {
        const auth = d.authentication as { challenge: string; salt: string } | undefined;
        const identify: Record<string, unknown> = {
          rpcVersion: 1,
          eventSubscriptions: EVENT_SUBSCRIPTIONS,
        };
        if (auth) {
          identify.authentication = await obsAuth(this.opts.password(), auth.salt, auth.challenge);
        }
        if (this.ws === ws) ws.send(JSON.stringify({ op: OP.identify, d: identify }));
        this.helloData = d;
        return;
      }
      case OP.identified:
        this.identified = true;
        this.attempt = 0;
        this.opts.onStatus("open");
        this.opts.onIdentified(this.helloData as { obsWebSocketVersion?: string });
        return;
      case OP.event:
        this.opts.onEvent(String(d.eventType), (d.eventData as Record<string, unknown>) ?? {});
        return;
      case OP.requestResponse: {
        const p = this.pending.get(String(d.requestId));
        if (!p) return;
        this.pending.delete(String(d.requestId));
        const status = d.requestStatus as RequestStatus;
        if (status?.result) p.resolve((d.responseData as Record<string, unknown>) ?? {});
        else
          p.reject(
            new ObsRequestError(String(d.requestType), status ?? { result: false, code: 0 }),
          );
        return;
      }
      case OP.requestBatchResponse: {
        const p = this.pending.get(String(d.requestId));
        if (!p) return;
        this.pending.delete(String(d.requestId));
        p.resolve((d.results as BatchResult[]) ?? []);
        return;
      }
    }
  }

  private helloData: Record<string, unknown> = {};

  private failPending(reason: string) {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }

  private teardown(reason: string) {
    const ws = this.ws;
    this.ws = null;
    this.identified = false;
    this.failPending("OBS との接続が切れました");
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, reason);
      } catch {
        // ignore
      }
    }
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(5000, 500 * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
