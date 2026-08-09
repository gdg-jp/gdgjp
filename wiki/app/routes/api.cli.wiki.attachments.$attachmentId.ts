import { eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import type { components } from "../../openapi/types.generated";

type OkResponse = components["schemas"]["SyncResult"] extends { ok: infer TOk }
  ? { ok: TOk }
  : never;

async function permitted(request: Request, env: Env, attachmentId: string, write: boolean) {
  const identity = await getCliIdentity(request, env);
  if (!identity) return { error: new Response(null, { status: 401 }) };
  const db = getDb(env);
  const attachment = await db
    .select({
      id: schema.pageAttachments.id,
      pageId: schema.pageAttachments.pageId,
      r2Key: schema.pageAttachments.r2Key,
      fileName: schema.pageAttachments.fileName,
      mimeType: schema.pageAttachments.mimeType,
      page: schema.pages,
    })
    .from(schema.pageAttachments)
    .innerJoin(schema.pages, eq(schema.pageAttachments.pageId, schema.pages.id))
    .where(eq(schema.pageAttachments.id, attachmentId))
    .get();
  if (
    !attachment ||
    attachment.page.status === "archived" ||
    attachment.page.pageType === "task-list"
  ) {
    return { error: new Response(null, { status: 404 }) };
  }
  const permissions = await getEffectivePagePermissions(
    db,
    attachment.page,
    identity.user,
    identity.chapters,
  );
  if (write ? !permissions.canEdit : !permissions.canView)
    return { error: new Response(null, { status: 403 }) };
  return { identity, db, attachment };
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const result = await permitted(request, context.cloudflare.env, params.attachmentId ?? "", false);
  if ("error" in result) return result.error;
  const object = await context.cloudflare.env.BUCKET.get(result.attachment.r2Key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": result.attachment.mimeType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`,
    },
  });
}

/** PUT replaces bytes; DELETE removes the attachment.  Metadata is set by sync. */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const result = await permitted(request, context.cloudflare.env, params.attachmentId ?? "", true);
  if ("error" in result) return result.error;
  if (request.method === "DELETE") {
    await Promise.all([
      context.cloudflare.env.BUCKET.delete(result.attachment.r2Key),
      result.db
        .delete(schema.pageAttachments)
        .where(eq(schema.pageAttachments.id, result.attachment.id)),
    ]);
    const response: OkResponse = { ok: true };
    return Response.json(response);
  }
  if (request.method !== "PUT") return new Response(null, { status: 405 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 25 * 1024 * 1024)
    return Response.json({ error: "attachment_too_large" }, { status: 413 });
  await context.cloudflare.env.BUCKET.put(result.attachment.r2Key, bytes, {
    httpMetadata: {
      contentType: request.headers.get("content-type") || result.attachment.mimeType,
    },
  });
  // Touching page_attachments creates a new mirror revision.
  await result.db
    .update(schema.pageAttachments)
    .set({ fileName: result.attachment.fileName })
    .where(eq(schema.pageAttachments.id, result.attachment.id));
  const response: OkResponse = { ok: true };
  return Response.json(response);
}
