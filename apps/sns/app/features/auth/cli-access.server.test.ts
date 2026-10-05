import type { BearerIdentity } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireCliSnsAccess, requireCliSnsOrganizer } from "./cli-access.server";

const getCliIdentity = vi.hoisted(() => vi.fn<() => Promise<BearerIdentity | null>>());
const isContributor = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("@gdgjp/gdg-lib", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gdgjp/gdg-lib")>()),
  getCliIdentity,
}));

vi.mock("~/features/contributors/contributor.repository.server", () => ({ isContributor }));

const env = { ACCOUNTS_URL: "https://accounts.example", DB: {} } as unknown as Env;
const request = new Request("https://sns.gdgs.jp/api/cli/v1/posts?chapterId=1");

function identity(over: Partial<BearerIdentity> = {}): BearerIdentity {
  return {
    user: { id: "u1", email: "u@example.com", name: "U", image: null, isAdmin: false },
    chapters: [],
    ...over,
  };
}

beforeEach(() => {
  getCliIdentity.mockReset();
  isContributor.mockReset();
  isContributor.mockResolvedValue(false);
});

describe("requireCliSnsAccess", () => {
  it("returns 401 when there is no CLI identity", async () => {
    getCliIdentity.mockResolvedValue(null);
    expect(await requireCliSnsAccess(request, env, 1)).toEqual({ error: 401 });
  });

  it("grants organizer to a chapter organizer", async () => {
    getCliIdentity.mockResolvedValue(
      identity({ chapters: [{ chapterId: 1, chapterSlug: "gdg-x", role: "organizer" }] }),
    );
    const result = await requireCliSnsAccess(request, env, 1);
    expect(result).toMatchObject({ role: "organizer" });
  });

  it("grants contributor to a non-member listed in sns_contributors", async () => {
    getCliIdentity.mockResolvedValue(identity({ chapters: [] }));
    isContributor.mockResolvedValue(true);
    const result = await requireCliSnsAccess(request, env, 1);
    expect(result).toMatchObject({ role: "contributor" });
  });

  it("grants organizer to a super-admin regardless of membership", async () => {
    getCliIdentity.mockResolvedValue(
      identity({ user: { id: "a", email: "a@x", name: "A", image: null, isAdmin: true } }),
    );
    const result = await requireCliSnsAccess(request, env, 9);
    expect(result).toMatchObject({ role: "organizer" });
  });

  it("returns 403 for a plain member who is not a contributor", async () => {
    getCliIdentity.mockResolvedValue(
      identity({ chapters: [{ chapterId: 1, chapterSlug: "gdg-x", role: "member" }] }),
    );
    expect(await requireCliSnsAccess(request, env, 1)).toEqual({ error: 403 });
  });
});

describe("requireCliSnsOrganizer", () => {
  it("rejects a contributor with 403 (contributor access never grants administration)", async () => {
    getCliIdentity.mockResolvedValue(identity({ chapters: [] }));
    isContributor.mockResolvedValue(true);
    expect(await requireCliSnsOrganizer(request, env, 1)).toEqual({ error: 403 });
  });

  it("accepts a chapter organizer", async () => {
    getCliIdentity.mockResolvedValue(
      identity({ chapters: [{ chapterId: 1, chapterSlug: "gdg-x", role: "organizer" }] }),
    );
    expect(await requireCliSnsOrganizer(request, env, 1)).toMatchObject({ user: { id: "u1" } });
  });
});
