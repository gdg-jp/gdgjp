import { handleApexRedirect } from "~/features/links/redirect-handler";
import type { Route } from "./+types/$slug";

export async function loader(args: Route.LoaderArgs) {
  const { env, ctx } = args.context.cloudflare;
  const host = new URL(args.request.url).host;
  const apexHost = new URL(env.SHORT_URL_BASE).host;
  if (host !== apexHost) throw new Response(null, { status: 404 });
  const slug = args.params.slug ?? "";
  if (!slug) throw new Response(null, { status: 404 });
  const response = await handleApexRedirect(env, ctx, args.request, slug);
  if (response) return response;
  throw new Response(null, { status: 404 });
}

export default function SlugRedirect() {
  return null;
}
