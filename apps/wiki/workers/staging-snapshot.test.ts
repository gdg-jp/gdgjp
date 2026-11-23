import {
  FakeDurableObjectStorage,
  fakeDurableObjectState,
  fakeNamespace,
} from "@gdgjp/gdg-lib/testing/durable-object";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { SourceImportDurableObject as SourceImportClass } from "./source-import-durable-object";

vi.mock(
  "cloudflare:workers",
  async () => (await import("@gdgjp/gdg-lib/testing/durable-object")).cloudflareWorkersModule,
);

let CollabDurableObject: typeof import("./collab-durable-object").CollabDurableObject;
let SourceImportDurableObject: typeof SourceImportClass;
let StagingSnapshot: typeof import("./staging-snapshot").StagingSnapshot;

beforeAll(async () => {
  ({ CollabDurableObject } = await import("./collab-durable-object"));
  ({ SourceImportDurableObject } = await import("./source-import-durable-object"));
  ({ StagingSnapshot } = await import("./staging-snapshot"));
});

type CollabInternals = {
  initialize(spaceSlug: string, slug: string): Promise<void>;
  ydoc: Y.Doc;
};

const ROWS: Record<string, unknown[]> = {
  pages: [
    { space_id: "gdg-jp", slug: "welcome" },
    { space_id: "tokyo", slug: "welcome" },
  ],
  sources: [{ id: "source-1" }],
};

function deployment(vars: { STAGING_SLOT?: string }) {
  const storages = new Map<string, FakeDurableObjectStorage>();
  const env = {
    ...vars,
    DB: {
      prepare: (sql: string) => ({
        all: async () => ({ results: ROWS[/FROM (\w+)/.exec(sql)?.[1] ?? ""] ?? [] }),
      }),
    },
  } as unknown as Env;
  const state = (key: string) => {
    const storage = new FakeDurableObjectStorage();
    storages.set(key, storage);
    return fakeDurableObjectState(storage) as unknown as DurableObjectState;
  };
  const collab = fakeNamespace((name) => new CollabDurableObject(state(`collab:${name}`), env));
  const sources = fakeNamespace(
    (name) => new SourceImportDurableObject(state(`source:${name}`), env),
  );
  Object.assign(env, { COLLAB_DO: collab, SOURCE_IMPORT_DO: sources });
  const entrypoint = new StagingSnapshot({} as ExecutionContext, env);
  return {
    entrypoint,
    storage: (key: string) => storages.get(key),
    room: (name: string) => {
      collab.getByName(name);
      return collab.instances.get(name) as unknown as CollabInternals;
    },
  };
}

function yjsState(text: string): ArrayBuffer {
  const doc = new Y.Doc();
  doc.getText("contentJa").insert(0, text);
  return Y.encodeStateAsUpdate(doc).slice().buffer;
}

describe("wiki staging snapshot", () => {
  it("lists collab rooms by room name and source imports by source id", async () => {
    expect(await deployment({}).entrypoint.instances()).toEqual([
      { binding: "COLLAB_DO", name: "welcome" },
      { binding: "COLLAB_DO", name: "tokyo/welcome" },
      { binding: "SOURCE_IMPORT_DO", name: "source-1" },
    ]);
  });

  it("refuses to import outside a staging slot", async () => {
    const { entrypoint, storage } = deployment({});
    const snapshot = { kv: [], tables: [], schema: [], alarm: null };
    for (const binding of ["COLLAB_DO", "SOURCE_IMPORT_DO"])
      await expect(entrypoint.importInstance(binding, "source-1", snapshot)).rejects.toThrow(
        /staging slot/,
      );
    expect(storage("collab:source-1")).toBeUndefined();
    expect(storage("source:source-1")).toBeUndefined();
  });

  it("replaces a collab room's stored and in-memory document", async () => {
    const production = deployment({});
    await production.entrypoint.exportInstance("COLLAB_DO", "welcome");
    await production.storage("collab:welcome")?.put("yjs-state", yjsState("production text"));
    const snapshot = await production.entrypoint.exportInstance("COLLAB_DO", "welcome");

    const staging = deployment({ STAGING_SLOT: "stg-1" });
    const room = staging.room("welcome");
    await staging.storage("collab:welcome")?.put("yjs-state", yjsState("stale staging text"));
    await room.initialize("gdg-jp", "welcome");
    expect(room.ydoc.getText("contentJa").toString()).toBe("stale staging text");

    await staging.entrypoint.importInstance("COLLAB_DO", "welcome", snapshot);

    expect(await staging.entrypoint.exportInstance("COLLAB_DO", "welcome")).toEqual(snapshot);
    await room.initialize("gdg-jp", "welcome");
    expect(room.ydoc.getText("contentJa").toString()).toBe("production text");
  });

  it("copies an in-flight source import with its SQL tables and alarm", async () => {
    const production = deployment({});
    await production.entrypoint.exportInstance("SOURCE_IMPORT_DO", "source-1");
    const source = production.storage("source:source-1");
    source?.sql.exec(
      "INSERT INTO drive_units (id, unit_kind, path, title, media_type, sort_index) VALUES (1, 'doc', 'a.md', 'A', 'text/markdown', 0)",
    );
    source?.sql.exec(
      "INSERT INTO drive_images (unit_id, object_id, source_url) VALUES (1, 'img-1', 'https://example.com/a.png')",
    );
    await source?.put("runId", "run-1");
    await source?.setAlarm(1_800_000_000_000);
    const snapshot = await production.entrypoint.exportInstance("SOURCE_IMPORT_DO", "source-1");
    expect(snapshot.alarm).toBe(1_800_000_000_000);

    const staging = deployment({ STAGING_SLOT: "stg-1" });
    await staging.entrypoint.importInstance("SOURCE_IMPORT_DO", "source-1", snapshot);

    expect(await staging.entrypoint.exportInstance("SOURCE_IMPORT_DO", "source-1")).toEqual(
      snapshot,
    );
    const target = staging.storage("source:source-1");
    expect(await target?.get("runId")).toBe("run-1");
    expect(await target?.getAlarm()).toBe(1_800_000_000_000);

    await staging.entrypoint.importInstance("SOURCE_IMPORT_DO", "source-1", {
      kv: [],
      tables: [],
      schema: [],
      alarm: null,
    });
    expect(target?.sql.exec("SELECT count(*) AS n FROM drive_units").one()).toEqual({ n: 0 });
    expect(await target?.getAlarm()).toBeNull();
  });
});
