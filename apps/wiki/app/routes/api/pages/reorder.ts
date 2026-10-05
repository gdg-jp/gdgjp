import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUser } from "~/features/auth/utils.server";
import { movePage } from "~/features/pages/move.server";

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
    await movePage(env, user, { pageId, newParentId, insertAfterId });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
