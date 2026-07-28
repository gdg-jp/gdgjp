import { handleGooglePhotosImport } from "../../workers/google-photos-importer";
import type { Route } from "./+types/api.google-photos-import.$";

export async function action({ request, context }: Route.ActionArgs) {
  const authorization = request.headers.get("authorization");
  const token = context.cloudflare.env.GOOGLE_PHOTOS_IMPORT_TOKEN;
  if (!token || authorization !== `Bearer ${token}`)
    throw new Response("Unauthorized", { status: 401 });
  return handleGooglePhotosImport(request, context.cloudflare.env);
}
