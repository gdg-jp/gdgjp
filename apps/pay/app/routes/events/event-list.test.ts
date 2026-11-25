import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOptionalUser, requireMember } from "~/features/auth/session.server";
import { listClaimsForEvent } from "~/features/claims/repository.server";
import type { ClaimRow } from "~/features/claims/types";
import { listEvents } from "~/features/events/repository.server";
import type { PayEvent } from "~/features/events/types";
import { loader } from "./event-list";

vi.mock("~/features/auth/session.server", () => ({
  getOptionalUser: vi.fn(),
  requireMember: vi.fn(),
}));
vi.mock("~/features/events/repository.server", () => ({ listEvents: vi.fn() }));
vi.mock("~/features/claims/repository.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/claims/repository.server")>()),
  listClaimsForEvent: vi.fn(),
}));

const env = { DB: {} } as Env;

function event(id: string, ownerUserId: string, ownerChapterIds: number[]): PayEvent {
  return {
    id,
    title: id,
    ownerUserId,
    ownerChapterIds,
    status: "open",
    createdAt: 0,
    googleAdminUserId: null,
    googleDriveFolderId: null,
    googleDriveFolderName: null,
  };
}

function signInAs(userId: string, chapters: UserChapter[]) {
  const user = { id: userId, name: userId, email: `${userId}@example.test`, image: null };
  vi.mocked(getOptionalUser).mockResolvedValue(user as Awaited<ReturnType<typeof getOptionalUser>>);
  vi.mocked(requireMember).mockResolvedValue({ user, chapters } as unknown as Awaited<
    ReturnType<typeof requireMember>
  >);
}

async function totals() {
  const data = await loader({
    request: new Request("https://pay.gdgs.jp/"),
    context: { cloudflare: { env } },
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
  return Object.fromEntries(data.events.map((row) => [row.id, row.total]));
}

describe("event list totals", () => {
  beforeEach(() => {
    vi.mocked(listEvents).mockResolvedValue([
      event("tokyo", "tokyo-lead", [1]),
      event("osaka", "osaka-lead", [2]),
    ]);
    vi.mocked(listClaimsForEvent).mockImplementation(async (_db, eventId) =>
      eventId === "tokyo"
        ? ([{ total_amount: 6500 }] as ClaimRow[])
        : ([{ total_amount: 1200 }] as ClaimRow[]),
    );
  });

  it("shows each total only to the event's owner and its chapters' members", async () => {
    signInAs("tokyo-member", [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "member" }]);
    expect(await totals()).toEqual({ tokyo: 6500, osaka: null });

    signInAs("osaka-lead", [{ chapterId: 2, chapterSlug: "gdg-osaka", role: "organizer" }]);
    expect(await totals()).toEqual({ tokyo: null, osaka: 1200 });
  });
});
