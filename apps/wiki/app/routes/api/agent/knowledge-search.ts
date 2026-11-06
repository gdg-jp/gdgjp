import type { LoaderFunctionArgs } from "react-router";
import { readerMaySeeSpace, resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import {
  KnowledgeSearchUnavailableError,
  MAX_SEARCH_SPACES,
} from "~/features/knowledge/search.server";
import { KNOWLEDGE_LAYERS, type KnowledgeLayer } from "~/features/knowledge/shared";
import { searchForReader } from "~/features/knowledge/viewer-search.server";
import { listAccessibleSpaces, resolveSpaceAccess } from "~/features/spaces/access.server";
import { getDb } from "~/lib/db.server";

/**
 * GET /api/agent/knowledge-search?q=…&space=gdg-jp,team&layers=page,acl,raw&limit=10
 *
 * Knowledge search for agent readers (Stage 05): a user token, the agent Worker as a guild /
 * Chat-space principal, or an answer job's token (runner MCP). The
 * caller's reachable spaces and readable audiences are computed HERE from its identity;
 * the request can only narrow them (space / layers), never widen them.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env);
  const agentReader = await resolveAgentReader(request, env, db, { allowJobToken: true });
  if (!agentReader) return Response.json({ error: "invalid_token" }, { status: 401 });
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) return Response.json({ error: "q_required" }, { status: 400 });

  const reader = agentReader.identity;
  const access = await resolveSpaceAccess(db, reader, agentReader.extraPrincipals);
  const reachable = (await listAccessibleSpaces(db, access)).filter((space) =>
    readerMaySeeSpace(agentReader, space.slug),
  );
  const requested = url.searchParams
    .get("space")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const spaces = requested?.length
    ? reachable.filter((space) => requested.includes(space.slug))
    : reachable;
  if (requested?.length && spaces.length === 0) {
    return Response.json({ error: "space_not_found" }, { status: 404 });
  }
  const layers = (url.searchParams.get("layers") ?? "page,acl")
    .split(",")
    .filter((layer): layer is KnowledgeLayer => KNOWLEDGE_LAYERS.includes(layer as KnowledgeLayer));
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "10") || 10, 25);

  try {
    const { pages, raw } = await searchForReader(env, db, reader, {
      spaceIds: spaces.slice(0, MAX_SEARCH_SPACES).map((space) => space.id),
      query,
      layers,
      maxResults: limit,
      rewrite: true,
    });
    const spaceSlug = new Map(spaces.map((space) => [space.id, space.slug]));
    return Response.json({
      query,
      spaces: spaces.slice(0, MAX_SEARCH_SPACES).map((space) => space.slug),
      truncatedSpaces: spaces.length > MAX_SEARCH_SPACES,
      pages: pages.map((page) => ({
        space: spaceSlug.get(page.spaceId),
        slug: page.slug,
        title: page.titleJa || page.titleEn,
        url: page.url,
        origin: page.origin,
        score: page.relevanceScore,
        snippets: page.matchedChunks.map((chunk) => chunk.text),
      })),
      raw: raw.map((doc) => ({
        space: spaceSlug.get(doc.spaceId),
        sourceId: doc.sourceId,
        documentId: doc.documentId,
        title: doc.title,
        source: doc.sourceTitle,
        url: doc.url,
        score: doc.score,
        snippet: doc.text,
      })),
    });
  } catch (error) {
    if (error instanceof KnowledgeSearchUnavailableError) {
      return Response.json({ error: "search_unavailable" }, { status: 503 });
    }
    throw error;
  }
}
