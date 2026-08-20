import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { startDaemon } from "../src/index.ts";
import { IndexStore } from "../src/indexer/store.ts";

async function rpc(socketPath: string, payload: object): Promise<unknown> {
  const client = createConnection(socketPath);
  client.setEncoding("utf8");
  const reply = await new Promise<string>((resolve, reject) => {
    client.once("error", reject);
    client.once("connect", () => {
      client.write(`${JSON.stringify(payload)}\n`);
    });
    let buffer = "";
    client.on("data", (data: string) => {
      buffer += data;
      if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")));
    });
  });
  client.end();
  return JSON.parse(reply) as unknown;
}

describe("startDaemon", () => {
  it("listens on each slot socket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agents-index-daemon-"));
    const store = new IndexStore(":memory:");
    const daemon = await startDaemon({
      store,
      embedder: { embed: async () => new Float32Array(384) },
      sourceMetadata: new Map(),
      endpoints: [
        { socketPath: join(dir, "0", "index.sock"), authzSocketPath: join(dir, "0", "authz.sock") },
        { socketPath: join(dir, "1", "index.sock"), authzSocketPath: join(dir, "1", "authz.sock") },
      ],
    });
    try {
      const first = (await rpc(join(dir, "0", "index.sock"), {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      })) as { result?: { serverInfo?: { name?: string } } };
      const second = (await rpc(join(dir, "1", "index.sock"), {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
      })) as { result?: { serverInfo?: { name?: string } } };
      expect(first.result?.serverInfo?.name).toBe("agents-index");
      expect(second.result?.serverInfo?.name).toBe("agents-index");
    } finally {
      await daemon.stop();
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
