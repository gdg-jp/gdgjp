import type { BankAccount } from "~/features/profiles/types";

export type SheetPayload = {
  applicantName: string;
  eventTitle: string;
  applicationDate: string;
  totalAmount: number;
  bank: BankAccount;
  items: Array<{
    spentOn: string;
    category: string;
    description: string;
    amountYen: number;
    receiptFilename: string;
  }>;
};

export function buildSheetValues(payload: SheetPayload): unknown[][] {
  const rows: unknown[][] = [
    ["申請者氏名", payload.applicantName, "合計", payload.totalAmount],
    ["イベント名", payload.eventTitle],
    ["申請者記入", "", "", payload.applicationDate.replaceAll("-", "/")],
    ["ボイスリサーチ記入", "受理確認", "□", "受理確認日を記入"],
    ["ボイスリサーチ記入", "振込完了", "□", "振込日を記入"],
    [],
    [
      "振込先口座",
      payload.bank.bankName,
      payload.bank.branchName,
      payload.bank.accountType,
      payload.bank.accountNumber,
    ],
    [],
    ["月日", "種別", "品目等の内訳", "金額（円）", "領収書の情報"],
  ];
  for (const item of payload.items) {
    rows.push([
      item.spentOn.replaceAll("-", "/"),
      item.category,
      item.description,
      item.amountYen,
      item.receiptFilename,
    ]);
  }
  return rows;
}
