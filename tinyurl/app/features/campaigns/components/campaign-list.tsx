import { Archive, ChevronRight, Megaphone, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Form, Link } from "react-router";
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
import { Skeleton } from "~/components/ui/skeleton";
import { SubmitButton } from "~/components/ui/submit-button";
import { ChapterAccessSelect } from "~/features/campaigns/components/chapter-access-select";
import { useCampaignActionDialog } from "~/features/campaigns/components/use-campaign-action-dialog";
import type { CampaignsPageData } from "~/features/campaigns/list.server";

export type Campaign = Awaited<CampaignsPageData["campaigns"]>[number];

export function CampaignResults({
  campaigns,
  chapters,
}: {
  campaigns: Campaign[];
  chapters: CampaignsPageData["chapters"];
}) {
  const [showArchived, setShowArchived] = useState(false);
  const visible = useMemo(
    () => campaigns.filter((campaign) => (campaign.archivedAt !== null) === showArchived),
    [campaigns, showArchived],
  );
  const activeCount = campaigns.filter((campaign) => campaign.archivedAt === null).length;
  const archivedCount = campaigns.length - activeCount;

  return (
    <>
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
    </>
  );
}

export function CampaignsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading campaigns">
      <div className="flex gap-2 border-b pb-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[74px] w-full rounded-xl sm:h-[82px]" />
        ))}
      </div>
    </div>
  );
}

export function EditCampaignDialog({
  campaign,
  chapters,
}: {
  campaign: Campaign;
  chapters: CampaignsPageData["chapters"];
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
