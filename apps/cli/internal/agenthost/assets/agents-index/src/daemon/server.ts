import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { dirname } from "node:path";

import type { SourceMetadata } from "../acl/frontmatter.ts";
import type { Embedder } from "../indexer/embed.ts";
import type { IndexStore } from "../indexer/store.ts";
import { dispatchRequest } from "./rpc.ts";
import { applyIndexSocketAccess } from "./socket-access.ts";

export type IndexEndpoint = {
  socketPath: string;
  authzSocketPath: string;
  socketGroup?: string;
};

function endpointsFrom(input: {
  endpoints?: IndexEndpoint[];
  socketPath?: string;
  authzSocketPath?: string;
}): IndexEndpoint[] {
  if (input.endpoints?.length) return input.endpoints;
  if (input.socketPath && input.authzSocketPath) {
    return [{ socketPath: input.socketPath, authzSocketPath: input.authzSocketPath }];
  }
  throw new Error("startDaemon requires endpoints or socketPath+authzSocketPath");
}

export async function startDaemon(input: {
  store: IndexStore;
  embedder: Embedder;
  sourceMetadata: ReadonlyMap<string, SourceMetadata>;
  endpoints?: IndexEndpoint[];
  socketPath?: string;
  authzSocketPath?: string;
}): Promise<{ stop(): Promise<void> }> {
  const endpoints = endpointsFrom(input);
  const servers: Server[] = [];
  const socketPaths = endpoints.map((endpoint) => endpoint.socketPath);

  for (const endpoint of endpoints) {
    await mkdir(dirname(endpoint.socketPath), { recursive: true });
    await rm(endpoint.socketPath, { force: true });
    const server = createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (data: string) => {
        buffer += data;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const raw = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          void handle(raw);
        }
      });
      const handle = async (raw: string) => {
        socket.write(
          await dispatchRequest(raw, { ...input, authzSocketPath: endpoint.authzSocketPath }),
        );
      };
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint.socketPath, resolve);
    });
    await applyIndexSocketAccess(endpoint.socketPath, endpoint.socketGroup);
    servers.push(server);
  }

  return {
    async stop() {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
            }),
        ),
      );
      await Promise.all(socketPaths.map((socketPath) => rm(socketPath, { force: true })));
    },
  };
}
