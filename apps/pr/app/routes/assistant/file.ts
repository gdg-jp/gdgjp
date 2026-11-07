import { fileKey } from "~/features/assistant/fetch-source.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import type { Route } from "./+types/file";

/** GET /c/:slug/files/:id — an attachment or a saved source image, for campaign members only. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const id = params.id ?? "";
  if (!/^(att|src)-[\w-]{1,40}$/.test(id)) throw new Response(null, { status: 404 });
  const object = await env.IMAGES.get(fileKey(access.campaign.id, id));
  if (!object) throw new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
