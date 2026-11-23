import {
  FakeDurableObjectStorage,
  fakeDurableObjectState,
  fakeNamespace,
} from "@gdgjp/gdg-lib/testing/durable-object";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tracks } from "../app/features/clips/catalog";

vi.mock(
  "cloudflare:workers",
  async () => (await import("@gdgjp/gdg-lib/testing/durable-object")).cloudflareWorkersModule,
);
vi.stubGlobal("WebSocketRequestResponsePair", class {});

let McRoom: typeof import("./mc-room").McRoom;
let StagingSnapshot: typeof import("./staging-snapshot").StagingSnapshot;

beforeAll(async () => {
  ({ McRoom } = await import("./mc-room"));
  ({ StagingSnapshot } = await import("./staging-snapshot"));
});

function deployment(vars: { STAGING_SLOT?: string }) {
  const storages = new Map<string, FakeDurableObjectStorage>();
  const env = { ...vars } as unknown as Env;
  const namespace = fakeNamespace((name) => {
    const storage = new FakeDurableObjectStorage();
    storages.set(name, storage);
    return new McRoom(fakeDurableObjectState(storage) as unknown as DurableObjectState, env);
  });
  Object.assign(env, { MC_ROOM: namespace });
  const entrypoint = new StagingSnapshot({} as ExecutionContext, env);
  return { entrypoint, storage: (name: string) => storages.get(name) };
}

describe("mc staging snapshot", () => {
  it("lists one McRoom per bundled track under the room name the Worker uses", async () => {
    expect(tracks.length).toBeGreaterThan(0);
    expect(await deployment({}).entrypoint.instances()).toEqual(
      tracks.map((track) => ({ binding: "MC_ROOM", name: `track:${track}` })),
    );
  });

  it("refuses to import outside a staging slot", async () => {
    const { entrypoint, storage } = deployment({});
    const snapshot = { kv: [], tables: [], schema: [], alarm: null };
    await expect(entrypoint.importInstance("MC_ROOM", "track:a", snapshot)).rejects.toThrow(
      /staging slot/,
    );
    expect(storage("track:a")).toBeUndefined();
  });

  it("copies the player token, played clips, loops, and log into staging", async () => {
    const name = `track:${tracks[0]}`;
    const production = deployment({});
    await production.entrypoint.exportInstance("MC_ROOM", name);
    await production.storage(name)?.put({
      token: "player-token",
      played: { "clip-1": true },
      loops: { "clip-2": { from: 1, to: 2 } },
      log: [{ at: 1, level: "info", code: "played" }],
    });
    const snapshot = await production.entrypoint.exportInstance("MC_ROOM", name);

    const staging = deployment({ STAGING_SLOT: "stg-1" });
    await staging.entrypoint.importInstance("MC_ROOM", name, snapshot);

    expect(staging.storage(name)?.kv.get("token")).toBe("player-token");
    expect(await staging.entrypoint.exportInstance("MC_ROOM", name)).toEqual(snapshot);
  });
});
