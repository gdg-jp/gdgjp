import { Archive, BarChart3, ChevronRight, Megaphone, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Form, Link } from "react-router";
import { CampaignDialog } from "~/components/campaigns/campaign-dialog";
import { ChapterAccessSelect } from "~/components/campaigns/chapter-access-select";
import { useCampaignActionDialog } from "~/components/campaigns/use-campaign-action-dialog";
import { DashboardShell } from "~/components/dashboard-shell";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/ui/submit-button";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  archiveCampaign,
  createCampaign,
  getCampaignById,
  listCampaignsForChaptersWithCounts,
  updateCampaign,
} from "~/lib/db";
import { validatePublicHttpUrl } from "~/lib/ogp";
import type { Route } from "./+types/campaigns";

export function meta() {
  return [{ title: "Campaigns — GDG Japan Links" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const campaigns = await listCampaignsForChaptersWithCounts(
    env.DB,
    chapters.map((item) => item.chapterId),
    true,
  );
  return {
    user: { email: user.email, name: user.name },
    chapter,
    chapters,
    campaigns,
  };
}

export async function action(args: Route.ActionArgs) {
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

export default function Campaigns({ loaderData, actionData }: Route.ComponentProps) {
  const { user, chapter, chapters, campaigns } = loaderData;
  const [showArchived, setShowArchived] = useState(false);
  const visible = useMemo(
    () => campaigns.filter((campaign) => (campaign.archivedAt !== null) === showArchived),
    [campaigns, showArchived],
  );
  const activeCount = campaigns.filter((campaign) => campaign.archivedAt === null).length;
  const archivedCount = campaigns.length - activeCount;

  return (
    <DashboardShell user={user}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {actionData && "error" in actionData ? (
          <Alert variant="destructive">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Organize {chapter.chapterSlug} links by event, channel, and source.
            </p>
          </div>
          <CampaignDialog chapters={chapters} />
        </div>

        <div className="flex gap-1 border-b" role="tablist" aria-label="Campaign status">
          <Button
            type="button"
            variant="ghost"
            className={
              showArchived ? "rounded-b-none" : "rounded-b-none border-b-2 border-foreground"
            }
            onClick={() => setShowArchived(false)}
            role="tab"
            aria-selected={!showArchived}
          >
            Active <Badge variant="secondary">{activeCount}</Badge>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={
              showArchived ? "rounded-b-none border-b-2 border-foreground" : "rounded-b-none"
            }
            onClick={() => setShowArchived(true)}
            role="tab"
            aria-selected={showArchived}
          >
            Archived <Badge variant="secondary">{archivedCount}</Badge>
          </Button>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <Megaphone className="mx-auto size-9 text-muted-foreground" />
            <h2 className="mt-4 font-medium">
              {showArchived ? "No archived campaigns" : "Create your first campaign"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Campaigns group event links without imposing a naming scheme on their slugs.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {visible.map((campaign) => (
              <Card key={campaign.id} className="py-0 transition-colors hover:border-foreground/20">
                <CardContent className="flex flex-col items-stretch gap-3 py-4 sm:flex-row sm:items-center sm:gap-4 sm:py-5">
                  <Link
                    to={`/campaigns/${campaign.id}`}
                    className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gdg-blue/10 text-gdg-blue">
                      <Megaphone className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{campaign.name}</span>
                        <Badge variant="outline" className="font-mono">
                          {campaign.code}
                        </Badge>
                      </span>
                      <span className="mt-1 flex gap-4 text-xs text-muted-foreground">
                        <span>{campaign.channelCount} channels</span>
                        <span>{campaign.linkCount} links</span>
                      </span>
                    </span>
                    <ChevronRight className="ml-auto size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <div className="flex items-center justify-end gap-1 border-t pt-2 sm:border-0 sm:pt-0">
                    <EditCampaignDialog campaign={campaign} chapters={chapters} />
                    <Form method="post">
                      <input type="hidden" name="id" value={campaign.id} />
                      <input
                        type="hidden"
                        name="intent"
                        value={showArchived ? "restore" : "archive"}
                      />
                      <Button type="submit" size="sm" variant="ghost">
                        {showArchived ? (
                          <RotateCcw className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                        {showArchived ? "Restore" : "Archive"}
                      </Button>
                    </Form>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <BarChart3 className="size-4" />
          Click analytics are available inside each campaign.
        </div>
      </div>
    </DashboardShell>
  );
}

function EditCampaignDialog({
  campaign,
  chapters,
}: {
  campaign: Route.ComponentProps["loaderData"]["campaigns"][number];
  chapters: Route.ComponentProps["loaderData"]["chapters"];
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Pencil className="size-4" />
          <span className="sr-only">Edit {campaign.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Update the event label and slug suggestion code.</DialogDescription>
        </DialogHeader>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={campaign.id} />
          <div className="space-y-2">
            <Label htmlFor={`campaign-name-${campaign.id}`}>Event name</Label>
            <Input
              id={`campaign-name-${campaign.id}`}
              name="name"
              defaultValue={campaign.name}
              required
              maxLength={80}
            />
          </div>
          <ChapterAccessSelect chapters={chapters} defaultChapterIds={campaign.chapterIds} />
          <div className="space-y-2">
            <Label htmlFor={`campaign-code-${campaign.id}`}>Short code</Label>
            <Input
              id={`campaign-code-${campaign.id}`}
              name="code"
              defaultValue={campaign.code}
              required
              maxLength={16}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`campaign-destination-${campaign.id}`}>Default Destination URL</Label>
            <Input
              id={`campaign-destination-${campaign.id}`}
              name="defaultDestinationUrl"
              type="url"
              defaultValue={campaign.defaultDestinationUrl ?? ""}
              placeholder="https://example.com/event"
            />
            <p className="text-xs text-muted-foreground">
              Used to prefill new links in every channel. Leave blank for no default.
            </p>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              Save
            </SubmitButton>
          </DialogFooter>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}
