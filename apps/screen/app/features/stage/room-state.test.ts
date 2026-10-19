import { describe, expect, it } from "vitest";
import type { ClientMessage, StageMeta } from "./protocol";
import {
  type RoomData,
  type Sender,
  applyMessage,
  connectPeer,
  disconnectPeer,
  emptyRoom,
  operatorView,
  outputView,
  speakerView,
  summarize,
  timerRemaining,
} from "./room-state";

const meta: StageMeta = { id: "apple-banana-orange", name: "Main", slotCount: 2 };
const op: Sender = { id: "op-1", role: "operator", name: "Ops" };
const alice: Sender = { id: "sp-alice", role: "speaker", name: "Alice" };
const bob: Sender = { id: "sp-bob", role: "speaker", name: "Bob" };

let seq = 0;
const id = () => `m${++seq}`;

function room(): RoomData {
  let data = emptyRoom();
  data = connectPeer(data, op, 1);
  data = connectPeer(data, alice, 2);
  data = connectPeer(data, bob, 3);
  return data;
}

function apply(data: RoomData, sender: Sender, msg: ClientMessage, now = 10) {
  return applyMessage(data, meta, sender, msg, now, id);
}

describe("slot assignment", () => {
  it("lets operators assign speakers, one slot per speaker", () => {
    let data = apply(room(), op, { type: "assign", slot: "A", participantId: alice.id }).data;
    expect(data.slots.A).toBe(alice.id);
    data = apply(data, op, { type: "assign", slot: "B", participantId: alice.id }).data;
    expect(data.slots).toEqual({ A: null, B: alice.id });
  });

  it("refuses speakers, unknown peers and slots beyond the stage's count", () => {
    const data = room();
    expect(apply(data, alice, { type: "assign", slot: "A", participantId: alice.id }).changed).toBe(
      false,
    );
    expect(apply(data, op, { type: "assign", slot: "A", participantId: "nobody" }).changed).toBe(
      false,
    );
    expect(apply(data, op, { type: "assign", slot: "C", participantId: alice.id }).changed).toBe(
      false,
    );
    expect(apply(data, op, { type: "assign", slot: "A", participantId: op.id }).changed).toBe(
      false,
    );
  });

  it("keeps a disconnected speaker in its slot so a reload lands back on air", () => {
    let data = apply(room(), op, { type: "assign", slot: "A", participantId: alice.id }).data;
    data = disconnectPeer(data, alice.id, 20);
    expect(data.slots.A).toBe(alice.id);
    expect(data.peers[alice.id]?.online).toBe(false);
    data = connectPeer(data, alice, 30);
    expect(data.peers[alice.id]?.online).toBe(true);
    expect(outputView(data, "A", 31).peer?.id).toBe(alice.id);
  });

  it("forgets operators on disconnect", () => {
    const data = disconnectPeer(room(), op.id, 20);
    expect(data.peers[op.id]).toBeUndefined();
  });
});

describe("timer", () => {
  it("accumulates across pauses and goes negative when overrun", () => {
    let data = apply(room(), op, { type: "timer", action: "reset", durationMs: 60_000 }).data;
    data = apply(data, op, { type: "timer", action: "start" }, 1000).data;
    expect(timerRemaining(data.timer, 31_000)).toBe(30_000);
    data = apply(data, op, { type: "timer", action: "pause" }, 31_000).data;
    expect(timerRemaining(data.timer, 99_000)).toBe(30_000);
    data = apply(data, op, { type: "timer", action: "start" }, 100_000).data;
    expect(timerRemaining(data.timer, 140_000)).toBe(-10_000);
  });

  it("is operator-only", () => {
    expect(apply(room(), alice, { type: "timer", action: "start" }).changed).toBe(false);
  });
});

describe("messages", () => {
  it("routes operator cues to one speaker or everyone and speaker chat to operators", () => {
    let data = room();
    data = apply(data, op, { type: "message", kind: "cue", to: alice.id, text: "5 min" }).data;
    data = apply(data, op, { type: "message", kind: "chat", to: null, text: "hello all" }).data;
    data = apply(data, bob, { type: "message", kind: "cue", to: alice.id, text: "from bob" }).data;

    const fromBob = data.messages.at(-1);
    expect(fromBob).toMatchObject({ kind: "chat", to: null });

    const aliceSees = speakerView(data, meta, alice.id, 0).messages.map((m) => m.text);
    expect(aliceSees).toEqual(["5 min", "hello all"]);
    const bobSees = speakerView(data, meta, bob.id, 0).messages.map((m) => m.text);
    expect(bobSees).toEqual(["hello all", "from bob"]);
    expect(operatorView(data, meta, op.id, 0).messages).toHaveLength(3);
  });

  it("drops empty text and trims long text", () => {
    expect(apply(room(), op, { type: "message", kind: "chat", to: null, text: "  " }).changed).toBe(
      false,
    );
    const long = apply(room(), op, {
      type: "message",
      kind: "chat",
      to: null,
      text: "x".repeat(900),
    });
    expect(long.data.messages[0]?.text).toHaveLength(500);
  });
});

describe("self reports", () => {
  it("accepts only known, well-typed fields", () => {
    const res = apply(room(), alice, {
      type: "self",
      report: {
        sfuSessionId: "abc",
        mic: true,
        quality: "bogus" as never,
        tracks: { mic: "mic", camera: 5 as never, screen: null, screenAudio: null },
      },
    });
    const peer = res.data.peers[alice.id];
    expect(peer?.sfuSessionId).toBe("abc");
    expect(peer?.mic).toBe(true);
    expect(peer?.quality).toBeNull();
    expect(peer?.tracks).toEqual({ mic: "mic", camera: null, screen: null, screenAudio: null });
  });

  it("reports no change when nothing changed", () => {
    const once = apply(room(), alice, { type: "self", report: { mic: true } }).data;
    expect(apply(once, alice, { type: "self", report: { mic: true } }).changed).toBe(false);
  });
});

describe("reset and remove", () => {
  it("reset clears history, slots, on-air, timer and offline speakers but keeps live peers", () => {
    let data = apply(room(), op, { type: "assign", slot: "A", participantId: alice.id }).data;
    data = apply(data, op, { type: "onAir", value: true }).data;
    data = apply(data, op, { type: "message", kind: "cue", to: null, text: "hi" }).data;
    data = disconnectPeer(data, bob.id, 50);
    data = apply(data, op, { type: "reset" }).data;
    expect(data.slots).toEqual({});
    expect(data.onAir).toBe(false);
    expect(data.messages).toEqual([]);
    expect(Object.keys(data.peers).sort()).toEqual([op.id, alice.id].sort());
  });

  it("removes only offline speakers and frees their slot", () => {
    let data = apply(room(), op, { type: "assign", slot: "B", participantId: bob.id }).data;
    expect(apply(data, op, { type: "remove", participantId: bob.id }).changed).toBe(false);
    data = disconnectPeer(data, bob.id, 50);
    data = apply(data, op, { type: "remove", participantId: bob.id }).data;
    expect(data.peers[bob.id]).toBeUndefined();
    expect(data.slots.B).toBeNull();
  });
});

describe("views", () => {
  it("speakers see their own slot and on-air flag but not other speakers", () => {
    let data = apply(room(), op, { type: "assign", slot: "B", participantId: alice.id }).data;
    data = apply(data, op, { type: "onAir", value: true }).data;
    const view = speakerView(data, meta, alice.id, 0);
    expect(view.slot).toBe("B");
    expect(view.onAir).toBe(true);
    expect(view.operators.map((p) => p.id)).toEqual([op.id]);
    expect(speakerView(data, meta, bob.id, 0).slot).toBeNull();
    expect("speakers" in view).toBe(false);
  });

  it("summarizes live outputs and online speakers", () => {
    let data = apply(room(), op, { type: "assign", slot: "A", participantId: alice.id }).data;
    data = apply(data, op, { type: "assign", slot: "B", participantId: bob.id }).data;
    data = disconnectPeer(data, bob.id, 50);
    expect(summarize(data, meta)).toEqual({ onAir: false, outputs: 1, participants: 1 });
  });
});
