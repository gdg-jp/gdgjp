import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import type { WorkspaceManifest } from "../tools/wiki-workspace/workspace";

export interface GenerationValidationContext {
  operations: readonly ChangesetOperation[];
  workspace: WorkspaceManifest;
}

export interface GenerationValidator {
  readonly id: string;
  validate(context: GenerationValidationContext): Promise<string[]> | string[];
}

const evidenceValidator: GenerationValidator = {
  id: "evidence-selected",
  validate: ({ operations, workspace }) => {
    const errors: string[] = [];
    if (operations.length === 0) errors.push("Generation produced no operations");
    if (!workspace.tools.some((trace) => trace.tool === "cat")) {
      errors.push("Generation completed without reading source evidence");
    }
    return errors;
  },
};

/** Extension point for future information-loss scoring and ontology validation. */
export async function runGenerationValidation(
  context: GenerationValidationContext,
  validators: readonly GenerationValidator[] = [evidenceValidator],
): Promise<void> {
  const errors = (
    await Promise.all(validators.map((validator) => validator.validate(context)))
  ).flat();
  if (errors.length > 0) throw new Error(`Generation validation failed: ${errors.join("; ")}`);
}
