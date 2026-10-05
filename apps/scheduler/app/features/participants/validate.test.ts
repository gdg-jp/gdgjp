import { describe, expect, it } from "vitest";
import { parseSlotIds } from "./validate";
function makeForm(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("parseSlotIds", () => {
  it("returns unique positive ints", () => {
    const fd = makeForm([
      ["slot_id", "1"],
      ["slot_id", "2"],
      ["slot_id", "2"],
      ["slot_id", "abc"],
      ["slot_id", "0"],
      ["slot_id", "-5"],
    ]);
    expect(parseSlotIds(fd).sort()).toEqual([1, 2]);
  });
});
