import { describe, expect, it, vi } from "vitest";
import { consumeOAuthTransaction } from "~/lib/db.server";

function makeDb(row: unknown) {
  const first = vi.fn().mockResolvedValue(row);
  const run = vi.fn().mockResolvedValue(undefined);
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare } as unknown as D1Database, run };
}

describe("consumeOAuthTransaction", () => {
  it("returns null for an unknown state", async () => {
    const { db } = makeDb(null);
    await expect(consumeOAuthTransaction(db, "missing")).resolves.toBeNull();
  });

  it("deletes and rejects an expired transaction", async () => {
    const { db, run } = makeDb({
      state: "state-1",
      user_id: "user-1",
      event_id: "event-1",
      code_verifier: "verifier",
      return_to: "/events/event-1",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(consumeOAuthTransaction(db, "state-1")).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns and consumes (single-use) a valid transaction", async () => {
    const { db, run } = makeDb({
      state: "state-2",
      user_id: "user-1",
      event_id: "event-1",
      code_verifier: "verifier",
      return_to: "/events/event-1",
      expires_at: Math.floor(Date.now() / 1000) + 600,
    });
    await expect(consumeOAuthTransaction(db, "state-2")).resolves.toEqual({
      state: "state-2",
      userId: "user-1",
      eventId: "event-1",
      codeVerifier: "verifier",
      returnTo: "/events/event-1",
      expiresAt: expect.any(Number),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
