import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import InputPanel from "~/components/ingest/InputPanel";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { isGoogleDriveUrl } from "~/lib/google-drive-utils";
import { buildIngestionQueueMessage } from "~/lib/ingestion-jobs.server";
import type { IngestionInputs } from "~/lib/ingestion-pipeline.server";
import { sendOrRunIngestion } from "~/lib/queue-processors.server";

export const meta: MetaFunction = () => [{ title: "Add Content — GDGoC Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const driveToken = await db
    .select({ userId: schema.googleDriveTokens.userId })
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, user.id))
    .get();

  // Count published pages for display
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.pages)
    .where(eq(schema.pages.status, "published"))
    .get();

  return {
    driveConnected: !!driveToken,
    pageCount: countResult?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PDFS = 3;
const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20 MB
const MIN_TEXT_LENGTH = 10;

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const formData = await request.formData();
  const text = String(formData.get("text") ?? "").trim();
  const googleDocUrl = String(formData.get("googleDocUrl") ?? "").trim();

  // Validate Google Drive URL format if provided
  if (googleDocUrl && !isGoogleDriveUrl(googleDocUrl)) {
    return { errorKey: "ingest.errors.invalid_drive_url" };
  }

  // Collect image files
  const imageEntries = formData.getAll("images");
  const imageFiles: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }> =
    [];

  if (imageEntries.length > MAX_IMAGES) {
    return { errorKey: "ingest.errors.too_many_images", errorParams: { max: MAX_IMAGES } };
  }

  // Collect PDF files
  const pdfEntries = formData.getAll("pdfs");
  const pdfFiles: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }> = [];

  if (pdfEntries.length > MAX_PDFS) {
    return { errorKey: "ingest.errors.too_many_pdfs", errorParams: { max: MAX_PDFS } };
  }

  // Validate text (skip if a Google Drive URL or PDF is provided)
  // We can't check pdfFiles.length yet (files not parsed), so check pdfEntries
  const hasPdfInput = pdfEntries.some((e) => e instanceof File && e.size > 0);
  if (!googleDocUrl && !hasPdfInput && text.length < MIN_TEXT_LENGTH) {
    return { errorKey: "ingest.errors.text_too_short", errorParams: { min: MIN_TEXT_LENGTH } };
  }

  const sessionId = nanoid();

  for (const entry of imageEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > MAX_IMAGE_SIZE) {
      return { errorKey: "ingest.errors.image_too_large", errorParams: { name: entry.name } };
    }
    const buffer = await entry.arrayBuffer();
    const key = `ingestion/${user.id}/${sessionId}/${crypto.randomUUID()}-${entry.name}`;
    // Store in R2
    await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: entry.type } });
    imageFiles.push({ key, buffer, mimeType: entry.type, name: entry.name });
  }

  for (const entry of pdfEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > MAX_PDF_SIZE) {
      return { errorKey: "ingest.errors.pdf_too_large", errorParams: { name: entry.name } };
    }
    if (entry.type !== "application/pdf") {
      return { errorKey: "ingest.errors.not_a_pdf", errorParams: { name: entry.name } };
    }
    const buffer = await entry.arrayBuffer();
    const key = `ingestion/${user.id}/${sessionId}/${crypto.randomUUID()}-${entry.name}`;
    await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: "application/pdf" } });
    pdfFiles.push({ key, buffer, mimeType: "application/pdf", name: entry.name });
  }

  // Build inputs
  const inputs: IngestionInputs = {
    texts: [text],
    imageKeys: imageFiles.map((f) => f.key),
    googleDocUrls: googleDocUrl ? [googleDocUrl] : [],
    imageFiles,
    pdfKeys: pdfFiles.map((f) => f.key),
    pdfFiles,
  };

  // Create session row
  await db.insert(schema.ingestionSessions).values({
    id: sessionId,
    userId: user.id,
    status: "processing",
    inputsJson: JSON.stringify({
      texts: inputs.texts,
      imageKeys: inputs.imageKeys,
      googleDocUrls: inputs.googleDocUrls,
      pdfKeys: inputs.pdfKeys,
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await sendOrRunIngestion(env, ctx, buildIngestionQueueMessage(sessionId, user.id, "initial"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("ingest: failed to enqueue ingestion job", { sessionId, userId: user.id, err });
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "error",
        errorMessage: `Queue enqueue failed: ${message}`,
        phaseMessage: "queue_enqueue_failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          eq(schema.ingestionSessions.userId, user.id),
        ),
      );
    return { errorKey: "ingest.errors.enqueue_failed" };
  }

  throw redirect(`/ingest/${sessionId}`);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IngestPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("ingest.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("ingest.description")}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <IngestForm />
      </div>
    </div>
  );
}

function IngestForm() {
  const { driveConnected } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  const serverError = actionData?.errorKey
    ? t(actionData.errorKey, actionData.errorParams as Record<string, unknown>)
    : undefined;

  return <InputPanel driveConnected={driveConnected} serverError={serverError} />;
}
