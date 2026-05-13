import { describe, expect, it } from "vitest";
import { isEventId, newEventId } from "./id";

describe("newEventId / isEventId", () => {
  it("generates a valid event id", () => {
    const id = newEventId();
    expect(id).toMatch(/^evt_/);
    expect(isEventId(id)).toBe(true);
  });
  it("generates unique ids", () => {
    const a = newEventId();
    const b = newEventId();
    expect(a).not.toBe(b);
  });
  it("rejects invalid ids", () => {
    expect(isEventId("link_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
    expect(isEventId("evt_short")).toBe(false);
    expect(isEventId("")).toBe(false);
  });
});
