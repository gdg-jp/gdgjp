import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { ZipImportError, importZip } from "~/features/zip-import/import.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing_file" }, { status: 400 });
  try {
    return Response.json(await importZip(env, user.id, file.name, await file.arrayBuffer()), {
      status: 201,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import ZIP file";
    console.error("[zip-import] request failed", { userId: user.id, error: message });
    return Response.json(
      { error: message },
      { status: error instanceof ZipImportError ? 400 : 422 },
    );
  }
}
