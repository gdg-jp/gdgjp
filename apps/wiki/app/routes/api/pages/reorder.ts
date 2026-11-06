import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { movePage } from "~/features/pages/move.server";
import { requirePageSpace } from "~/features/spaces/access.server";
import { getDb } from "~/lib/db.server";

const BodySchema = z.object({
  pageId: z.string().min(1),
  newParentId: z.string().nullable(),
  insertAfterId: z.string().nullable(),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const { pageId, newParentId, insertAfterId } = parsed.data;

  try {
    // Reordering edits the tree of the page's space.
    await requirePageSpace(getDb(env), await getAccessIdentity(request, env), pageId, "editor");
    await movePage(env, user, { pageId, newParentId, insertAfterId });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
