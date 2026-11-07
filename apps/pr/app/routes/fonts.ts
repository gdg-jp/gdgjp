import type { Route } from "./+types/fonts";

/**
 * GET /fonts/:file — the design fonts (SIL OFL: Google Sans Flex, LINE Seed JP, Google Sans Code)
 * from R2 `fonts/`, for the rendered images' @font-face. Public and cacheable; CORS because the
 * rendering page has no origin of its own.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const file = params.file ?? "";
  if (!/^[\w-]+\.(ttf|otf|woff2?|txt)$/.test(file)) throw new Response(null, { status: 404 });
  const object = await env.IMAGES.get(`fonts/${file}`);
  if (!object) throw new Response(null, { status: 404 });
  const types: Record<string, string> = {
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
    txt: "text/plain; charset=utf-8",
  };
  return new Response(object.body, {
    headers: {
      "Content-Type": types[file.split(".").pop() ?? ""] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
