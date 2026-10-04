import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import {
  archiveCampaign,
  createCampaign,
  getCampaignById,
  listCampaignsForChaptersWithCounts,
  updateCampaign,
} from "~/features/campaigns";

import { validatePublicHttpUrl } from "~/features/links/ogp";
import type { PageRequestArgs } from "~/http/request";

export async function loader(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const campaigns = listCampaignsForChaptersWithCounts(
    env.DB,
    chapters.map((item) => item.chapterId),
    true,
  );
  return {
    user: { email: user.email, image: user.image, name: user.name },
    chapter,
    chapters,
    campaigns,
  };
}

export async function action(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const chapterIds = [
    ...new Set(
      form
        .getAll("chapterId")
        .map((value) => Number(value))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  const availableChapterIds = new Set(chapters.map((item) => item.chapterId));
  if (
    (intent === "create" || intent === "update") &&
    (chapterIds.length === 0 || chapterIds.some((id) => !availableChapterIds.has(id)))
  ) {
    return { error: "Select at least one chapter you belong to." };
  }

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 80) return { error: "Event name must be 1–80 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) {
      return { error: "Code must be 1–16 letters, numbers, underscores, or hyphens." };
    }
    const defaultDestinationUrl = String(form.get("defaultDestinationUrl") ?? "").trim();
    const destinationValidation = defaultDestinationUrl
      ? await validatePublicHttpUrl(defaultDestinationUrl)
      : null;
    if (destinationValidation && !destinationValidation.ok) {
      return { error: `Default destination ${destinationValidation.reason}` };
    }
    const result = await createCampaign(env.DB, {
      name,
      code,
      defaultDestinationUrl: destinationValidation?.url.toString() ?? null,
      ownerUserId: user.id,
      chapterIds,
    });
    if (!result.ok) return { error: `Campaign code “${code}” is already in use.` };
    return { ok: true };
  }

  if (intent === "archive" || intent === "restore") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid campaign." };
    const campaign = await getCampaignById(env.DB, id);
    if (!campaign || !campaign.chapterIds.some((id) => availableChapterIds.has(id))) {
      throw new Response("Forbidden", { status: 403 });
    }
    await archiveCampaign(env.DB, id, intent === "archive");
    return { ok: true };
  }

  if (intent === "update") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid campaign." };
    const campaign = await getCampaignById(env.DB, id);
    if (!campaign || !campaign.chapterIds.some((id) => availableChapterIds.has(id))) {
      throw new Response("Forbidden", { status: 403 });
    }
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toLowerCase();
    if (!name || name.length > 80) return { error: "Event name must be 1–80 characters." };
    if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(code)) return { error: "Invalid campaign code." };
    const defaultDestinationUrl = String(form.get("defaultDestinationUrl") ?? "").trim();
    const destinationValidation = defaultDestinationUrl
      ? await validatePublicHttpUrl(defaultDestinationUrl)
      : null;
    if (destinationValidation && !destinationValidation.ok) {
      return { error: `Default destination ${destinationValidation.reason}` };
    }
    const result = await updateCampaign(env.DB, id, {
      name,
      code,
      defaultDestinationUrl: destinationValidation?.url.toString() ?? null,
      chapterIds,
    });
    if (result && !result.ok) return { error: `Campaign code “${code}” is already in use.` };
    return { ok: true };
  }

  return { error: "Unknown action." };
}

export type CampaignsPageData = Awaited<ReturnType<typeof loader>>;
export type CampaignsPageAction = Awaited<ReturnType<typeof action>>;
