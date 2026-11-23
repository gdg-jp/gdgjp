import type { BearerClient, BearerIdentity } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import {
  canReadGroup,
  canWriteAnyGroup,
  canWriteGroup,
  requireAdmin,
  resolveGroupSlug,
  withWriteAuthority,
} from "./authorize.server";

const FIRST_PARTY: BearerClient = { id: "pr", firstParty: true };
const DEVELOPER_APP: BearerClient = { id: "dev-app", firstParty: false };
const CHECKIN_APP: BearerClient = { id: "qr-checkin", firstParty: false };

const organizerBase: Omit<BearerIdentity, "client"> = {
  user: { id: "u1", email: "a@b.c", name: "A", image: null, isAdmin: false },
  chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "organizer" }],
};

const memberBase: Omit<BearerIdentity, "client"> = {
  user: { id: "u2", email: "m@b.c", name: "M", image: null, isAdmin: false },
  chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "member" }],
};

const adminBase: Omit<BearerIdentity, "client"> = {
  user: { id: "u3", email: "admin@b.c", name: "Admin", image: null, isAdmin: true },
  chapters: [],
};

const via = (
  base: Omit<BearerIdentity, "client">,
  client: BearerClient | null,
  trusted: string[] = [],
) => withWriteAuthority({ ...base, client }, trusted);

const group = {
  groupSlug: "gdg-tokyo",
  groupId: 1,
  chapterId: "10",
  enabled: true,
};

function db(found: boolean) {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => (found ? { ok: 1 } : null) }),
    }),
  } as unknown as D1Database;
}

describe("authorize", () => {
  it("normalizes group slug", () => {
    expect(resolveGroupSlug("GDG-Tokyo")).toBe("gdg-tokyo");
  });

  it("allows organizers to write and members to read through a first-party client", () => {
    expect(canWriteGroup(via(organizerBase, FIRST_PARTY), group)).toBe(true);
    expect(canReadGroup(via(memberBase, FIRST_PARTY), group)).toBe(true);
    expect(canWriteGroup(via(memberBase, FIRST_PARTY), group)).toBe(false);
  });

  it("allows platform admins through a first-party client", () => {
    const admin = via(adminBase, FIRST_PARTY);
    expect(canWriteGroup(admin, group)).toBe(true);
    expect(canReadGroup(admin, group)).toBe(true);
    expect(requireAdmin(admin)).toBe(true);
  });

  it("lets a developer app's token read but never write, even for an organizer or admin", async () => {
    for (const client of [DEVELOPER_APP, null]) {
      const organizer = via(organizerBase, client);
      const admin = via(adminBase, client);
      expect(canReadGroup(organizer, group)).toBe(true);
      expect(canWriteGroup(organizer, group)).toBe(false);
      expect(canWriteGroup(admin, group)).toBe(false);
      expect(requireAdmin(admin)).toBe(false);
      await expect(canWriteAnyGroup(db(true), organizer)).resolves.toBe(false);
      await expect(canWriteAnyGroup(db(true), admin)).resolves.toBe(false);
    }
  });

  it("lets a developer app write only where its client is explicitly trusted", async () => {
    const trusted = via(organizerBase, CHECKIN_APP, [CHECKIN_APP.id]);
    const untrusted = via(organizerBase, DEVELOPER_APP, [CHECKIN_APP.id]);

    await expect(canWriteAnyGroup(db(true), trusted)).resolves.toBe(true);
    expect(canWriteGroup(trusted, group)).toBe(true);
    await expect(canWriteAnyGroup(db(true), untrusted)).resolves.toBe(false);
    expect(canWriteGroup(via(memberBase, CHECKIN_APP, [CHECKIN_APP.id]), group)).toBe(false);
  });
});
