import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { generateSlug } from "~/features/ingestion/slug";
import { getDb } from "~/lib/db.server";
import { isAutoTranslateEnabled } from "~/lib/queue-processors.server";
import { basename, rewriteLinks } from "./zip-helpers";
import type { ImagePlan, ZipImportPreview } from "./zip-parse.server";
import { parseImport } from "./zip-parse.server";

export { ZipImportError } from "./zip-helpers";
export type { ZipImportPreview } from "./zip-parse.server";
export { MAX_ZIP_SIZE, previewZipImport } from "./zip-parse.server";

export interface ZipImportResult extends ZipImportPreview {
  rootSlug: string;
  createdPages: number;
  uploadedImages: number;
}

async function uniqueSlug(env: Env, title: string, reserved: Set<string>): Promise<string> {
  const db = getDb(env);
  const base = generateSlug(title);
  let slug = base;
  while (
    reserved.has(slug) ||
    (await db.query.pages.findFirst({ where: (pages, { eq }) => eq(pages.slug, slug) }))
  ) {
    slug = `${base}-${nanoid(6)}`;
  }
  reserved.add(slug);
  return slug;
}

export async function importZip(
  env: Env,
  userId: string,
  fileName: string,
  bytes: ArrayBuffer,
): Promise<ZipImportResult> {
  const parsed = parseImport(fileName, bytes);
  const db = getDb(env);
  const ids = new Map<string, string>();
  const slugs = new Map<string, string>();
  const reserved = new Set<string>();
  for (const page of parsed.pages) {
    ids.set(page.key, nanoid());
    slugs.set(page.key, await uniqueSlug(env, page.title, reserved));
  }
  const imageUrls = new Map<string, string>();
  const uploadErrors: string[] = [];
  const uploaded: Array<{ image: ImagePlan; r2Key: string }> = [];
  for (const image of parsed.images) {
    const ownerId = ids.get(image.ownerKey) as string;
    const safeName = basename(image.path).replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key = `wiki/${ownerId}/zip-import/${nanoid(8)}-${safeName}`;
    try {
      await env.BUCKET.put(r2Key, image.bytes, { httpMetadata: { contentType: image.mimeType } });
      imageUrls.set(image.path, `/api/images/${r2Key}`);
      if (parsed.rootDirectory)
        imageUrls.set(`${parsed.rootDirectory}/${image.path}`, `/api/images/${r2Key}`);
      uploaded.push({ image, r2Key });
    } catch {
      uploadErrors.push(`${image.path} (upload failed)`);
    }
  }
  const pageUrls = new Map<string, string>();
  for (const page of parsed.pages) {
    const url = `/wiki/${slugs.get(page.key)}`;
    pageUrls.set(page.key, url);
    if (page.sourcePath) pageUrls.set(page.sourcePath, url);
    if (parsed.rootDirectory) {
      if (page.key === "") pageUrls.set(parsed.rootDirectory, url);
      pageUrls.set(`${parsed.rootDirectory}/${page.key}`, url);
      if (page.sourcePath) pageUrls.set(`${parsed.rootDirectory}/${page.sourcePath}`, url);
    }
  }
  const references = new Map<string, Set<string>>();
  for (const page of parsed.pages) {
    if (!page.sourcePath || !page.content) continue;
    const referenced = new Set<string>();
    page.content = rewriteLinks(page.content, page.sourcePath, pageUrls, imageUrls, referenced);
    references.set(page.key, referenced);
  }
  for (const page of parsed.pages) {
    await db.insert(schema.pages).values({
      id: ids.get(page.key) as string,
      titleJa: page.title,
      titleEn: "",
      slug: slugs.get(page.key) as string,
      contentJa: page.content,
      contentEn: "",
      status: "published",
      visibility: "restricted",
      generalRole: "viewer",
      parentId: page.parentKey === null ? null : (ids.get(page.parentKey) ?? null),
      aclSyncedWithParent: page.parentKey === null,
      sortOrder: page.sortOrder,
      origin: "human",
      chapterId: null,
      authorId: userId,
      lastEditedBy: userId,
    });
  }
  for (const { image, r2Key } of uploaded) {
    const attachedTo = new Set<string>([image.ownerKey]);
    for (const [pageKey, referencesForPage] of references) {
      if (
        referencesForPage.has(image.path) ||
        (parsed.rootDirectory && referencesForPage.has(`${parsed.rootDirectory}/${image.path}`))
      ) {
        attachedTo.add(pageKey);
      }
    }
    for (const pageKey of attachedTo) {
      await db.insert(schema.pageAttachments).values({
        id: nanoid(),
        pageId: ids.get(pageKey) as string,
        r2Key,
        fileName: basename(image.path),
        mimeType: image.mimeType,
        createdAt: new Date(),
      });
    }
  }
  if (isAutoTranslateEnabled(env)) {
    for (const page of parsed.pages) {
      try {
        await env.TRANSLATION_QUEUE.send({ pageId: ids.get(page.key) as string });
      } catch {
        // Imported Japanese content remains usable when translation is temporarily unavailable.
      }
    }
  }
  return {
    ...parsed.preview,
    skipped: [...parsed.preview.skipped, ...uploadErrors],
    rootSlug: slugs.get("") as string,
    createdPages: parsed.pages.length,
    uploadedImages: uploaded.length,
  };
}
