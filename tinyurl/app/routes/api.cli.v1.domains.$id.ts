import { isSuperAdmin } from "@gdgjp/gdg-lib";
import {
  countLinksForDomain,
  createDomainProvider,
  getDomainById,
  manageableChapterIds,
  softDeleteDomain,
} from "~/features/domains";
import { requireCliActor } from "~/lib/cli-auth.server";
import { cliError, cliJson, cliMethodNotAllowed } from "~/lib/cli-http.server";
import type { components } from "../../openapi/types.generated";
import type { Route } from "./+types/api.cli.v1.domains.$id";

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function notFound(): Response {
  return cliError("not_found", 404);
}

function forbidden(): Response {
  return cliError("forbidden", 403);
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parseId(args.params.id);
  if (id === null) return notFound();
  const domain = await getDomainById(env.DB, id);
  if (!domain) return notFound();

  if (domain.kind === "custom" && !isSuperAdmin(auth.actor.user)) {
    const visibleIds = auth.actor.chapters.map((chapter) => chapter.chapterId);
    if (domain.ownerChapterId === null || !visibleIds.includes(domain.ownerChapterId)) {
      return forbidden();
    }
  }

  const body: components["schemas"]["DomainResponse"] = { domain };
  return cliJson(body);
}

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== "DELETE") return cliMethodNotAllowed();
  const env = args.context.cloudflare.env;
  const auth = await requireCliActor(env, args.request);
  if (!auth.ok) return auth.response;

  const id = parseId(args.params.id);
  if (id === null) return notFound();
  const domain = await getDomainById(env.DB, id);
  if (!domain) return notFound();
  if (domain.kind !== "custom") return forbidden();

  const manageableIds = manageableChapterIds(auth.actor.user, auth.actor.chapters);
  if (domain.ownerChapterId === null || !manageableIds.includes(domain.ownerChapterId)) {
    return forbidden();
  }

  if ((await countLinksForDomain(env.DB, domain.id)) > 0) {
    return cliError("domain_has_links", 409);
  }

  await createDomainProvider(env).remove(domain.hostname);
  await softDeleteDomain(env.DB, domain.id);
  const body: components["schemas"]["DomainDeleteResult"] = { id: domain.id, deleted: true };
  return cliJson(body);
}
