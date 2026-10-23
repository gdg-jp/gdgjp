import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_REPLACED, PONG, STALE_MS } from "./protocol";
import { ReliableSocket, reconnectDelay } from "./reliable-socket";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function make() {
  const statuses: string[] = [];
  const socket = new ReliableSocket({
    url: () => "ws://x/ws",
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  });
  return { socket, statuses };
}

describe("reconnectDelay", () => {
  it("retries instantly first, then backs off to a 2s cap", () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([0, 500, 1000, 2000, 2000, 2000]);
  });
});

describe("ReliableSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it("reconnects immediately after an unexpected close", () => {
    const { socket, statuses } = make();
    socket.start();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop();
    expect(statuses.at(-1)).toBe("offline");
    vi.advanceTimersByTime(0);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].open();
    expect(statuses.at(-1)).toBe("open");
    socket.stop();
  });

  it("does not take the connection back after being replaced, even on focus", () => {
    const { socket } = make();
    socket.start();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(CLOSE_REPLACED);
    (socket as unknown as { kick: () => void }).kick();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    socket.stop();
  });

  it("treats a socket without pongs as dead and replaces it", () => {
    const { socket, statuses } = make();
    socket.start();
    FakeSocket.instances[0].open();
    vi.advanceTimersByTime(STALE_MS + 1100);
    expect(statuses.at(-1)).toBe("offline");
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2);
    socket.stop();
  });

  it("stays open while pongs arrive", () => {
    const { socket, statuses } = make();
    socket.start();
    const ws = FakeSocket.instances[0];
    ws.open();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      ws.onmessage?.({ data: PONG });
    }
    expect(statuses.at(-1)).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
    socket.stop();
  });

  it("refuses to send while not open", () => {
    const { socket } = make();
    socket.start();
    expect(socket.send("x")).toBe(false);
    FakeSocket.instances[0].open();
    expect(socket.send("x")).toBe(true);
    socket.stop();
  });
});
