import { describe, expect, it } from "vitest";
import { hashColorHex, hashColorTw } from "./color-utils";

describe("collaboration presence colors", () => {
  it("uses matching shared GDG accents for avatars and cursors", () => {
    const avatarClass = hashColorTw("member-42");
    const cursorColor = hashColorHex("member-42");
    const token = avatarClass.replace("bg-gdg-", "");

    expect(cursorColor).toBe(`var(--gdg-${token})`);
  });

  it("is deterministic and assigns only declared GDG accents", () => {
    expect(hashColorTw("member-42")).toBe(hashColorTw("member-42"));
    expect(hashColorHex("member-42")).toBe(hashColorHex("member-42"));
    expect(hashColorTw("member-42")).toMatch(/^bg-gdg-(red|yellow|green|blue)$/);
  });
});
