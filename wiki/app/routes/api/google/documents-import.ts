import type { ActionFunctionArgs } from "react-router";
import { enqueueGoogleDocumentImport } from "~/features/google-documents/import.server";
import { requireUser } from "~/lib/auth-utils.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const body = (await request.json().catch(() => null)) as { documentId?: unknown } | null;
  if (!body || typeof body.documentId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(body.documentId)) {
    return Response.json({ error: "invalid_document_id" }, { status: 400 });
  }
  try {
    const job = await enqueueGoogleDocumentImport(env, body.documentId, user);
    return Response.json(job, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import Google Document";
    console.error(
      JSON.stringify({
        component: "google-document-import",
        event: "request_failed",
        documentId: body.documentId,
        userId: user.id,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: message,
      }),
    );
    const status = message.includes("original importer") ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}
