import { describe, expect, it, vi } from "vitest";
import { SOURCE_REFRESH_CRON, TASK_REMINDER_CRON } from "./features/sources/fetch-source";

// The `scheduled` handler discriminates purely by cron string and fans out to
// feature modules that moved in Stage 05 (`features/discord/reminders.server`,
// `features/pages/content-backfill.server`, `features/sources/fetch-source`). A
// broken import there only throws in production — cron never runs in CI — so
// this test pins that both branches still reach their moved dependencies.

const sendDueTaskReminders = vi.fn((_arg?: unknown) => Promise.resolve());
const backfillMarkdownContent = vi.fn((_arg?: unknown) => Promise.resolve());
const enqueueDueSourceRefreshes = vi.fn((_arg?: unknown) => Promise.resolve());

vi.mock("../app/features/discord/reminders.server", () => ({
  sendDueTaskReminders: (env: unknown) => sendDueTaskReminders(env),
}));
vi.mock("../app/features/pages/content-backfill.server", () => ({
  backfillMarkdownContent: (db: unknown) => backfillMarkdownContent(db),
}));
vi.mock("./features/sources/fetch-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features/sources/fetch-source")>();
  return {
    ...actual,
    enqueueDueSourceRefreshes: (env: unknown) => enqueueDueSourceRefreshes(env),
    fetchSource: vi.fn(),
  };
});

// Runtime-boundary modules pull `cloudflare:`-scheme imports the node test loader
// cannot resolve; the `scheduled` handler never touches them.
vi.mock("agents", () => ({ routeAgentRequest: vi.fn() }));
vi.mock("./agents/wiki-generation-agent", () => ({ WikiGenerationAgent: class {} }));
vi.mock("./collab-durable-object", () => ({ CollabDurableObject: class {} }));
vi.mock("./source-import-durable-object", () => ({ SourceImportDurableObject: class {} }));
vi.mock("./workflows/wiki-generation-phase-workflow", () => ({
  WikiGenerationPhaseWorkflow: class {},
}));

const { default: worker } = await import("./app");

function runScheduled(cron: string) {
  const waits: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const env = { DB: { tag: "db" } } as unknown as Env;
  return {
    done: worker.scheduled?.(
      { cron, scheduledTime: 0, noRetry: () => {} } as ScheduledController,
      env,
      ctx,
    ),
    waits,
  };
}

describe("worker scheduled cron dispatch", () => {
  it("runs task reminders + content backfill on TASK_REMINDER_CRON", async () => {
    sendDueTaskReminders.mockClear();
    backfillMarkdownContent.mockClear();
    enqueueDueSourceRefreshes.mockClear();

    const { done, waits } = runScheduled(TASK_REMINDER_CRON);
    await done;
    await Promise.all(waits);

    expect(sendDueTaskReminders).toHaveBeenCalledTimes(1);
    expect(backfillMarkdownContent).toHaveBeenCalledTimes(1);
    expect(enqueueDueSourceRefreshes).not.toHaveBeenCalled();
  });

  it("enqueues source refreshes on SOURCE_REFRESH_CRON", async () => {
    sendDueTaskReminders.mockClear();
    backfillMarkdownContent.mockClear();
    enqueueDueSourceRefreshes.mockClear();

    const { done, waits } = runScheduled(SOURCE_REFRESH_CRON);
    await done;
    await Promise.all(waits);

    expect(enqueueDueSourceRefreshes).toHaveBeenCalledTimes(1);
    expect(sendDueTaskReminders).not.toHaveBeenCalled();
    expect(backfillMarkdownContent).not.toHaveBeenCalled();
  });
});
