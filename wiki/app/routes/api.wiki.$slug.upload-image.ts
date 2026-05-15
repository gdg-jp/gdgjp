import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const slug = params.slug ?? "";
  const page = await db
    .select({ id: schema.pages.id, status: schema.pages.status, authorId: schema.pages.authorId })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug))
    .get();

  if (!page) {
    return new Response("Not Found", { status: 404 });
  }

  if (page.status === "archived") {
    return new Response("Not Found", { status: 404 });
  }

  const canEditAny = user.isAdmin;
  if (!canEditAny && page.authorId !== user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("image");

  if (!(file instanceof File)) {
    return new Response("Missing image field", { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return new Response("Only image files are allowed", { status: 400 });
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return new Response("Image too large (max 10 MB)", { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const safeName = `${nanoid(8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const r2Key = `wiki/${page.id}/${safeName}`;

  await env.BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: file.type },
  });

  await db.insert(schema.pageAttachments).values({
    id: nanoid(),
    pageId: page.id,
    r2Key,
    fileName: file.name,
    mimeType: file.type,
    createdAt: new Date(),
  });

  return Response.json({ url: `/api/images/${r2Key}` });
}
