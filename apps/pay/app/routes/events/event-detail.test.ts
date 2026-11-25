import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMember } from "~/features/auth/session.server";
import { listClaimsForEvent } from "~/features/claims/repository.server";
import type { ClaimRow } from "~/features/claims/types";
import { getEvent } from "~/features/events/repository.server";
import { loader } from "./event-detail";

vi.mock("~/features/auth/session.server", () => ({ requireMember: vi.fn() }));
vi.mock("~/features/events/repository.server", () => ({ getEvent: vi.fn() }));
vi.mock("~/features/claims/repository.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/claims/repository.server")>()),
  listClaimsForEvent: vi.fn(),
  getSelfClaim: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/features/google/repository.server", () => ({ getGoogleOAuthToken: vi.fn() }));
vi.mock("~/features/profiles/repository.server", () => ({
  getProfile: vi.fn().mockResolvedValue(null),
}));

const eventId = "evt_0000000000000000000000SEE1";
const env = { DB: {}, TOKEN_ENCRYPTION_KEY: "test" } as Env;

function signInAs(userId: string, chapters: UserChapter[]) {
  vi.mocked(requireMember).mockResolvedValue({
    user: { id: userId, name: userId, email: `${userId}@example.test`, image: null },
    chapters,
  } as unknown as Awaited<ReturnType<typeof requireMember>>);
}

async function load() {
  return loader({
    request: new Request(`https://pay.gdgs.jp/events/${eventId}`),
    context: { cloudflare: { env } },
    params: { id: eventId },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("event detail total", () => {
  beforeEach(() => {
    vi.mocked(getEvent).mockResolvedValue({
      id: eventId,
      title: "Event",
      ownerUserId: "owner",
      ownerChapterIds: [1],
      status: "open",
      createdAt: 0,
      googleAdminUserId: null,
      googleDriveFolderId: null,
      googleDriveFolderName: null,
    });
    vi.mocked(listClaimsForEvent).mockResolvedValue([
      { id: "clm_a", user_id: "member", total_amount: 2000 },
      { id: "clm_b", user_id: null, total_amount: 4500 },
    ] as ClaimRow[]);
  });

  it("withholds the total from an organizer of another chapter", async () => {
    signInAs("outsider", [{ chapterId: 2, chapterSlug: "gdg-osaka", role: "organizer" }]);
    const data = await load();
    expect(data.total).toBeNull();
    expect(JSON.stringify(data)).not.toContain("6500");
  });

  it("shows the total to a plain member of the event's chapter", async () => {
    signInAs("member", [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "member" }]);
    expect((await load()).total).toBe(6500);
  });

  it("shows the total to the event owner", async () => {
    signInAs("owner", [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "organizer" }]);
    expect((await load()).total).toBe(6500);
  });
});
