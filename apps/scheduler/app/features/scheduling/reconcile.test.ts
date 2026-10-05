import { expect, it } from "vitest";
import { reconcileSlotKeys } from "./reconcile";
it("keeps unchanged slots, removes missing slots and inserts only new times", () => {
  expect(
    reconcileSlotKeys(
      [
        { dayOfWeek: 0, startTime: "09:00" },
        { dayOfWeek: 0, startTime: "10:00" },
      ],
      [
        { dayOfWeek: 0, startTime: "10:00" },
        { dayOfWeek: 1, startTime: "09:00" },
      ],
    ),
  ).toEqual({ keep: ["0-10:00"], remove: ["0-09:00"], insert: ["1-09:00"] });
});
