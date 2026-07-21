export const GENERATION_EXPLORATION_STEP_LIMIT = 11;

export function prepareExplorationStep(stepNumber: number) {
  if (stepNumber !== 0) return undefined;
  return {
    activeTools: ["cat"] as ["cat"],
    toolChoice: { type: "tool" as const, toolName: "cat" as const },
  };
}
