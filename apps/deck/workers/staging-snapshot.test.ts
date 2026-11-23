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
vi.stubGlobal("WebSocketRequestResponsePair", class {});

let DeckRoom: typeof import("./deck-room").DeckRoom;
let StagingSnapshot: typeof import("./staging-snapshot").StagingSnapshot;

beforeAll(async () => {
  ({ DeckRoom } = await import("./deck-room"));
  ({ StagingSnapshot } = await import("./staging-snapshot"));
});

function deployment(vars: { STAGING_SLOT?: string }) {
  const storages = new Map<string, FakeDurableObjectStorage>();
  const env = {
    ...vars,
    DB: {
      prepare: () => ({ all: async () => ({ results: [{ id: "deck-a" }, { id: "deck-b" }] }) }),
    },
  } as unknown as Env;
  const namespace = fakeNamespace((name) => {
    const storage = new FakeDurableObjectStorage();
    storages.set(name, storage);
    return new DeckRoom(fakeDurableObjectState(storage) as unknown as DurableObjectState, env);
  });
  Object.assign(env, { DECK: namespace });
  const entrypoint = new StagingSnapshot({} as ExecutionContext, env);
  return { entrypoint, storage: (name: string) => storages.get(name) };
}

describe("deck staging snapshot", () => {
  it("lists one DeckRoom per deck row", async () => {
    const { entrypoint } = deployment({});
    expect(await entrypoint.instances()).toEqual([
      { binding: "DECK", name: "deck-a" },
      { binding: "DECK", name: "deck-b" },
    ]);
  });

  it("refuses to import outside a staging slot", async () => {
    const { entrypoint, storage } = deployment({});
    const snapshot = { kv: [], tables: [], schema: [], alarm: null };
    await expect(entrypoint.importInstance("DECK", "deck-a", snapshot)).rejects.toThrow(
      /staging slot/,
    );
    expect(storage("deck-a")).toBeUndefined();
  });

  it("copies a deck's room state from production into staging", async () => {
    const production = deployment({});
    await production.entrypoint.exportInstance("DECK", "deck-a");
    const source = production.storage("deck-a");
    await source?.put({
      deck: { deck: { id: "deck-a", name: "Main", version: 3 }, layout: { boards: [] } },
      switches: { "key-1": true },
      log: [{ id: "log-1", at: 1, keyId: "key-1", title: "Go", by: "op", status: "ok" }],
    });
    const snapshot = await production.entrypoint.exportInstance("DECK", "deck-a");

    const staging = deployment({ STAGING_SLOT: "stg-1" });
    await staging.entrypoint.importInstance("DECK", "deck-a", snapshot);

    expect(await staging.entrypoint.exportInstance("DECK", "deck-a")).toEqual(snapshot);
    expect(await staging.storage("deck-a")?.get("switches")).toEqual({ "key-1": true });
    await expect(staging.entrypoint.exportInstance("OTHER", "deck-a")).rejects.toThrow(
      /Unknown Durable Object binding/,
    );
  });
});
