import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireMember } from "~/features/auth/session.server";
import { getEvent } from "~/features/events/repository.server";
import { syncClaimToGoogle } from "~/features/google/sheets.server";
import { actOnClaimDetail } from "./detail.server";
import { sendClaimReviewEmail } from "./email.server";
import {
  getClaim,
  insertClaimItem,
  listClaimItems,
  markClaimEmailSent,
  markClaimSynced,
} from "./repository.server";
import type { ClaimRow } from "./types";

vi.mock("~/features/auth/session.server", () => ({ requireMember: vi.fn() }));
vi.mock("~/features/events/repository.server", () => ({ getEvent: vi.fn() }));
vi.mock("~/features/google/sheets.server", () => ({ syncClaimToGoogle: vi.fn() }));
vi.mock("./email.server", () => ({ sendClaimReviewEmail: vi.fn() }));
vi.mock("./repository.server", () => ({
  getClaim: vi.fn(),
  insertClaimItem: vi.fn(),
  listClaimItems: vi.fn(),
  decryptClaimBank: vi.fn().mockResolvedValue({}),
  markClaimEmailSent: vi.fn(),
  markClaimSynced: vi.fn(),
  recalculateClaimTotal: vi.fn(),
}));

const eventId = "evt_00000000000000000000000000";
const claimId = "clm_00000000000000000000000000";
const claim = {
  id: claimId,
  event_id: eventId,
  kind: "self",
  user_id: "applicant",
  created_by: "applicant",
  sheet_url: "https://docs.google.com/spreadsheets/d/sheet/edit",
  applicant_name: "Applicant",
  total_amount: 100,
} as ClaimRow;
const env = { DB: {}, TOKEN_ENCRYPTION_KEY: "test" } as Env;

function request(intent: string) {
  return new Request(`https://pay.gdgs.jp/events/${eventId}/claims/${claimId}`, {
    method: "POST",
    body: new URLSearchParams({ intent }),
  });
}

describe("claim detail operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMember).mockResolvedValue({
      user: { id: "applicant" },
      chapters: [],
    } as unknown as Awaited<ReturnType<typeof requireMember>>);
    vi.mocked(getEvent).mockResolvedValue({
      id: eventId,
      title: "Event",
      ownerUserId: "organizer",
      ownerChapterIds: [],
      status: "open",
      createdAt: 0,
      googleAdminUserId: null,
      googleDriveFolderId: null,
      googleDriveFolderName: null,
    } as Awaited<ReturnType<typeof getEvent>>);
    vi.mocked(getClaim).mockResolvedValue(claim);
    vi.mocked(listClaimItems).mockResolvedValue([{ id: "item" }] as Awaited<
      ReturnType<typeof listClaimItems>
    >);
    vi.mocked(syncClaimToGoogle).mockResolvedValue({
      sheetId: "sheet",
      sheetUrl: claim.sheet_url as string,
      driveFolderId: "folder",
      itemDriveFileIds: [],
    });
    vi.mocked(sendClaimReviewEmail).mockResolvedValue(undefined);
  });

  it("allows organizer viewing without granting editing of another member's self claim", async () => {
    vi.mocked(requireMember).mockResolvedValue({
      user: { id: "organizer" },
      chapters: [],
    } as unknown as Awaited<ReturnType<typeof requireMember>>);
    const refusal = await actOnClaimDetail(env, request("sync-sheets"), eventId, claimId).catch(
      (error: Response) => error,
    );
    expect(refusal).toMatchObject({ status: 403 });
    await expect((refusal as Response).json()).resolves.toEqual({ reason: "not-claim-editor" });
    expect(syncClaimToGoogle).not.toHaveBeenCalled();
    expect(sendClaimReviewEmail).not.toHaveBeenCalled();
  });

  it("tells a member who neither filed nor manages the claim why it is refused", async () => {
    vi.mocked(requireMember).mockResolvedValue({
      user: { id: "someone-else" },
      chapters: [],
    } as unknown as Awaited<ReturnType<typeof requireMember>>);
    const refusal = await actOnClaimDetail(env, request("sync-sheets"), eventId, claimId).catch(
      (error: Response) => error,
    );
    expect(refusal).toMatchObject({ status: 403 });
    await expect((refusal as Response).json()).resolves.toEqual({ reason: "not-claim-viewer" });
  });

  it("syncs and records Sheets without implicitly sending review email", async () => {
    const result = await actOnClaimDetail(env, request("sync-sheets"), eventId, claimId);
    expect(result).toMatchObject({ ok: true });
    expect(markClaimSynced).toHaveBeenCalledWith(env.DB, claimId, {
      sheetId: "sheet",
      sheetUrl: claim.sheet_url,
      driveFolderId: "folder",
    });
    expect(sendClaimReviewEmail).not.toHaveBeenCalled();
    expect(markClaimEmailSent).not.toHaveBeenCalled();
  });

  it("records the explicit email action only after delivery succeeds", async () => {
    expect(await actOnClaimDetail(env, request("send-email"), eventId, claimId)).toMatchObject({
      ok: true,
    });
    expect(sendClaimReviewEmail).toHaveBeenCalledOnce();
    expect(markClaimEmailSent).toHaveBeenCalledWith(env.DB, claimId);
    expect(syncClaimToGoogle).not.toHaveBeenCalled();
  });

  it("does not record delivery when the email provider fails", async () => {
    vi.mocked(sendClaimReviewEmail).mockRejectedValue(new Error("provider failed"));
    expect(await actOnClaimDetail(env, request("send-email"), eventId, claimId)).toEqual({
      error: "provider failed",
    });
    expect(markClaimEmailSent).not.toHaveBeenCalled();
  });
});

describe("receipt upload without a Gemini key", () => {
  const fetchMock = vi.fn(async () => {
    throw new Error("network is disabled in tests");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(requireMember).mockResolvedValue({
      user: { id: "applicant" },
      chapters: [],
    } as unknown as Awaited<ReturnType<typeof requireMember>>);
    vi.mocked(getEvent).mockResolvedValue({
      id: eventId,
      title: "Event",
      ownerUserId: "organizer",
      ownerChapterIds: [],
      status: "open",
      createdAt: 0,
      googleAdminUserId: null,
      googleDriveFolderId: null,
      googleDriveFolderName: null,
    });
    vi.mocked(getClaim).mockResolvedValue(claim);
    vi.mocked(listClaimItems).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const key of ["", "   "]) {
    it(`stores the receipt for manual entry without calling Gemini when the key is ${JSON.stringify(key)}`, async () => {
      const put = vi.fn();
      const uploadEnv = {
        ...env,
        GEMINI_API_KEY: key,
        GEMINI_MODEL_ID: "gemini-test",
        RECEIPTS: { put },
      } as unknown as Env;
      const body = new FormData();
      body.set("intent", "upload");
      body.set(
        "receipt",
        new File([new Uint8Array([1, 2, 3])], "receipt.png", { type: "image/png" }),
      );

      const result = await actOnClaimDetail(
        uploadEnv,
        new Request(`https://pay.gdgs.jp/events/${eventId}/claims/${claimId}`, {
          method: "POST",
          body,
        }),
        eventId,
        claimId,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        message:
          "領収書を追加しました。自動読み取りは設定されていないため、月日・種別・品目・金額を入力して保存してください。",
      });
      expect(put).toHaveBeenCalledOnce();
      expect(insertClaimItem).toHaveBeenCalledWith(
        uploadEnv.DB,
        expect.objectContaining({
          claimId,
          amountYen: 0,
          category: "その他",
          description: "receipt.png",
          receiptFilename: "receipt.png",
          extractionJson: null,
        }),
      );
    });
  }
});
