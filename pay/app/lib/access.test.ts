import { describe, expect, it } from "vitest";
import { canProxyForEvent } from "~/lib/auth-redirect.server";
import { formatYen, parseYenInput, sumAmounts } from "~/lib/money";
import { buildSheetValues } from "~/lib/sheets.server";

describe("sumAmounts", () => {
  it("sums to the yen", () => {
    expect(sumAmounts([4081, 3080, 12960])).toBe(20121);
  });
});

describe("parseYenInput", () => {
  it("accepts formatted yen strings", () => {
    expect(parseYenInput("¥12,960")).toBe(12960);
    expect(parseYenInput("abc")).toBeNull();
  });
});

describe("formatYen", () => {
  it("formats with yen symbol", () => {
    expect(formatYen(53860)).toBe("¥53,860");
  });
});

describe("canProxyForEvent", () => {
  const event = { ownerUserId: "owner-1", ownerChapterIds: [10, 20] };

  it("allows the event owner", () => {
    expect(
      canProxyForEvent(
        { userId: "owner-1", chapters: [{ chapterId: 99, chapterSlug: "x", role: "member" }] },
        event,
      ),
    ).toBe(true);
  });

  it("allows organizers of snapshotted chapters", () => {
    expect(
      canProxyForEvent(
        {
          userId: "org-1",
          chapters: [{ chapterId: 20, chapterSlug: "osaka", role: "organizer" }],
        },
        event,
      ),
    ).toBe(true);
  });

  it("denies plain members of snapshotted chapters", () => {
    expect(
      canProxyForEvent(
        {
          userId: "member-1",
          chapters: [{ chapterId: 10, chapterSlug: "tokyo", role: "member" }],
        },
        event,
      ),
    ).toBe(false);
  });
});

describe("buildSheetValues", () => {
  it("matches the Voice Research template layout", () => {
    const values = buildSheetValues({
      applicantName: "陶山聡太",
      eventTitle: "Innovative Crosstalk 26",
      applicationDate: "2026-08-09",
      totalAmount: 53860,
      bank: {
        bankName: "三菱東京UFJ銀行",
        branchName: "千里中央支店",
        accountType: "普通",
        accountNumber: "114533",
      },
      items: [
        {
          spentOn: "2026-07-10",
          category: "印刷物",
          description: "チラシ・ポスター",
          amountYen: 4081,
          receiptFilename: "suyama_260710_1.pdf",
        },
      ],
    });
    expect(values[0]).toEqual(["申請者氏名", "陶山聡太", "合計", 53860]);
    expect(values[1]).toEqual(["イベント名", "Innovative Crosstalk 26"]);
    expect(values[2]?.[3]).toBe("2026/08/09");
    expect(values[6]).toEqual(["振込先口座", "三菱東京UFJ銀行", "千里中央支店", "普通", "114533"]);
    expect(values[9]).toEqual([
      "2026/07/10",
      "印刷物",
      "チラシ・ポスター",
      4081,
      "suyama_260710_1.pdf",
    ]);
  });
});
