import { afterEach, describe, expect, it, vi } from "vitest";
import { startScreenShare } from "./media";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startScreenShare", () => {
  it("asks for the display before returning, while the click's user activation lasts", () => {
    const getDisplayMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
    vi.stubGlobal(
      "CaptureController",
      class {
        setFocusBehavior() {}
      },
    );
    void startScreenShare();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});
