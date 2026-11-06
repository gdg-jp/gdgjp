import { foldIndex, weightedLength } from "@skills/pr-playbook/scripts/checks/index.mjs";
import { constants } from "~/features/playbook/playbook";

/**
 * Split an X post at the last line break before X's fold (the Playbook's provisional threshold),
 * so a human edit only has to change `text`.
 */
export function autoFold(text: string): { textAboveFold: string; textBelowFold: string } {
  const { weighted } = constants.x.foldThreshold;
  const urlWeight = constants.x.urlWeight;
  if (weightedLength(text, urlWeight) <= weighted)
    return { textAboveFold: text, textBelowFold: "" };
  const fold = foldIndex(text, weighted, urlWeight);
  const lineEnd = text.lastIndexOf("\n", fold - 1);
  const cut = lineEnd >= 0 ? lineEnd + 1 : fold;
  return { textAboveFold: text.slice(0, cut), textBelowFold: text.slice(cut) };
}

export type PostContent = {
  channel: "x" | "ig";
  posts: Record<string, unknown>[];
  notes: string | null;
};
