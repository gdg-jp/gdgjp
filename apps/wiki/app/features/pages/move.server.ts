import type { AuthUser } from "~/features/auth/utils.server";

export async function movePage(
  env: Env,
  user: AuthUser,
  {
    pageId,
    newParentId,
    insertAfterId,
    append = false,
  }: { pageId: string; newParentId: string | null; insertAfterId: string | null; append?: boolean },
) {
  // Verify pageId exists and get its current parent + authorId for authz
  type PageRow = {
    id: string;
    parent_id: string | null;
    author_id: string;
    origin: string;
    page_type: string | null;
    status: string;
  };
  const page = (await env.DB.prepare(
    "SELECT id, parent_id, author_id, origin, page_type, status FROM pages WHERE id = ?",
  )
    .bind(pageId)
    .first()) as PageRow | null;
  if (!page || page.status !== "published") throw new Response("Page not found", { status: 404 });
  if (page.page_type === "wiki-index" || page.page_type === "wiki-log") {
    throw new Response("This page is maintained by the ingest toolchain", { status: 403 });
  }

  // Only the page author or an admin may move a page.
  if (!user.isAdmin && page.author_id !== user.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const oldParentId = page.parent_id;

  // Verify newParentId exists and isn't a descendant of pageId (circular check)
  if (newParentId) {
    type ParentRow = {
      id: string;
      author_id: string;
      origin: string;
      status: string;
      page_type: string | null;
    };
    const parent = (await env.DB.prepare(
      "SELECT id, author_id, origin, status, page_type FROM pages WHERE id = ?",
    )
      .bind(newParentId)
      .first()) as ParentRow | null;
    if (!parent || parent.status !== "published")
      throw new Response("Parent page not found", { status: 404 });
    if (parent.page_type === "wiki-index" || parent.page_type === "wiki-log")
      throw new Response("Forbidden", { status: 403 });
    if (page.origin === "agent" && parent.origin === "human") {
      throw Response.json({ error: "human_parent" }, { status: 400 });
    }
    // The caller also needs author/admin rights on the destination parent so
    // they can't slot pages into someone else's subtree.
    if (!user.isAdmin && parent.author_id !== user.id) {
      throw new Response("Forbidden", { status: 403 });
    }

    // Walk up from newParentId to root to detect circular reference
    type AncestorRow = { parent_id: string | null };
    let checkId: string | null = newParentId;
    const visited = new Set<string>();
    while (checkId) {
      if (visited.has(checkId)) throw new Response("Circular parent reference", { status: 400 });
      visited.add(checkId);
      if (checkId === pageId) throw new Response("Circular parent reference", { status: 400 });
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
  let insertAt = append ? siblings.length : 0;
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
      env.DB.prepare(
        "UPDATE pages SET parent_id = ?, acl_synced_with_parent = 0, updated_at = unixepoch() WHERE id = ?",
      ).bind(newParentId, pageId),
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE pages SET parent_id = NULL, acl_synced_with_parent = 1, updated_at = unixepoch() WHERE id = ?",
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
}
