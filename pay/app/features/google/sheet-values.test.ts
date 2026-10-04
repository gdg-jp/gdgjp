import { describe, expect, it } from "vitest";
import { buildSheetValues } from "./sheet-values";

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
