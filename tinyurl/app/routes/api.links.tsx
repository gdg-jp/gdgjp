import { redirect } from "react-router";
import type { CreateLinkInput, LinkVisibility } from "~/features/links";
import { createLinkWithExtras } from "~/features/links";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import { type OgpData, fetchOgp, validatePublicHttpUrl } from "~/lib/ogp";
import type { Route } from "./+types/api.links";

export type ApiLinksActionData = { error: string } | { ogp: OgpData | null } | null;

export async function action(args: Route.ActionArgs): Promise<ApiLinksActionData> {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);

  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "fetchOgp") {
    const url = String(form.get("destinationUrl") ?? "").trim();
    const validation = await validatePublicHttpUrl(url);
    if (!validation.ok) return { error: `Destination ${validation.reason}` };
    return { ogp: await fetchOgp(validation.url.toString()) };
  }

  const rawCampaignChannelId = String(form.get("campaignChannelId") ?? "").trim();
  const rawFolderId = String(form.get("folderId") ?? "").trim();

  const input: CreateLinkInput = {
    domainId: Number(form.get("domainId") ?? 1),
    slug: String(form.get("slug") ?? "").trim(),
    destinationUrl: String(form.get("destinationUrl") ?? "").trim(),
    title: String(form.get("title") ?? "").trim() || null,
    description: String(form.get("description") ?? "").trim() || null,
    ogImageUrl: String(form.get("ogImageUrl") ?? "").trim() || null,
    tagIds: form
      .getAll("tagId")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
    newTagNames: form
      .getAll("newTagName")
      .map((v) => String(v).trim())
      .filter((n) => n.length > 0 && n.length <= 32),
    comment: String(form.get("comment") ?? "").trim(),
    visibility: String(form.get("visibility") ?? "private") as LinkVisibility,
    campaignChannelId: rawCampaignChannelId ? Number(rawCampaignChannelId) : null,
    folderId: rawFolderId ? Number(rawFolderId) : null,
    shares: form.getAll("share").map((value) => {
      const [principalType, principalId, role] = String(value).split(":");
      return {
        principalType: principalType ?? "",
        principalId: principalId?.trim() ?? "",
        role: role ?? "",
      };
    }),
  };

  const result = await createLinkWithExtras({ db: env.DB }, { user, chapter, chapters }, input);
  if (!result.ok) return { error: result.error };
  throw redirect(`/links/${result.link.id}`);
}
