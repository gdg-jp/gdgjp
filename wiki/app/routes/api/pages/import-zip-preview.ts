import type { ActionFunctionArgs } from "react-router";
import { ZipImportError, previewZipImport } from "~/features/zip-import/import.server";
import { requireUser } from "~/lib/auth-utils.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  await requireUser(request, context.cloudflare.env);
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing_file" }, { status: 400 });
  try {
    return Response.json(previewZipImport(file.name, await file.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview ZIP file";
    return Response.json(
      { error: message },
      { status: error instanceof ZipImportError ? 400 : 422 },
    );
  }
}
