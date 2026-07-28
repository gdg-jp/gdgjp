import { describe, expect, it } from "vitest";
import { nextGooglePhotosPollState } from "./google-photos-polling";

describe("nextGooglePhotosPollState", () => {
  it("advances after six unchanged polls", () => {
    let state = { intervalMinutes: 5, unchangedPollCount: 0 };
    for (let index = 0; index < 6; index += 1) state = nextGooglePhotosPollState(state, false);
    expect(state).toEqual({ intervalMinutes: 10, unchangedPollCount: 0 });
  });

  it("resets immediately when media changes", () => {
    expect(
      nextGooglePhotosPollState({ intervalMinutes: 720, unchangedPollCount: 3 }, true),
    ).toEqual({
      intervalMinutes: 5,
      unchangedPollCount: 0,
    });
  });
});
