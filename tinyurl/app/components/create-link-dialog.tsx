import { ExternalLink, RefreshCw, Shuffle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigation } from "react-router";
import { toast } from "sonner";
import { TagCombobox } from "~/components/tag-combobox";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import type { LinkVisibility, Tag } from "~/lib/db";
import { generateRandomSlug } from "~/lib/slug";
import type { ApiLinksActionData } from "~/routes/api.links";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
    </Label>
  );
}

export function CreateLinkDialog({
  availableTags,
  shortUrlBase,
  trigger,
}: {
  availableTags: Tag[];
  shortUrlBase: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden p-0 sm:max-w-3xl">
        {open ? <CreateLinkForm availableTags={availableTags} shortUrlBase={shortUrlBase} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateLinkForm({
  availableTags,
  shortUrlBase,
}: {
  availableTags: Tag[];
  shortUrlBase: string;
}) {
  const shortHost = shortHostOf(shortUrlBase);
  const ogpFetcher = useFetcher<ApiLinksActionData>();
  const createFetcher = useFetcher<ApiLinksActionData>();

  const [destinationUrl, setDestinationUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] = useState<LinkVisibility>("private");

  const lastOgpRef = useRef<unknown>(null);
  useEffect(() => {
    const data = ogpFetcher.data;
    if (!data || !("ogp" in data) || !data.ogp) return;
    if (data === lastOgpRef.current) return;
    lastOgpRef.current = data;
    const { title: t, description: d, image } = data.ogp;
    if (t) setTitle(t);
    if (d) setDescription(d);
    if (image) setOgImageUrl(image);
  }, [ogpFetcher.data]);

  const lastCreateRef = useRef<unknown>(null);
  useEffect(() => {
    const data = createFetcher.data;
    if (!data || lastCreateRef.current === data) return;
    lastCreateRef.current = data;
    if ("error" in data && data.error) toast.error(data.error);
  }, [createFetcher.data]);

  const navigation = useNavigation();
  const isSubmitting = createFetcher.state !== "idle" || navigation.state === "loading";
  const isFetchingOgp = ogpFetcher.state !== "idle";

  const previewSlug = slug || "preview";
  const apexShortUrl = `${shortUrlBase}/${previewSlug}`;
  const previewHost = hostnameOf(destinationUrl);

  function fetchOgpNow() {
    if (!destinationUrl) return;
    const fd = new FormData();
    fd.set("intent", "fetchOgp");
    fd.set("destinationUrl", destinationUrl);
    ogpFetcher.submit(fd, { method: "post", action: "/api/links" });
  }

  const error =
    createFetcher.data && "error" in createFetcher.data ? createFetcher.data.error : null;

  return (
    <createFetcher.Form
      method="post"
      action="/api/links"
      className="flex max-h-[calc(100dvh-2rem)] flex-col"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <DialogTitle className="text-base font-semibold">Create new link</DialogTitle>
        <DialogDescription className="sr-only">
          Create a new short link with optional tags and comment.
        </DialogDescription>
      </div>

      <div className="grid gap-6 overflow-y-auto p-5 md:grid-cols-3 md:p-6">
        <div className="space-y-5 md:col-span-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="create-destinationUrl">Destination URL</FieldLabel>
            <Input
              id="create-destinationUrl"
              name="destinationUrl"
              type="url"
              placeholder="https://example.com/some/page"
              required
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              onBlur={() => {
                if (destinationUrl && !title && !description && !ogImageUrl) fetchOgpNow();
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="create-slug">Short Link</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Generate random slug"
                onClick={() => setSlug(generateRandomSlug(7))}
              >
                <Shuffle className="size-3.5" />
              </Button>
            </div>
            <div className="flex gap-2">
              <span className="inline-flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {shortHost}
              </span>
              <Input
                id="create-slug"
                name="slug"
                placeholder="auto-generated if blank"
                pattern="[a-zA-Z0-9_\-]{1,64}"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="create-visibility">Visibility</FieldLabel>
            <input type="hidden" name="visibility" value={visibility} />
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as LinkVisibility)}
            >
              <SelectTrigger id="create-visibility" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  Private — only you and people you share with
                </SelectItem>
                <SelectItem value="public">Anyone in GDG Japan can view</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel>Tags</FieldLabel>
              <Link to="/tags" className="text-xs text-muted-foreground hover:text-foreground">
                Manage
              </Link>
            </div>
            <TagCombobox
              availableTags={availableTags}
              selectedIds={tagIds}
              newTagNames={newTagNames}
              onChange={(ids, names) => {
                setTagIds(ids);
                setNewTagNames(names);
              }}
            />
            {tagIds.map((id) => (
              <input key={`tagId-${id}`} type="hidden" name="tagId" value={id} />
            ))}
            {newTagNames.map((name, idx) => (
              <input
                key={`newTagName-${idx}-${name}`}
                type="hidden"
                name="newTagName"
                value={name}
              />
            ))}
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="create-comment">Comment</FieldLabel>
            <Textarea
              id="create-comment"
              name="comment"
              placeholder="Add a comment"
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <FieldLabel>QR Code</FieldLabel>
            <div className="flex items-center justify-center rounded-md border bg-card p-4">
              <QRCodeSVG value={apexShortUrl} size={140} />
            </div>
            <p className="break-all text-center font-mono text-xs text-muted-foreground">
              {apexShortUrl}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel>Custom Link Preview</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={fetchOgpNow}
                disabled={isFetchingOgp || !destinationUrl}
              >
                <RefreshCw className={`size-3 ${isFetchingOgp ? "animate-spin" : ""}`} />
                Fetch
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border bg-card">
              {ogImageUrl ? (
                <img
                  src={ogImageUrl}
                  alt="OGP preview"
                  className="aspect-video w-full bg-muted object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                  Enter a link to generate a preview
                </div>
              )}
              <div className="space-y-1 px-3 py-2">
                <p className="truncate text-sm font-medium">{title || previewHost || "Untitled"}</p>
                {description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-title" className="text-xs text-muted-foreground">
                  Title
                </Label>
                <Input
                  id="create-title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-description" className="text-xs text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  id="create-description"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-ogImageUrl" className="text-xs text-muted-foreground">
                  Image URL
                </Label>
                <Input
                  id="create-ogImageUrl"
                  name="ogImageUrl"
                  type="url"
                  value={ogImageUrl}
                  onChange={(e) => setOgImageUrl(e.target.value)}
                />
              </div>
            </div>

            {destinationUrl ? (
              <a
                href={destinationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3" />
                <span className="truncate">{destinationUrl}</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-5 pb-4 md:px-6">
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={isSubmitting}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create link"}
        </Button>
      </div>
    </createFetcher.Form>
  );
}
