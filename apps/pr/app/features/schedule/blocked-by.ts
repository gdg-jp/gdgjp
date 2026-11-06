import type { Brief } from "~/features/briefs/brief";

/**
 * `blocked_by` conditions. An item may not be drafted until every condition holds.
 *   session:<id>:confirmed   the brief's session is confirmed or public (ANNOUNCE-AFTER-CONFIRMED)
 *   item:<id>:done           another schedule item is done
 *   date:<iso>               now is at or after the instant
 * Unknown conditions never resolve: a typo must block, not silently release.
 */
export type BlockContext = {
  brief: Brief | null;
  itemStatus: (id: number) => string | undefined;
  now: number;
};

export function conditionHolds(condition: string, ctx: BlockContext): boolean {
  const session = /^session:(.+):confirmed$/.exec(condition);
  if (session) {
    const status = ctx.brief?.sessions.find((s) => s.id === session[1])?.status;
    return status === "confirmed" || status === "public";
  }
  const item = /^item:(\d+):done$/.exec(condition);
  if (item) return ctx.itemStatus(Number(item[1])) === "done";
  const date = /^date:(.+)$/.exec(condition);
  if (date) {
    const at = Date.parse(date[1] ?? "");
    return !Number.isNaN(at) && ctx.now >= at;
  }
  return false;
}

export function pendingConditions(conditions: string[], ctx: BlockContext): string[] {
  return conditions.filter((condition) => !conditionHolds(condition, ctx));
}

export function describeCondition(condition: string, brief: Brief | null): string {
  const session = /^session:(.+):confirmed$/.exec(condition);
  if (session) {
    const title = brief?.sessions.find((s) => s.id === session[1])?.title ?? session[1];
    return `セッション「${title}」の確定`;
  }
  const item = /^item:(\d+):done$/.exec(condition);
  if (item) return `アイテム #${item[1]} の完了`;
  const date = /^date:(.+)$/.exec(condition);
  if (date) return `${date[1]} 以降`;
  return `不明な条件 ${condition}`;
}

export function parseConditions(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[\s,、]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}
