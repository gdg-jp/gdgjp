import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { getVoucherRecipientsInBrowser } from "~/lib/connpass-browser-read.server";
import { authorizeEventRoute } from "~/lib/event-route.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

function voucherWrite(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.name !== "string" ||
    typeof body.quantity !== "number" ||
    !Array.isArray(body.participationTypeIds) ||
    !body.participationTypeIds.every((id) => typeof id === "string")
  )
    return null;
  return {
    name: body.name,
    quantity: body.quantity,
    participationTypeIds: body.participationTypeIds as string[],
  };
}

export async function loader(args: LoaderFunctionArgs) {
  const access = await authorizeEventRoute(args, false);
  if ("error" in access) return access.error;
  try {
    return Response.json({
      vouchers: await getVoucherRecipientsInBrowser(access.env, access.eventId),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "connpass_browser_error" },
      { status: 502 },
    );
  }
}

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const input = voucherWrite(await args.request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid_body" }, { status: 400 });
  const job = await createJob(
    access.env,
    {
      type: "create_voucher_recipient",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: { input },
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
