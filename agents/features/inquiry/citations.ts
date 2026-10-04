import type { InquiryOutcome } from "./outcome";
type AnswerSteps = Extract<InquiryOutcome, { kind: "answer" }>["steps"];
/**
 * Collect workspace paths that wiki_cat / wiki_search actually returned.
 * Model-invented paths in the answer text are never cited this way.
 */
export function extractCitedPathsFromSteps(steps: AnswerSteps): string[] {
  const paths = new Set<string>();
  for (const step of steps) {
    for (const tr of step.toolResults) {
      const toolName = "toolName" in tr ? String(tr.toolName) : "";
      const output = tr.output;
      if (!output || typeof output !== "object") continue;

      if (toolName === "wiki_cat" && "path" in output && typeof output.path === "string") {
        if (output.path !== "/wiki/index") paths.add(output.path);
        continue;
      }
      if (toolName === "wiki_search" && "matches" in output && Array.isArray(output.matches)) {
        for (const match of output.matches) {
          if (
            match &&
            typeof match === "object" &&
            "path" in match &&
            typeof match.path === "string"
          ) {
            paths.add(match.path);
          }
        }
      }
    }
  }
  return [...paths];
}

/** True when every cited workspace path appears as a URL or path in the answer. */
export function answerCitesPaths(text: string, paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return paths.every((path) => {
    const leaf = path.split("/").filter(Boolean).pop() ?? "";
    return text.includes(path) || (leaf.length > 0 && text.includes(leaf));
  });
}
