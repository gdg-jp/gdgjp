import { describe, expect, it } from "vitest";
import { hashColorHex, hashColorTw } from "./color-utils";

describe("collaboration presence colors", () => {
  it("uses matching semantic tokens for avatars and cursors", () => {
    const avatarClass = hashColorTw("member-42");
    const cursorColor = hashColorHex("member-42");
    const token = avatarClass.replace("bg-presence-", "");

    expect(cursorColor).toBe(`var(--color-presence-${token})`);
  });

  it("is deterministic and assigns only declared presence tokens", () => {
    expect(hashColorTw("member-42")).toBe(hashColorTw("member-42"));
    expect(hashColorHex("member-42")).toBe(hashColorHex("member-42"));
    expect(hashColorTw("member-42")).toMatch(
      /^bg-presence-(rose|amber|emerald|cyan|violet|pink|teal|indigo)$/,
    );
  });
});
