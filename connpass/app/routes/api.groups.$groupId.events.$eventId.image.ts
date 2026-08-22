import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { authorizeEventRoute } from "~/lib/event-route.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif"]);
const maxImageBytes = 1024 * 1024;

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const form = await args.request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || !imageTypes.has(image.type) || image.size > maxImageBytes) {
    return Response.json({ error: "invalid_event_image" }, { status: 400 });
  }
  const artifactKey = `event-images/${nanoid(16)}`;
  await access.env.ARTIFACTS.put(artifactKey, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  });
  const job = await createJob(
    access.env,
    {
      type: "upload_event_image",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: { artifactKey, contentType: image.type, name: image.name },
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
