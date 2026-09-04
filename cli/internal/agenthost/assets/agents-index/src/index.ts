import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { dirname } from "node:path";

import type { SourceMetadata } from "./acl/frontmatter.ts";
import { resolvePrincipal } from "./authz.ts";
import type { Embedder } from "./indexer/embed.ts";
import type { IndexStore } from "./indexer/store.ts";
import { searchIndex } from "./search.ts";
import { applyIndexSocketAccess } from "./socket-access.ts";

type Request = {
  id?: string | number;
  method?: string;
  params?: unknown;
  nonce?: unknown;
};
type SearchParams = { query?: unknown; limit?: unknown; pathPrefix?: unknown };

export type IndexEndpoint = {
  socketPath: string;
  authzSocketPath: string;
  socketGroup?: string;
};

function response(id: Request["id"], result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}
function error(id: Request["id"] | null, message: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } })}\n`;
}

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
        let request: Request;
        try {
          request = JSON.parse(raw) as Request;
        } catch {
          socket.write(error(null, "Invalid JSON-RPC request"));
          return;
        }
        if (request.method === "initialize") {
          socket.write(
            response(request.id, {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "agents-index", version: "0.0.0" },
            }),
          );
          return;
        }
        if (request.method === "tools/list") {
          socket.write(
            response(request.id, {
              tools: [
                {
                  name: "search",
                  description:
                    "Find ACL-visible local wiki paths. Results never include document text.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      limit: { type: "integer", minimum: 1, maximum: 50 },
                      pathPrefix: { type: "string" },
                    },
                    required: ["query"],
                    additionalProperties: false,
                  },
                },
              ],
            }),
          );
          return;
        }
        if (request.method !== "tools/call") {
          socket.write(error(request.id, "Method not found"));
          return;
        }
        const params = request.params as { name?: unknown; arguments?: SearchParams } | null;
        if (params?.name !== "search" || typeof params.arguments?.query !== "string") {
          socket.write(error(request.id, "Invalid search input"));
          return;
        }
        // The client can choose a nonce but never the authz endpoint. The latter is
        // service configuration; otherwise an agent could point us at a fake socket.
        const principal = await resolvePrincipal(
          typeof request.nonce === "string" ? request.nonce : undefined,
          endpoint.authzSocketPath,
        );
        const results = await searchIndex({
          store: input.store,
          embedder: input.embedder,
          sourceMetadata: input.sourceMetadata,
          principal,
          query: params.arguments.query,
          limit: typeof params.arguments.limit === "number" ? params.arguments.limit : undefined,
          pathPrefix:
            typeof params.arguments.pathPrefix === "string"
              ? params.arguments.pathPrefix
              : undefined,
        });
        socket.write(
          response(request.id, {
            content: [{ type: "text", text: JSON.stringify(results) }],
            structuredContent: { results },
          }),
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
