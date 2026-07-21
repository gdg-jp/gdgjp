import type {
  ClarificationCommand,
  RegenerateCommand,
  SelectUrlsCommand,
  StartIngestionCommand,
} from "../../../shared/ingestion/commands";
import type {
  IngestionAcceptedResult,
  IngestionSnapshot,
  RegenerateResult,
} from "../../../shared/ingestion/public-results";

/** The callable subset exposed by the generation Agent to the presentation layer. */
export interface WikiGenerationAgentRpc<Operation = unknown> {
  startIngestion(input: StartIngestionCommand): Promise<{ sessionId: string }>;
  submitClarification(input: ClarificationCommand): Promise<IngestionAcceptedResult>;
  selectUrls(input: SelectUrlsCommand): Promise<IngestionAcceptedResult>;
  regenerateOperation(input: RegenerateCommand): Promise<RegenerateResult<Operation>>;
  getSnapshot(): Promise<IngestionSnapshot>;
}

type AgentMethod = <Result>(method: string, args?: unknown[]) => Promise<Result>;

/**
 * Keeps direct Agents SDK calls out of route components. The client is
 * deliberately transport-shaped so it can also be exercised with a fake.
 */
export function createIngestionAgentClient<Operation>(
  call: AgentMethod,
): WikiGenerationAgentRpc<Operation> {
  return {
    startIngestion: (input) => call<{ sessionId: string }>("startIngestion", [input]),
    submitClarification: (input) => call<IngestionAcceptedResult>("submitClarification", [input]),
    selectUrls: (input) => call<IngestionAcceptedResult>("selectUrls", [input]),
    regenerateOperation: (input) =>
      call<RegenerateResult<Operation>>("regenerateOperation", [input]),
    getSnapshot: () => call<IngestionSnapshot>("getSnapshot"),
  };
}
