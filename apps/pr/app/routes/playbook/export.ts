import rulesJson from "@skills/pr-playbook/rules.json";
import { digestJson, requireOrganizer } from "~/features/learning/access.server";
import { exportBundle } from "~/features/learning/proposal";
import { listProposals, markExported } from "~/features/learning/proposal.repository.server";
import { constants } from "~/features/playbook/playbook";
import type { Route } from "./+types/export";

/** Accepted proposals not yet exported, as the bundle `feedback.mjs import` reads. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { chapterIds } = await requireOrganizer(env, request);
  const proposals = (await listProposals(env.DB, chapterIds, { status: "accepted" })).filter(
    (p) => !p.exportedAt,
  );
  const bundle = exportBundle(proposals, {
    rules: await digestJson(rulesJson),
    constants: await digestJson(constants),
  });
  await markExported(
    env.DB,
    proposals.map((p) => p.id),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="proposals-${date}.json"`,
    },
  });
}
