import {
  FakeDurableObjectStorage,
  fakeDurableObjectState,
  fakeNamespace,
} from "@gdgjp/gdg-lib/testing/durable-object";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { emptyRoom } from "../app/features/stage/room-state";

vi.mock(
  "cloudflare:workers",
  async () => (await import("@gdgjp/gdg-lib/testing/durable-object")).cloudflareWorkersModule,
);
vi.stubGlobal("WebSocketRequestResponsePair", class {});

let StageRoom: typeof import("./stage-room").StageRoom;
let StagingSnapshot: typeof import("./staging-snapshot").StagingSnapshot;

beforeAll(async () => {
  ({ StageRoom } = await import("./stage-room"));
  ({ StagingSnapshot } = await import("./staging-snapshot"));
});

function deployment(vars: { STAGING_SLOT?: string }) {
  const storages = new Map<string, FakeDurableObjectStorage>();
  const env = {
    ...vars,
    DB: {
      prepare: () => ({ all: async () => ({ results: [{ id: "main-stage" }] }) }),
    },
  } as unknown as Env;
  const namespace = fakeNamespace((name) => {
    const storage = new FakeDurableObjectStorage();
    storages.set(name, storage);
    return new StageRoom(fakeDurableObjectState(storage) as unknown as DurableObjectState, env);
  });
  Object.assign(env, { STAGE: namespace });
  const entrypoint = new StagingSnapshot({} as ExecutionContext, env);
  return { entrypoint, storage: (name: string) => storages.get(name) };
}

describe("screen staging snapshot", () => {
  it("lists one StageRoom per stage row", async () => {
    expect(await deployment({}).entrypoint.instances()).toEqual([
      { binding: "STAGE", name: "main-stage" },
    ]);
  });

  it("refuses to import outside a staging slot", async () => {
    const { entrypoint, storage } = deployment({});
    const snapshot = { kv: [], tables: [], schema: [], alarm: null };
    await expect(entrypoint.importInstance("STAGE", "main-stage", snapshot)).rejects.toThrow(
      /staging slot/,
    );
    expect(storage("main-stage")).toBeUndefined();
  });

  it("copies the stage room and its metadata into staging", async () => {
    const production = deployment({});
    await production.entrypoint.exportInstance("STAGE", "main-stage");
    const room = { ...emptyRoom(), onAir: true };
    const meta = { id: "main-stage", name: "Main", slotCount: 2 };
    await production.storage("main-stage")?.put({ room, meta });
    const snapshot = await production.entrypoint.exportInstance("STAGE", "main-stage");

    const staging = deployment({ STAGING_SLOT: "stg-3" });
    await staging.entrypoint.importInstance("STAGE", "main-stage", snapshot);

    expect(staging.storage("main-stage")?.kv.get("room")).toEqual(room);
    expect(staging.storage("main-stage")?.kv.get("meta")).toEqual(meta);
    expect(await staging.entrypoint.exportInstance("STAGE", "main-stage")).toEqual(snapshot);
  });
});
