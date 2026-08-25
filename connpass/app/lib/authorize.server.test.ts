import type { BearerIdentity } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import { canReadGroup, canWriteGroup, resolveGroupSlug } from "./authorize.server";

const organizer: BearerIdentity = {
  user: { id: "u1", email: "a@b.c", name: "A", image: null, isAdmin: false },
  chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "organizer" }],
};

const member: BearerIdentity = {
  user: { id: "u2", email: "m@b.c", name: "M", image: null, isAdmin: false },
  chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "member" }],
};

const admin: BearerIdentity = {
  user: { id: "u3", email: "admin@b.c", name: "Admin", image: null, isAdmin: true },
  chapters: [],
};

const group = {
  groupSlug: "gdg-tokyo",
  groupId: 1,
  chapterId: "10",
  enabled: true,
};

describe("authorize", () => {
  it("normalizes group slug", () => {
    expect(resolveGroupSlug("GDG-Tokyo")).toBe("gdg-tokyo");
  });

  it("allows organizers to write and members to read", () => {
    expect(canWriteGroup(organizer, group)).toBe(true);
    expect(canReadGroup(member, group)).toBe(true);
    expect(canWriteGroup(member, group)).toBe(false);
  });

  it("allows platform admins", () => {
    expect(canWriteGroup(admin, group)).toBe(true);
    expect(canReadGroup(admin, group)).toBe(true);
  });
});
