import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";

import type { SourceMetadata } from "./acl/frontmatter.ts";
import { resolvePrincipal } from "./authz.ts";
import type { Embedder } from "./indexer/embed.ts";
import type { IndexStore } from "./indexer/store.ts";
import { searchIndex } from "./search.ts";

type Request = {
  id?: string | number;
  method?: string;
  params?: unknown;
  nonce?: unknown;
};
type SearchParams = { query?: unknown; limit?: unknown; pathPrefix?: unknown };

function response(id: Request["id"], result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}
function error(id: Request["id"] | null, message: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } })}\n`;
}

export async function startDaemon(input: {
  socketPath: string;
  authzSocketPath: string;
  store: IndexStore;
  embedder: Embedder;
  sourceMetadata: ReadonlyMap<string, SourceMetadata>;
}): Promise<void> {
  await mkdir(dirname(input.socketPath), { recursive: true });
  await rm(input.socketPath, { force: true });
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
        input.authzSocketPath,
      );
      const results = await searchIndex({
        store: input.store,
        embedder: input.embedder,
        sourceMetadata: input.sourceMetadata,
        principal,
        query: params.arguments.query,
        limit: typeof params.arguments.limit === "number" ? params.arguments.limit : undefined,
        pathPrefix:
          typeof params.arguments.pathPrefix === "string" ? params.arguments.pathPrefix : undefined,
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
    server.listen(input.socketPath, resolve);
  });
}
