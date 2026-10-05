import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  Icons,
  Input,
  Label,
  NativeSelect,
} from "@gdgjp/design-system";
import { Form } from "react-router";
import { useCampaignActionDialog } from "~/features/campaigns/components/use-campaign-action-dialog";
import type { DetailChannel } from "~/features/campaigns/detail-types";
import type { AssignableLink } from "~/features/campaigns/detail-types";

export function CreateChannelDialog({ campaignCode }: { campaignCode: string }) {
  return (
    <SimpleCreateDialog
      title="Add channel"
      description={`Create a channel under ${campaignCode}.`}
      triggerLabel="Add channel"
      intent="createChannel"
      codePlaceholder="x"
    />
  );
}

export function CreateSourceDialog({ channelId }: { channelId: number }) {
  return (
    <SimpleCreateDialog
      title="Add source"
      description="Register a recurring distribution target."
      triggerLabel="Source"
      intent="createSource"
      namePlaceholder="GDG Tokyo"
      codePlaceholder="1"
      hidden={{ channelId }}
    />
  );
}

export function EditChannelDialog({ channel }: { channel: DetailChannel }) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Icons name="Pencil" aria-hidden="true" className="size-4" />
          <span className="sr-only">Edit {channel.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>Edit channel</DialogTitle>
          <DialogDescription>Change its label, code, or campaign ordering.</DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="updateChannel" />
          <input type="hidden" name="channelId" value={channel.id} />
          <FormField id={`edit-channel-name-${channel.id}`} label={<>Display name</>} required>
            <Input
              id={`edit-channel-name-${channel.id}`}
              name="name"
              defaultValue={channel.name}
              required
              maxLength={64}
            />
          </FormField>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <FormField id={`edit-channel-code-${channel.id}`} label={<>Code</>} required>
              <Input
                id={`edit-channel-code-${channel.id}`}
                name="code"
                defaultValue={channel.code}
                required
                maxLength={16}
                className="font-mono"
              />
            </FormField>
            <FormField id={`edit-channel-order-${channel.id}`} label={<>Order</>} required>
              <Input
                id={`edit-channel-order-${channel.id}`}
                name="sortOrder"
                type="number"
                defaultValue={channel.sortOrder}
                required
              />
            </FormField>
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

export function EditSourceDialog({ source }: { source: DetailChannel["sources"][number] }) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="size-7">
          <Icons name="Pencil" aria-hidden="true" className="size-3" />
          <span className="sr-only">Edit {source.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>Edit source</DialogTitle>
          <DialogDescription>Update the human-readable label or tracked code.</DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="updateSource" />
          <input type="hidden" name="sourceId" value={source.id} />
          <FormField id={`edit-source-name-${source.id}`} label={<>Display name</>} required>
            <Input
              id={`edit-source-name-${source.id}`}
              name="name"
              defaultValue={source.name}
              required
              maxLength={64}
            />
          </FormField>
          <FormField id={`edit-source-code-${source.id}`} label={<>Code</>} required>
            <Input
              id={`edit-source-code-${source.id}`}
              name="code"
              defaultValue={source.code}
              required
              maxLength={32}
              className="font-mono"
            />
          </FormField>
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

export function SimpleCreateDialog({
  title,
  description,
  triggerLabel,
  intent,
  namePlaceholder,
  codePlaceholder,
  hidden,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  intent: string;
  namePlaceholder?: string;
  codePlaceholder: string;
  hidden?: Record<string, string | number>;
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Icons name="Plus" aria-hidden="true" className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value={intent} />
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <FormField id={`${intent}-name`} label={<>Display name</>} required>
            <Input
              id={`${intent}-name`}
              name="name"
              required
              maxLength={64}
              placeholder={namePlaceholder}
            />
          </FormField>
          <FormField id={`${intent}-code`} label={<>Code</>} required>
            <Input
              id={`${intent}-code`}
              name="code"
              required
              maxLength={intent === "createSource" ? 32 : 16}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              placeholder={codePlaceholder}
              className="font-mono"
            />
          </FormField>
          {error ? (
            <Alert tone="danger" title="Error">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" loading={pending}>
              Add
            </Button>
          </div>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

export function AssignLinksDialog({
  channels,
  links,
}: { channels: DetailChannel[]; links: AssignableLink[] }) {
  const activeChannels = channels.filter((item) => item.archivedAt === null);
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Icons name="Link2" aria-hidden="true" className="size-4" />
          Assign links
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div className="border-b">
          <DialogTitle>Assign links to channels</DialogTitle>
          <DialogDescription>
            Selected links become chapter-owned and are added to this campaign.
          </DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="assign" />
          <div className="space-y-2">
            <Label htmlFor="assign-channel">Channel</Label>
            <NativeSelect
              id="assign-channel"
              name="channelId"
              required
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Select channel</option>
              {activeChannels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Links</legend>
            {links.length === 0 ? (
              <p className="text-sm text-muted">No editable unclassified links.</p>
            ) : (
              links.map((link) => (
                <Label
                  key={link.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-surface"
                >
                  <Checkbox name="linkId" value={link.id} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {link.title || link.slug}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">
                      /{link.slug}
                    </span>
                  </span>
                </Label>
              ))
            )}
          </fieldset>
          {error ? (
            <Alert tone="danger" title="Error">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              disabled={activeChannels.length === 0 || links.length === 0}
              loading={pending}
            >
              Assign selected
            </Button>
          </div>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterSourceDialog({
  code,
  channelId,
  channelName,
}: {
  code: string;
  channelId: number;
  channelName: string;
}) {
  const { open, onOpenChange, fetcher, pending, error } = useCampaignActionDialog();
  const FetcherForm = fetcher.Form;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Register
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <div className="border-b">
          <DialogTitle>Register source</DialogTitle>
          <DialogDescription>
            Add a display name for the observed <code>{code}</code> source.
          </DialogDescription>
        </div>
        <FetcherForm method="post" className="space-y-4 px-5 pb-5">
          <input type="hidden" name="intent" value="registerSource" />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="channelId" value={channelId} />
          <div className="space-y-2">
            <Label>Channel</Label>
            <p className="rounded-md border bg-surface/30 px-3 py-2 text-sm">{channelName}</p>
          </div>
          <FormField id={`register-name-${code}`} label={<>Display name</>} required>
            <Input
              id={`register-name-${code}`}
              name="name"
              defaultValue={code}
              required
              maxLength={64}
            />
          </FormField>
          {error ? (
            <Alert tone="danger" title="Error">
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" loading={pending}>
              Register
            </Button>
          </div>
        </FetcherForm>
      </DialogContent>
    </Dialog>
  );
}
