import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { buildBundle } from "~/features/jobs/bundle.server";
import { getJob } from "~/features/jobs/job.repository.server";
import { requireRunner, runnerHost } from "~/features/jobs/runner-auth.server";
import type { Route } from "./+types/jobs-bundle";

/** GET /api/runner/jobs/:id/bundle — the files, prompt and schema for a job this runner leased. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requireRunner(request, env);
  const job = await getJob(env.DB, params.id ?? "");
  if (!job || job.status !== "leased" || job.leaseOwner !== runnerHost(request)) {
    return Response.json({ error: "lease_lost" }, { status: 409 });
  }
  const campaign = await getCampaignById(env.DB, job.campaignId);
  if (!campaign) return Response.json({ error: "campaign_gone" }, { status: 410 });
  return Response.json(await buildBundle(env.DB, job, campaign, env));
}
