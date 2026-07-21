import { describe, expect, it } from "vitest";
import type { IngestionRealtimeEvent } from "../../../../../shared/ingestion/realtime-events";
import type { GenerationEventFields, GenerationObservability } from "../../observability";
import { createWorkspaceToolCatalog } from "./tool-catalog";
import type { MountedWorkspace } from "./workspace";

describe("createWorkspaceToolCatalog", () => {
  it("reuses identical requests within one model run", async () => {
    let reads = 0;
    const events: IngestionRealtimeEvent[] = [];
    const workspace = {
      ls: async (path: string) => {
        reads += 1;
        return {
          data: { path, entries: [], nextCursor: null },
          truncated: false,
        };
      },
    } as unknown as MountedWorkspace;
    const catalog = createWorkspaceToolCatalog(workspace, {
      emit: (event) => {
        events.push(event);
      },
    });
    const execute = catalog.ls.execute as unknown as (input: {
      path: string;
    }) => Promise<unknown>;

    await Promise.all([execute({ path: "/" }), execute({ path: "/" })]);

    expect(reads).toBe(1);
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_started", tool: "ls", args: { path: "/" } }),
        expect.objectContaining({ type: "tool_completed", tool: "ls", args: { path: "/" } }),
      ]),
    );
  });

  it("records bounded tool results and cache hits in diagnostic telemetry", async () => {
    const diagnosticEvents: Array<{ event: string; fields?: GenerationEventFields }> = [];
    const observability: GenerationObservability = {
      event: (event, _context, fields) => {
        diagnosticEvents.push({ event, fields });
      },
      span: (_name, _context, _attributes, callback) => callback(),
      modelCall: () => undefined,
    };
    const workspace = {
      cat: async (path: string) => ({
        data: { path, content: "bounded evidence", nextCursor: null },
        truncated: false,
      }),
    } as unknown as MountedWorkspace;
    const catalog = createWorkspaceToolCatalog(
      workspace,
      undefined,
      observability,
      { sessionId: "session-1", workflowId: "workflow-1", runId: "run-1" },
      "plan",
    );
    const execute = catalog.cat.execute as unknown as (input: {
      path: string;
    }) => Promise<unknown>;

    await execute({ path: "/wiki/page" });
    await execute({ path: "/wiki/page" });

    const completed = diagnosticEvents.filter(({ event }) => event === "tool_completed");
    expect(completed).toHaveLength(2);
    expect(completed[0]?.fields?.data).toMatchObject({
      result: { content: "bounded evidence" },
      cacheHit: false,
      truncated: false,
    });
    expect(completed[1]?.fields?.data).toMatchObject({ cacheHit: true });
  });

  it("includes the attempted arguments when a workspace tool fails", async () => {
    const events: IngestionRealtimeEvent[] = [];
    const workspace = {
      cat: async () => {
        throw new Error("unavailable");
      },
    } as unknown as MountedWorkspace;
    const catalog = createWorkspaceToolCatalog(workspace, {
      emit: (event) => {
        events.push(event);
      },
    });
    const execute = catalog.cat.execute as unknown as (input: {
      path: string;
      maxChars: number;
    }) => Promise<unknown>;

    await expect(execute({ path: "/wiki/page", maxChars: 250 })).rejects.toThrow("unavailable");
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "tool_failed",
        tool: "cat",
        args: { path: "/wiki/page", maxChars: 250 },
      }),
    );
  });
});
