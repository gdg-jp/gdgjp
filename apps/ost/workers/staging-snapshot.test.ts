import {
  FakeDurableObjectStorage,
  fakeDurableObjectState,
  fakeNamespace,
} from "@gdgjp/gdg-lib/testing/durable-object";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock(
  "cloudflare:workers",
  async () => (await import("@gdgjp/gdg-lib/testing/durable-object")).cloudflareWorkersModule,
);

let OstBoard: typeof import("./ost-board").OstBoard;
let StagingSnapshot: typeof import("./staging-snapshot").StagingSnapshot;

beforeAll(async () => {
  ({ OstBoard } = await import("./ost-board"));
  ({ StagingSnapshot } = await import("./staging-snapshot"));
});

function deployment(vars: { STAGING_SLOT?: string }) {
  const boards = new Map<string, InstanceType<typeof OstBoard>>();
  const env = {
    ...vars,
    DB: {
      prepare: () => ({ all: async () => ({ results: [{ slug: "devfest" }, { slug: "io" }] }) }),
    },
  } as unknown as Env;
  const namespace = fakeNamespace((name) => {
    const board = new OstBoard(
      fakeDurableObjectState(new FakeDurableObjectStorage()) as unknown as DurableObjectState,
      env,
    );
    boards.set(name, board);
    return board;
  });
  Object.assign(env, { OST_BOARD: namespace });
  const entrypoint = new StagingSnapshot({} as ExecutionContext, env);
  const board = (name: string) => {
    namespace.getByName(name);
    const instance = boards.get(name);
    if (!instance) throw new Error(`no board ${name}`);
    return instance;
  };
  return { entrypoint, board, boards };
}

describe("ost staging snapshot", () => {
  it("lists one OstBoard per event slug", async () => {
    expect(await deployment({}).entrypoint.instances()).toEqual([
      { binding: "OST_BOARD", name: "devfest" },
      { binding: "OST_BOARD", name: "io" },
    ]);
  });

  it("refuses to import outside a staging slot", async () => {
    const { entrypoint, boards } = deployment({});
    const snapshot = { kv: [], tables: [], schema: [], alarm: null };
    await expect(entrypoint.importInstance("OST_BOARD", "devfest", snapshot)).rejects.toThrow(
      /staging slot/,
    );
    expect(boards.size).toBe(0);
  });

  it("copies topics, votes, groups, and desks into the staging board", async () => {
    const production = deployment({});
    const source = production.board("devfest");
    const first = source.submitTopic("Gemini on Workers");
    const second = source.submitTopic("Durable Objects");
    source.toggleVote(first.id, "voter-1");
    source.toggleVote(second.id, "voter-2");
    source.mergeTopics(second.id, first.id);
    source.addDesk({ x: 10, y: 20, label: "A" });
    source.autoAssignDesks();
    const snapshot = await production.entrypoint.exportInstance("OST_BOARD", "devfest");

    const staging = deployment({ STAGING_SLOT: "stg-2" });
    const target = staging.board("devfest");
    target.submitTopic("stale staging topic");
    await staging.entrypoint.importInstance("OST_BOARD", "devfest", snapshot);

    expect(target.listState()).toEqual(source.listState());
    expect(target.listVotesFor("voter-1")).toEqual([first.id]);
    expect(await staging.entrypoint.exportInstance("OST_BOARD", "devfest")).toEqual(snapshot);
  });
});
