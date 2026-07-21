import { tool } from "ai";
import { z } from "zod";
import type { ToolName } from "../../../../../shared/ingestion/realtime-events";
import type { ExecutionEventSink } from "../../orchestration/ports/tool-event-sink";
import type { WikiWorkspace } from "./workspace";

function toolCallId(): string {
  return crypto.randomUUID();
}

async function emitSafely(
  sink: ExecutionEventSink | undefined,
  event: Parameters<ExecutionEventSink["emit"]>[0],
): Promise<void> {
  try {
    await sink?.emit(event);
  } catch {
    // Realtime telemetry must never make an otherwise valid generation fail.
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name === "WorkspaceBudgetExceededError") {
    return "workspace_budget_exhausted";
  }
  return "workspace_tool_failed";
}

/**
 * Maps the framework-neutral workspace API to AI SDK tools. Only fixed,
 * display-safe descriptions cross the event boundary; arguments and returned
 * content remain inside the model execution.
 */
export function createWorkspaceToolCatalog(
  workspace: WikiWorkspace,
  eventSink?: ExecutionEventSink,
) {
  function instrument<T>(
    name: ToolName,
    summary: string,
    execute: () => Promise<{ data: T; truncated: boolean }>,
  ): Promise<T> {
    const id = toolCallId();
    const startedAt = Date.now();
    return (async () => {
      await emitSafely(eventSink, { type: "tool_started", toolCallId: id, tool: name, summary });
      try {
        const result = await execute();
        await emitSafely(eventSink, {
          type: "tool_completed",
          toolCallId: id,
          tool: name,
          durationMs: Date.now() - startedAt,
          truncated: result.truncated,
        });
        return result.data;
      } catch (error) {
        await emitSafely(eventSink, {
          type: "tool_failed",
          toolCallId: id,
          tool: name,
          errorCode: errorCode(error),
        });
        throw error;
      }
    })();
  }

  return {
    pwd: tool({
      description: "Print the current workspace directory.",
      inputSchema: z.object({}),
      execute: () => instrument("pwd", "Checking the workspace directory", () => workspace.pwd()),
    }),
    cd: tool({
      description: "Change to an exact workspace directory.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) =>
        instrument("cd", "Changing workspace directory", () => workspace.cd(path)),
    }),
    ls: tool({
      description: "List a bounded page of directory entries.",
      inputSchema: z.object({
        path: z.string().optional(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ path, ...options }) =>
        instrument("ls", "Listing workspace entries", () => workspace.ls(path, options)),
    }),
    cat: tool({
      description: "Read an exact file and bounded inclusive line range.",
      inputSchema: z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: ({ path, ...options }) =>
        instrument("cat", "Reading workspace evidence", () => workspace.cat(path, options)),
    }),
    find: tool({
      description: "Find public Wiki paths by title or slug; use cat to read a match.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ query, ...options }) =>
        instrument("find", "Searching Wiki page names", () => workspace.find(query, options)),
    }),
    grep: tool({
      description: "Search public Wiki bodies and return bounded snippets; use cat for evidence.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ query, ...options }) =>
        instrument("grep", "Searching Wiki evidence", () => workspace.grep(query, options)),
    }),
  };
}
