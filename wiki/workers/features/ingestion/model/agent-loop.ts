// Leaves room for final structured generation and one schema-repair request.
export const GENERATION_EXPLORATION_STEP_LIMIT = 8;

export function prepareExplorationStep(stepNumber: number) {
  if (stepNumber !== 0) return undefined;
  return {
    activeTools: ["cat"] as ["cat"],
    toolChoice: { type: "tool" as const, toolName: "cat" as const },
  };
}
