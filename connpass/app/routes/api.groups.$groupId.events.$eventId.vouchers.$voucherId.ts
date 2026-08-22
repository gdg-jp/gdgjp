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
  const voucher = (await getVoucherRecipientsInBrowser(access.env, access.eventId)).find(
    (item) => item.id === args.params.voucherId,
  );
  return voucher
    ? Response.json({ voucher })
    : Response.json({ error: "not_found" }, { status: 404 });
}

export async function action(args: ActionFunctionArgs) {
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const voucherId = args.params.voucherId;
  if (!voucherId) return Response.json({ error: "not_found" }, { status: 404 });
  if (args.request.method === "DELETE") {
    const job = await createJob(
      access.env,
      {
        type: "delete_voucher_recipient",
        groupSlug: access.group.groupSlug,
        eventId: access.eventId,
        request: { voucherId },
        createdBy: access.identity.user.id,
      },
      access.ctx,
    );
    return Response.json(jobToJson(job), { status: 202 });
  }
  if (args.request.method !== "PATCH")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const input = voucherWrite(await args.request.json().catch(() => null));
  if (!input) return Response.json({ error: "invalid_body" }, { status: 400 });
  const job = await createJob(
    access.env,
    {
      type: "update_voucher_recipient",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: { voucherId, input },
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
