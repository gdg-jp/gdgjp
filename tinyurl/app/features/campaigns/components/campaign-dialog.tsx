import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  Icons,
  Input,
  Label,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import type { UserChapter } from "~/features/auth/chapter.server";
import { ChapterAccessSelect } from "~/features/campaigns/components/chapter-access-select";
import { useCampaignActionDialog } from "~/features/campaigns/components/use-campaign-action-dialog";

export function CampaignDialog({
  chapters,
  trigger,
}: {
  chapters: UserChapter[];
  trigger?: ReactNode;
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Icons name="Plus" aria-hidden="true" className="size-4" />
            Create campaign
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>Create campaign</DialogTitle>
          <DialogDescription>
            Group links for one event. The code only suggests short link slugs; it does not restrict
            them.
          </DialogDescription>
        </div>
        <fetcher.Form method="post" className="space-y-5 px-5 pb-5">
          <input type="hidden" name="intent" value="create" />
          <FormField id="campaign-name" label={<>Event name</>} required>
            <Input id="campaign-name" name="name" required maxLength={80} autoFocus />
          </FormField>
          <ChapterAccessSelect
            chapters={chapters}
            defaultChapterIds={chapters.slice(0, 1).map((chapter) => chapter.chapterId)}
          />
          <div className="space-y-2">
            <Label htmlFor="campaign-code">Short code</Label>
            <Input
              id="campaign-code"
              name="code"
              required
              maxLength={16}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              placeholder="df26"
              className="font-mono"
            />
            <p className="text-xs text-muted">
              Letters, numbers, underscores, and hyphens. Saved in lowercase.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-destination">Default Destination URL</Label>
            <Input
              id="campaign-destination"
              name="defaultDestinationUrl"
              type="url"
              placeholder="https://example.com/event"
            />
            <p className="text-xs text-muted">
              Optional. Prefills the destination for links created in this campaign.
            </p>
          </div>
          {error ? (
            <Alert tone="danger" title="Error">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" loading={pending}>
              Create campaign
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
