import { getAsset } from "~/features/assets/asset.repository.server";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import type { Route } from "./+types/image";

/** The rendered PNG from R2, for campaign members only. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const asset = await getAsset(env.DB, access.campaign.id, Number(params.id));
  const object = asset?.r2Key ? await env.IMAGES.get(asset.r2Key) : null;
  if (!object) throw new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=300" },
  });
}
