import type { Route } from "./+types/mock-services";
import { isLocalDev } from "./local";

type Mock = { mockState(): Promise<unknown>; mockPublish?(postId: string): Promise<boolean> };

/** e2e: what the local sns / tinyurl stand-ins received (e2e/mock-services). 404 elsewhere. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (!isLocalDev(env, request)) throw new Response(null, { status: 404 });
  const sns = env.SNS as unknown as Mock;
  const tinyurl = env.TINYURL as unknown as Mock;
  return Response.json({ sns: await sns.mockState(), tinyurl: await tinyurl.mockState() });
}

/** e2e: mark a mock sns post published (`publish=<postId>`). */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!isLocalDev(env, request)) throw new Response(null, { status: 404 });
  const form = await request.formData();
  const sns = env.SNS as unknown as Required<Mock>;
  return Response.json({ published: await sns.mockPublish(String(form.get("publish") ?? "")) });
}
