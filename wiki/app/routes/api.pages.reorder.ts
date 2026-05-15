import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth-utils.server";

const BodySchema = z.object({
  pageId: z.string().min(1),
  newParentId: z.string().nullable(),
  insertAfterId: z.string().nullable(),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const { pageId, newParentId, insertAfterId } = parsed.data;

  // Verify pageId exists and get its current parent + authorId for authz
  type PageRow = { id: string; parent_id: string | null; author_id: string };
  const page = (await env.DB.prepare("SELECT id, parent_id, author_id FROM pages WHERE id = ?")
    .bind(pageId)
    .first()) as PageRow | null;
  if (!page) return new Response("Page not found", { status: 404 });

  // Only the page author or an admin may move a page.
  if (!user.isAdmin && page.author_id !== user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const oldParentId = page.parent_id;

  // Verify newParentId exists and isn't a descendant of pageId (circular check)
  if (newParentId) {
    type ParentRow = { id: string; author_id: string };
    const parent = (await env.DB.prepare("SELECT id, author_id FROM pages WHERE id = ?")
      .bind(newParentId)
      .first()) as ParentRow | null;
    if (!parent) return new Response("Parent page not found", { status: 404 });
    // The caller also needs author/admin rights on the destination parent so
    // they can't slot pages into someone else's subtree.
    if (!user.isAdmin && parent.author_id !== user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    // Walk up from newParentId to root to detect circular reference
    type AncestorRow = { parent_id: string | null };
    let checkId: string | null = newParentId;
    while (checkId) {
      if (checkId === pageId) return new Response("Circular parent reference", { status: 400 });
      const row = (await env.DB.prepare("SELECT parent_id FROM pages WHERE id = ?")
        .bind(checkId)
        .first()) as AncestorRow | null;
      checkId = row?.parent_id ?? null;
    }
  }

  // Fetch current siblings at the new parent (excluding the moved page)
  type IdRow = { id: string };
  const siblingRows = newParentId
    ? ((await env.DB.prepare(
        "SELECT id FROM pages WHERE parent_id = ? AND id != ? ORDER BY sort_order, id",
      )
        .bind(newParentId, pageId)
        .all()) as D1Result<IdRow>)
    : ((await env.DB.prepare(
        "SELECT id FROM pages WHERE parent_id IS NULL AND id != ? ORDER BY sort_order, id",
      )
        .bind(pageId)
        .all()) as D1Result<IdRow>);

  const siblings = siblingRows.results.map((r) => r.id);

  // Insert pageId after insertAfterId (or at start if null)
  let insertAt = 0;
  if (insertAfterId) {
    const idx = siblings.indexOf(insertAfterId);
    insertAt = idx === -1 ? siblings.length : idx + 1;
  }
  siblings.splice(insertAt, 0, pageId);

  // Build batch statements
  const statements: D1PreparedStatement[] = [];

  // Renumber new parent's children
  for (let i = 0; i < siblings.length; i++) {
    statements.push(
      env.DB.prepare("UPDATE pages SET sort_order = ?, updated_at = unixepoch() WHERE id = ?").bind(
        i,
        siblings[i],
      ),
    );
  }

  // Update moved page's parent_id
  if (newParentId) {
    statements.push(
      env.DB.prepare("UPDATE pages SET parent_id = ?, updated_at = unixepoch() WHERE id = ?").bind(
        newParentId,
        pageId,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE pages SET parent_id = NULL, updated_at = unixepoch() WHERE id = ?",
      ).bind(pageId),
    );
  }

  // If parent changed, renumber old parent's remaining children
  if (oldParentId !== newParentId) {
    const oldSiblingRows = oldParentId
      ? ((await env.DB.prepare(
          "SELECT id FROM pages WHERE parent_id = ? AND id != ? ORDER BY sort_order, id",
        )
          .bind(oldParentId, pageId)
          .all()) as D1Result<IdRow>)
      : ((await env.DB.prepare(
          "SELECT id FROM pages WHERE parent_id IS NULL AND id != ? ORDER BY sort_order, id",
        )
          .bind(pageId)
          .all()) as D1Result<IdRow>);

    for (let i = 0; i < oldSiblingRows.results.length; i++) {
      statements.push(
        env.DB.prepare(
          "UPDATE pages SET sort_order = ?, updated_at = unixepoch() WHERE id = ?",
        ).bind(i, oldSiblingRows.results[i].id),
      );
    }
  }

  await env.DB.batch(statements);
  return Response.json({ ok: true });
}
