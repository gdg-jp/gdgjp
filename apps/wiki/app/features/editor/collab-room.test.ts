import { describe, expect, it } from "vitest";
import { DEFAULT_SPACE_ID } from "~/features/spaces/shared";
import { collabRoomName } from "./collab-room";

describe("collabRoomName", () => {
  it("keeps the v1 bare-slug room for the default space", () => {
    expect(DEFAULT_SPACE_ID).toBe("gdg-jp");
    expect(collabRoomName(DEFAULT_SPACE_ID, "welcome")).toBe("welcome");
    expect(collabRoomName("gdg-jp", "meetup-2026")).toBe("meetup-2026");
  });

  it("prefixes other spaces with their id", () => {
    expect(collabRoomName("tokyo", "welcome")).toBe("tokyo/welcome");
    expect(collabRoomName("osaka", "meetup-2026")).toBe("osaka/meetup-2026");
  });
});
