import { describe, expect, it, vi } from "vitest";
import { D1_MAX_BOUND_PARAMETERS, mapInChunks } from "./d1-chunk.server";

describe("mapInChunks", () => {
  it("returns [] without calling fetchChunk for empty input", async () => {
    const fetchChunk = vi.fn(async () => ["x"]);
    await expect(mapInChunks([], fetchChunk)).resolves.toEqual([]);
    expect(fetchChunk).not.toHaveBeenCalled();
  });

  it("keeps each chunk at or under D1's bound-parameter limit", async () => {
    const values = Array.from({ length: D1_MAX_BOUND_PARAMETERS + 1 }, (_, i) => i);
    const sizes: number[] = [];
    const rows = await mapInChunks(values, async (chunk) => {
      sizes.push(chunk.length);
      expect(chunk.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
      return chunk.map((n) => n * 2);
    });
    expect(sizes).toEqual([D1_MAX_BOUND_PARAMETERS, 1]);
    expect(rows).toEqual(values.map((n) => n * 2));
  });
});
