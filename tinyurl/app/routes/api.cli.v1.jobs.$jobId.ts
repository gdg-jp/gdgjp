import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { getDomainById } from "~/features/domains";
import { getDomainJob } from "~/features/domains/domain-job.repository.server";
import { domainJobToJson } from "~/features/domains/domain-job.service.server";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson } from "~/lib/cli-http.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.jobs.$jobId";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const job = await getDomainJob(env.DB, args.params.jobId);
  // Callers who cannot see this job get the same 404 as a missing one, to
  // avoid leaking whether a given job id exists.
  if (!job) return cliError("not_found", 404);

  const domain = await getDomainById(env.DB, job.domainId);
  const isOwningChapterOrganizer =
    domain !== null &&
    domain.ownerChapterId !== null &&
    auth.actor.chapters.some(
      (chapter) => chapter.chapterId === domain.ownerChapterId && chapter.role === "organizer",
    );
  const allowed =
    job.createdBy === auth.actor.user.id ||
    isSuperAdmin(auth.actor.user) ||
    isOwningChapterOrganizer;
  if (!allowed) return cliError("not_found", 404);

  const body: components["schemas"]["Job"] = domainJobToJson(job);
  return cliJson(body);
}
