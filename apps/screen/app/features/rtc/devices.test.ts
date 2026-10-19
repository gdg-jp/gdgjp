import { describe, expect, it } from "vitest";
import { deviceOptions, selectedDevice } from "./devices";

const chrome = [
  { deviceId: "default", groupId: "g2", label: "既定 - BlackHole 2ch (Virtual)" },
  { deviceId: "communications", groupId: "g2", label: "通信 - BlackHole 2ch (Virtual)" },
  { deviceId: "mac", groupId: "g1", label: "MacBook Pro Microphone (Built-in)" },
  { deviceId: "bh", groupId: "g2", label: "BlackHole 2ch (Virtual)" },
];

describe("deviceOptions", () => {
  it("drops Chrome's pseudo devices and marks the OS default by group", () => {
    expect(deviceOptions(chrome, "Mic")).toEqual([
      { deviceId: "mac", label: "MacBook Pro Microphone (Built-in)", isDefault: false },
      { deviceId: "bh", label: "BlackHole 2ch (Virtual)", isDefault: true },
    ]);
  });

  it("treats the first device as default without a pseudo entry and labels unnamed ones", () => {
    const opts = deviceOptions(
      [
        { deviceId: "a", groupId: "x", label: "" },
        { deviceId: "b", groupId: "y", label: "Cam B" },
      ],
      "Camera",
    );
    expect(opts.map((o) => [o.label, o.isDefault])).toEqual([
      ["Camera 1", true],
      ["Cam B", false],
    ]);
  });
});

describe("selectedDevice", () => {
  const opts = deviceOptions(chrome, "Mic");
  it("prefers the explicit choice, then the live track, then the OS default", () => {
    expect(selectedDevice(opts, "mac", "bh")).toBe("mac");
    expect(selectedDevice(opts, "", "mac")).toBe("mac");
    expect(selectedDevice(opts, "gone", undefined)).toBe("bh");
    expect(selectedDevice([], "", undefined)).toBe("");
  });
});
