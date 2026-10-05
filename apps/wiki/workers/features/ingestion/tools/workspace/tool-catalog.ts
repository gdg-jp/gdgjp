import { tool } from "ai";
import { z } from "zod";
import {
  toolCompletedEvent,
  toolFailedEvent,
  toolStartedEvent,
} from "../../../../../shared/ingestion/realtime-events";
import type {
  ToolArgumentsByName,
  ToolName,
} from "../../../../../shared/ingestion/realtime-events";
import type { GenerationObservability, GenerationTraceContext } from "../../observability";
import type { ExecutionEventSink } from "../../orchestration/ports/tool-event-sink";
import type { MountedWorkspace } from "./workspace";

async function emitSafely(
  sink: ExecutionEventSink | undefined,
  event: Parameters<ExecutionEventSink["emit"]>[0],
): Promise<void> {
  try {
    await sink?.emit(event);
  } catch {
    // Realtime telemetry must not fail durable work.
  }
}

/** Stateless absolute-path tools with per-run request de-duplication. */
export function createWorkspaceToolCatalog(
  workspace: MountedWorkspace,
  eventSink?: ExecutionEventSink,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
  program?: string,
) {
  const cache = new Map<string, Promise<{ data: unknown; truncated: boolean }>>();

  async function execute<Name extends Extract<ToolName, "ls" | "cat" | "search">, T>(
    name: Name,
    summary: string,
    input: ToolArgumentsByName[Name],
    operation: () => Promise<{ data: T; truncated: boolean }>,
  ): Promise<T> {
    const toolCallId = crypto.randomUUID();
    const startedAt = Date.now();
    await emitSafely(eventSink, toolStartedEvent(name, toolCallId, input, summary));
    const cacheKey = `${name}:${JSON.stringify(input)}`;
    const cacheHit = cache.has(cacheKey);
    if (observability && trace) {
      observability.event("tool_started", trace, {
        program,
        outcome: "processing",
        data: { toolCallId, tool: name, args: input, cacheHit },
      });
    }
    try {
      const executeOperation = () => operation();
      const pending =
        cache.get(cacheKey) ??
        (observability && trace
          ? observability.span(
              "generation.tool",
              trace,
              { "generation.tool": name, "generation.program": program },
              executeOperation,
            )
          : executeOperation());
      cache.set(cacheKey, pending as Promise<{ data: unknown; truncated: boolean }>);
      const result = (await pending) as { data: T; truncated: boolean };
      await emitSafely(
        eventSink,
        toolCompletedEvent(name, toolCallId, input, Date.now() - startedAt, result.truncated),
      );
      if (observability && trace) {
        observability.event("tool_completed", trace, {
          program,
          outcome: "success",
          durationMs: Date.now() - startedAt,
          data: {
            toolCallId,
            tool: name,
            args: input,
            result: result.data,
            cacheHit,
            truncated: result.truncated,
          },
        });
      }
      return result.data;
    } catch (error) {
      cache.delete(cacheKey);
      await emitSafely(
        eventSink,
        toolFailedEvent(name, toolCallId, input, "workspace_tool_failed"),
      );
      if (observability && trace) {
        observability.event(
          "tool_failed",
          trace,
          {
            program,
            outcome: "error",
            durationMs: Date.now() - startedAt,
            data: { toolCallId, tool: name, args: input, cacheHit, error },
          },
          "error",
        );
      }
      throw error;
    }
  }

  return {
    ls: tool({
      description:
        "List children at an absolute workspace path. Nodes may be both readable and listable.",
      inputSchema: z.object({
        path: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: (input) =>
        execute("ls", "Listing workspace resources", input, () =>
          workspace.ls(input.path, { limit: input.limit, cursor: input.cursor }),
        ),
    }),
    cat: tool({
      description:
        "Read bounded content from an absolute workspace path. Use nextCursor to continue.",
      inputSchema: z.object({
        path: z.string(),
        maxChars: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: (input) =>
        execute("cat", "Reading workspace evidence", input, () =>
          workspace.cat(input.path, { maxChars: input.maxChars, cursor: input.cursor }),
        ),
    }),
    search: tool({
      description:
        "Search mounted resources by query. Optionally scope the search to an absolute mount path.",
      inputSchema: z.object({
        query: z.string(),
        path: z.string().optional(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: (input) =>
        execute("search", "Searching workspace resources", input, () =>
          workspace.search(input.query, {
            path: input.path,
            limit: input.limit,
            cursor: input.cursor,
          }),
        ),
    }),
  };
}
