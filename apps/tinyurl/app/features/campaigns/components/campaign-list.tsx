import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  Icons,
  Input,
  Label,
  Skeleton,
  Stack,
} from "@gdgjp/design-system";
import { useMemo, useState } from "react";
import { Form, Link } from "react-router";
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
          className={showArchived ? "rounded-b-none" : "rounded-b-none border-b-2 border-primary"}
          onClick={() => setShowArchived(false)}
          role="tab"
          aria-selected={!showArchived}
        >
          Active <Badge>{activeCount}</Badge>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={showArchived ? "rounded-b-none border-b-2 border-primary" : "rounded-b-none"}
          onClick={() => setShowArchived(true)}
          role="tab"
          aria-selected={showArchived}
        >
          Archived <Badge>{archivedCount}</Badge>
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <Icons name="RadioTower" aria-hidden="true" className="mx-auto size-9 text-muted" />
          <h2 className="mt-4 font-medium">
            {showArchived ? "No archived campaigns" : "Create your first campaign"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Campaigns group event links without imposing a naming scheme on their slugs.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((campaign) => (
            <Card key={campaign.id} className="py-0 transition-colors hover:border-primary/20">
              <Stack>
                <div className="flex flex-col items-stretch gap-3 py-4 sm:flex-row sm:items-center sm:gap-4 sm:py-5">
                  <Link
                    to={`/campaigns/${campaign.id}`}
                    className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gdg-blue/10 text-gdg-blue">
                      <Icons name="RadioTower" aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{campaign.name}</span>
                        <Badge className="font-mono">{campaign.code}</Badge>
                      </span>
                      <span className="mt-1 flex gap-4 text-xs text-muted">
                        <span>{campaign.channelCount} channels</span>
                        <span>{campaign.linkCount} links</span>
                      </span>
                    </span>
                    <Icons
                      name="ChevronRight"
                      aria-hidden="true"
                      className="ml-auto size-5 text-muted transition-transform group-hover:translate-x-0.5"
                    />
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
                          <Icons name="RotateCcw" aria-hidden="true" className="size-4" />
                        ) : (
                          <Icons name="Archive" aria-hidden="true" className="size-4" />
                        )}
                        {showArchived ? "Restore" : "Archive"}
                      </Button>
                    </Form>
                  </div>
                </div>
              </Stack>
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
        <Button variant="ghost">
          <Icons name="Pencil" aria-hidden="true" className="size-4" />
          <span className="sr-only">Edit {campaign.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Update the event label and slug suggestion code.</DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={campaign.id} />
          <FormField id={`campaign-name-${campaign.id}`} label={<>Event name</>} required>
            <Input
              id={`campaign-name-${campaign.id}`}
              name="name"
              defaultValue={campaign.name}
              required
              maxLength={80}
            />
          </FormField>
          <ChapterAccessSelect chapters={chapters} defaultChapterIds={campaign.chapterIds} />
          <FormField id={`campaign-code-${campaign.id}`} label={<>Short code</>} required>
            <Input
              id={`campaign-code-${campaign.id}`}
              name="code"
              defaultValue={campaign.code}
              required
              maxLength={16}
              className="font-mono"
            />
          </FormField>
          <div className="space-y-2">
            <Label htmlFor={`campaign-destination-${campaign.id}`}>Default Destination URL</Label>
            <Input
              id={`campaign-destination-${campaign.id}`}
              name="defaultDestinationUrl"
              type="url"
              defaultValue={campaign.defaultDestinationUrl ?? ""}
              placeholder="https://example.com/event"
            />
            <p className="text-xs text-muted">
              Used to prefill new links in every channel. Leave blank for no default.
            </p>
          </div>
          {error ? (
            <Alert tone="danger" title="Error">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </div>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}
