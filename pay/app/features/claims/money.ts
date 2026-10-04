export const CATEGORY_SUGGESTIONS = [
  "印刷物",
  "広告",
  "ケータリング",
  "ノベルティ",
  "会場費",
  "交通費",
  "その他",
] as const;

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export function parseYenInput(value: string): number | null {
  const normalized = value.replace(/[¥,\s]/g, "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return amount;
}

export function todayJstDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function sumAmounts(amounts: Iterable<number>): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount)) throw new Error("amount must be a safe integer");
    total += amount;
  }
  return total;
}
