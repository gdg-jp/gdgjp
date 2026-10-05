import type { SourceMetadata } from "../acl/frontmatter.ts";
import { resolvePrincipal } from "../authz.ts";
import type { Embedder } from "../indexer/embed.ts";
import type { IndexStore } from "../indexer/store.ts";
import { searchIndex } from "../search.ts";

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

export async function dispatchRequest(
  raw: string,
  input: {
    store: IndexStore;
    embedder: Embedder;
    sourceMetadata: ReadonlyMap<string, SourceMetadata>;
    authzSocketPath: string;
  },
): Promise<string> {
  let request: Request;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return error(null, "Invalid JSON-RPC request");
    }
    request = parsed as Request;
  } catch {
    return error(null, "Invalid JSON-RPC request");
  }
  if (request.method === "initialize") {
    return response(request.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "agents-index", version: "0.0.0" },
    });
  }
  if (request.method === "tools/list") {
    return response(request.id, {
      tools: [
        {
          name: "search",
          description: "Find ACL-visible local wiki paths. Results never include document text.",
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
    });
  }
  if (request.method !== "tools/call") {
    return error(request.id, "Method not found");
  }
  const params = request.params as { name?: unknown; arguments?: SearchParams } | null;
  if (params?.name !== "search" || typeof params.arguments?.query !== "string") {
    return error(request.id, "Invalid search input");
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
  return response(request.id, {
    content: [{ type: "text", text: JSON.stringify(results) }],
    structuredContent: { results },
  });
}
