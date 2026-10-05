import { describe, expect, it } from "vitest";
import { RETENTION_LIMIT, selectEvictions } from "./retention";

function seqRange(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

describe("selectEvictions", () => {
  it("evicts nothing when at or under the limit", () => {
    expect(selectEvictions(seqRange(RETENTION_LIMIT), RETENTION_LIMIT, RETENTION_LIMIT)).toEqual(
      [],
    );
    expect(selectEvictions(seqRange(10), 10, RETENTION_LIMIT)).toEqual([]);
  });

  it("evicts exactly the oldest N seqs to settle back at the limit", () => {
    // 51 entries (seq 1..51), cursor at the newest (51) — must evict seq 1.
    const seqs = seqRange(RETENTION_LIMIT + 1);
    expect(selectEvictions(seqs, RETENTION_LIMIT + 1, RETENTION_LIMIT)).toEqual([1]);
  });

  it("evicts oldest-first regardless of the input array's order", () => {
    // 53 seqs total (1..5 plus 6..53), shuffled — oldest 3 (1,2,3) must go.
    const seqs = [...seqRange(RETENTION_LIMIT - 2, 6), 5, 1, 3, 4, 2];
    const evictions = selectEvictions(seqs, 53, RETENTION_LIMIT);
    expect(evictions).toEqual([1, 2, 3]); // 53 - 50 = 3 to evict, oldest first
  });

  it("never evicts the seq the cursor points at, even if it is among the oldest", () => {
    // 51 entries, but the cursor is (unusually) parked on the oldest one.
    const seqs = seqRange(RETENTION_LIMIT + 1);
    const evictions = selectEvictions(seqs, 1, RETENTION_LIMIT);
    expect(evictions).not.toContain(1);
    // Next-oldest (2) is evicted instead so the count still settles at the limit.
    expect(evictions).toEqual([2]);
  });

  it("protects the cursor even when it is the only entry, leaving the table over cap", () => {
    // Contrived limit (0) to isolate the protection mechanism itself: with a
    // single seq that is also the cursor, there is nothing else in the
    // evictable pool to reach for — eviction must come back empty rather
    // than ever touching the cursor's row.
    expect(selectEvictions([1], 1, 0)).toEqual([]);
  });

  it("evicts nothing when cursor is null and count is at the limit", () => {
    expect(selectEvictions(seqRange(RETENTION_LIMIT), null, RETENTION_LIMIT)).toEqual([]);
  });

  it("evicts oldest-first when cursor is null and over the limit", () => {
    const seqs = seqRange(RETENTION_LIMIT + 5);
    expect(selectEvictions(seqs, null, RETENTION_LIMIT)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is order-independent on its input array", () => {
    const ordered = seqRange(RETENTION_LIMIT + 2);
    const reversed = [...ordered].reverse();
    expect(selectEvictions(reversed, RETENTION_LIMIT + 2, RETENTION_LIMIT)).toEqual(
      selectEvictions(ordered, RETENTION_LIMIT + 2, RETENTION_LIMIT),
    );
  });
});
