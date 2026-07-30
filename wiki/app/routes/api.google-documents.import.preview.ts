import type { ActionFunctionArgs } from "react-router";
import { previewGoogleDocumentImport } from "~/features/google-documents/import.server";
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
    return Response.json(
      await previewGoogleDocumentImport(env, body.documentId, user.id, Boolean(user.isAdmin)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview Google Document";
    const status = message.includes("original importer") ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}
