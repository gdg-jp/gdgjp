import type { FilePart } from "ai";
import type { WikiModel } from "../../../../app/features/ai/model/index.server";
import type {
  ChangesetOperation,
  CreateOperation,
  PageDraft,
  SectionPatchResponse,
  UpdateOperation,
} from "../../../../shared/ingestion/domain";
import { PageDraftOutputSchema, SectionPatchResponseOutputSchema } from "./page-content-output";
import { DRAFT_PROMPT } from "./prompts";

/**
 * Content deliberately selected by planning/exploration. A draft program has
 * no workspace or tools: it can only use these resolved chunks.
 */
export interface ResolvedEvidence {
  path: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
}

export type PlannedPageOperation = CreateOperation | UpdateOperation;

export interface PageDraftProgramInput {
  /** Trusted text supplied directly by the user, not a workspace file. */
  userInput: string;
  clarificationAnswers?: string;
  operation: PlannedPageOperation;
  evidence: readonly ResolvedEvidence[];
  /** User-supplied images/PDFs are part of the direct input context. */
  attachments?: readonly FilePart[];
  /** Required to retain an update operation's optimistic-concurrency base. */
  existingTipTapJson?: string;
}

export interface PageDraftProgram {
  generate(input: PageDraftProgramInput): Promise<ChangesetOperation>;
}

function renderEvidence(evidence: readonly ResolvedEvidence[]): string {
  if (evidence.length === 0) return "(選択済みの外部資料はありません)";
  return evidence
    .map((chunk) => {
      const range =
        chunk.lineStart === undefined
          ? ""
          : `:${chunk.lineStart}-${chunk.lineEnd ?? chunk.lineStart}`;
      return `## ${chunk.path}${range}\n${chunk.content}`;
    })
    .join("\n\n");
}

function draftPrompt(input: PageDraftProgramInput): string {
  const clarification = input.clarificationAnswers?.trim();
  return [
    "ユーザー入力:",
    input.userInput,
    clarification ? `\n確認回答:\n${clarification}` : "",
    `\nページ操作:\n${JSON.stringify(input.operation)}`,
    `\n選択済みの証拠:\n${renderEvidence(input.evidence)}`,
  ].join("\n");
}

/**
 * A page-scoped generation subagent. It deliberately has no access to the
 * planner conversation, workspace, or tools, so one operation cannot make a
 * later operation inherit accidental context or continue exploring.
 */
export function createPageDraftProgram(model: Pick<WikiModel, "generateObject">): PageDraftProgram {
  return {
    async generate(input) {
      const messages = [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: draftPrompt(input) },
            ...(input.attachments ?? []),
          ],
        },
      ];

      if (input.operation.type === "create") {
        const generated = await model.generateObject({
          schema: PageDraftOutputSchema,
          schemaName: "PageDraft",
          system: DRAFT_PROMPT,
          messages,
          temperature: 0.2,
          maxRetries: 0,
        });
        return {
          type: "create",
          tempId: input.operation.tempId,
          rationale: input.operation.rationale,
          evidencePaths: input.operation.evidencePaths,
          draft: {
            ...generated,
            suggestedParentId: input.operation.suggestedParentId,
          },
          patch: null,
        };
      }

      if (!input.existingTipTapJson) {
        throw new Error(`Planned update page no longer exists: ${input.operation.pageId}`);
      }
      const patch = await model.generateObject({
        schema: SectionPatchResponseOutputSchema,
        schemaName: "SectionPatchResponse",
        system: DRAFT_PROMPT,
        messages,
        temperature: 0.2,
        maxRetries: 0,
      });
      return {
        type: "update",
        pageId: input.operation.pageId,
        pageTitle: input.operation.pageTitle,
        rationale: input.operation.rationale,
        evidencePaths: input.operation.evidencePaths,
        draft: null,
        patch: { ...patch, pageId: input.operation.pageId },
        existingTipTapJson: input.existingTipTapJson,
      };
    },
  };
}

export type { PageDraft, SectionPatchResponse };
