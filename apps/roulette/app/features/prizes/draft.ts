import { currentOdds, finiteLeft } from "./odds";
import { MAX_PRIZES, METHODS, type Method, type Prize } from "./prize";

/**
 * The prize settings form while it is being edited: text as typed, validated on
 * save on both the client and the server.
 */

export type DraftPrize = {
  id: string;
  name: string;
  stockText: string;
  unlimited: boolean;
  percentText: string;
};

export type Draft = { method: Method; expectedText: string; prizes: DraftPrize[] };

export type DraftErrors = {
  name?: Record<string, string>;
  stock?: Record<string, string>;
  percent?: Record<string, string>;
  /** About the whole list: empty, too many, or the % do not add up. */
  list?: string;
  expected?: string;
};

export const MAX_NAME_LENGTH = 40;

export function toDraft(settings: { method: Method; expected: number; prizes: Prize[] }): Draft {
  return {
    method: settings.method,
    expectedText: String(settings.expected),
    prizes: settings.prizes.map((prize) => ({
      id: prize.id,
      name: prize.name,
      stockText: prize.stock === null ? "" : String(prize.stock),
      unlimited: prize.stock === null,
      percentText: String(prize.percent),
    })),
  };
}

export function isDirty(draft: Draft, saved: Draft) {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

function parseCount(text: string) {
  const value = text.trim();
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

function parsePercent(text: string) {
  const value = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return number <= 100 ? number : null;
}

function wonOf(saved: Prize[], id: string) {
  return saved.find((prize) => prize.id === id)?.won ?? 0;
}

/** The draft as prizes, reading unparseable numbers as 0 so the preview always works. */
export function draftPrizes(draft: Draft, saved: Prize[]): Prize[] {
  return draft.prizes.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    stock: row.unlimited ? null : (parseCount(row.stockText) ?? 0),
    won: wonOf(saved, row.id),
    percent: parsePercent(row.percentText) ?? 0,
  }));
}

export function draftExpected(draft: Draft) {
  return parseCount(draft.expectedText) ?? 0;
}

export function percentTotal(draft: Draft) {
  const total = draft.prizes.reduce((sum, row) => sum + (parsePercent(row.percentText) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Odds of the draft for the preview; null while the % do not add up to 100. */
export function previewOdds(draft: Draft, saved: Prize[], draws: number) {
  if (draft.method === "fixed" && percentTotal(draft) !== 100) return null;
  return currentOdds(draftPrizes(draft, saved), draft.method, draftExpected(draft), draws);
}

/** Losing tickets in the box right now (expected − drawn − finite left). */
export function boxPool(draft: Draft, saved: Prize[], draws: number) {
  return Math.max(draftExpected(draft) - draws - finiteLeft(draftPrizes(draft, saved)), 0);
}

export function validateDraft(draft: Draft, saved: Prize[]): DraftErrors {
  const errors: DraftErrors = {};
  const name: Record<string, string> = {};
  const stock: Record<string, string> = {};
  const percent: Record<string, string> = {};
  if (!draft.prizes.length) errors.list = "景品を 1 つ以上登録してください";
  if (draft.prizes.length > MAX_PRIZES) errors.list = `景品は ${MAX_PRIZES} 個までです`;
  for (const row of draft.prizes) {
    const trimmed = row.name.trim();
    if (!trimmed) name[row.id] = "景品名を入れてください";
    else if (trimmed.length > MAX_NAME_LENGTH)
      name[row.id] = `${MAX_NAME_LENGTH} 文字以内にしてください`;
    if (!row.unlimited) {
      const value = parseCount(row.stockText);
      const won = wonOf(saved, row.id);
      if (value === null) stock[row.id] = "0 以上の整数にしてください";
      else if (value < won) stock[row.id] = `当選済みの ${won} 個より減らせません`;
    }
    if (draft.method === "fixed" && parsePercent(row.percentText) === null)
      percent[row.id] = "0〜100 にしてください";
  }
  if (
    !errors.list &&
    draft.method === "fixed" &&
    !Object.keys(percent).length &&
    percentTotal(draft) !== 100
  )
    errors.list = `確率の合計を 100% にしてください（今は ${percentTotal(draft)}%）`;
  if (draft.method === "box" && draft.prizes.some((row) => row.unlimited)) {
    const expected = parseCount(draft.expectedText);
    const stocked = draft.prizes.reduce(
      (sum, row) => (row.unlimited ? sum : sum + (parseCount(row.stockText) ?? 0)),
      0,
    );
    if (expected === null) errors.expected = "想定人数を入れてください";
    else if (expected < stocked)
      errors.expected = `景品の個数の合計（${stocked} 個）以上にしてください`;
  }
  if (Object.keys(name).length) errors.name = name;
  if (Object.keys(stock).length) errors.stock = stock;
  if (Object.keys(percent).length) errors.percent = percent;
  return errors;
}

export function hasErrors(errors: DraftErrors) {
  return Object.values(errors).some(Boolean);
}

/** Validate an untrusted JSON body into a Draft (shape only; values go through validateDraft). */
export function parseDraft(input: unknown): Draft | null {
  if (!input || typeof input !== "object") return null;
  const { method, expectedText, prizes } = input as Record<string, unknown>;
  if (!METHODS.includes(method as Method)) return null;
  if (typeof expectedText !== "string" || !Array.isArray(prizes)) return null;
  if (prizes.length > MAX_PRIZES) return null;
  const rows: DraftPrize[] = [];
  const ids = new Set<string>();
  for (const row of prizes) {
    if (!row || typeof row !== "object") return null;
    const { id, name, stockText, unlimited, percentText } = row as Record<string, unknown>;
    if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(id) || ids.has(id)) return null;
    if (typeof name !== "string" || typeof stockText !== "string") return null;
    if (typeof unlimited !== "boolean" || typeof percentText !== "string") return null;
    ids.add(id);
    rows.push({ id, name, stockText, unlimited, percentText });
  }
  return { method: method as Method, expectedText, prizes: rows };
}

/** Draft → the values to store. Call only after validateDraft returned no errors. */
export function draftToSettings(draft: Draft, saved: Prize[]) {
  return {
    method: draft.method,
    expected: draftExpected(draft),
    prizes: draftPrizes(draft, saved),
  };
}

export function newRow(id: string): DraftPrize {
  return { id, name: "", stockText: "1", unlimited: false, percentText: "0" };
}

/** Add above the first unlimited row so the losing slot stays at the bottom. */
export function addRow(draft: Draft, id: string): Draft {
  const at = draft.prizes.findIndex((row) => row.unlimited);
  const prizes = [...draft.prizes];
  prizes.splice(at === -1 ? prizes.length : at, 0, newRow(id));
  return { ...draft, prizes };
}

export function moveRow(draft: Draft, index: number, by: -1 | 1): Draft {
  const prizes = [...draft.prizes];
  const [row] = prizes.splice(index, 1);
  if (!row) return draft;
  prizes.splice(index + by, 0, row);
  return { ...draft, prizes };
}

/** Rank of a row counting only finite rows (unlimited rows are null). */
export function draftRank(draft: Draft, index: number) {
  if (draft.prizes[index]?.unlimited) return null;
  return draft.prizes.slice(0, index + 1).filter((row) => !row.unlimited).length;
}
