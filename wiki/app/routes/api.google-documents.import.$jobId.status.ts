import type { LoaderFunctionArgs } from "react-router";
import { getGoogleDocumentImportJob } from "~/features/google-documents/import.server";
import { requireUser } from "~/lib/auth-utils.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const jobId = params.jobId;
  if (!jobId) return new Response("Not Found", { status: 404 });
  const user = await requireUser(request, context.cloudflare.env);
  try {
    const job = await getGoogleDocumentImportJob(context.cloudflare.env, jobId, user);
    return job ? Response.json(job) : new Response("Not Found", { status: 404 });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
