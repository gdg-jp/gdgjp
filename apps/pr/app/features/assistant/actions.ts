import { ACTION_TYPES, type MessageAction } from "./message";

export type RawAction = {
  type: string;
  label: string;
  scheduleItemIds: number[];
  dueAt: string | null;
  path: string | null;
  instructions: string | null;
};

/**
 * Keep only buttons the Worker can run: a known type, items of this campaign, a readable time,
 * and a path inside the campaign. Pure; the runner's output is never trusted.
 */
export function sanitizeActions(
  raw: RawAction[],
  context: { base: string; itemIds: Set<number> },
): MessageAction[] {
  const out: MessageAction[] = [];
  for (const a of raw) {
    if (a.type === "revert_brief" || !(ACTION_TYPES as readonly string[]).includes(a.type))
      continue;
    const label = a.label.trim().slice(0, 40);
    if (!label) continue;
    const ids = a.scheduleItemIds.filter((id) => context.itemIds.has(id));
    const action: MessageAction = {
      type: a.type as MessageAction["type"],
      label,
      status: "proposed",
      instructions: a.instructions?.trim().slice(0, 2000) || null,
    };
    if (a.type === "draft_items") {
      if (!ids.length) continue;
      action.scheduleItemIds = ids.slice(0, 20);
    }
    if (a.type === "move_item") {
      const at = a.dueAt ? Date.parse(a.dueAt) : Number.NaN;
      if (ids.length !== 1 || Number.isNaN(at)) continue;
      action.scheduleItemIds = ids;
      action.dueAt = new Date(at).toISOString();
    }
    if (a.type === "open_page") {
      const path = a.path ?? "";
      if (!(path === context.base || path.startsWith(`${context.base}/`))) continue;
      if (path.includes("..") || path.includes("//") || /[\s"'<>]/.test(path)) continue;
      action.path = path;
    }
    out.push(action);
  }
  return out.slice(0, 5);
}

/** Buttons the assistant may press itself when the chapter lets it (internal work only). */
export const AUTO_ACTIONS: readonly MessageAction["type"][] = ["run_plan", "draft_items"];
