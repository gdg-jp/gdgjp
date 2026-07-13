import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
import { ImagePlus, LoaderCircle, RefreshCw, Shuffle, Upload } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { SubmitButton } from "~/components/ui/submit-button";
import { Textarea } from "~/components/ui/textarea";
import type { UserChapter } from "~/lib/chapter.server";
import type { LinkVisibility, Tag } from "~/lib/db";
import { generateRandomSlug } from "~/lib/slug";
import type { ApiLinksActionData } from "~/routes/api.links";

export type CampaignChannelOption = {
  id: number;
  campaignName: string;
  campaignCode?: string;
  defaultDestinationUrl?: string | null;
  channelName: string;
  channelCode?: string;
};

type PendingShare = {
  principalType: "user" | "chapter";
  principalId: string;
  role: "viewer" | "editor";
};

export function campaignLinkDefaults(option?: CampaignChannelOption) {
  return {
    destinationUrl: option?.defaultDestinationUrl ?? "",
    slug:
      option?.campaignCode && option.channelCode
        ? `${option.campaignCode}${option.channelCode}`
        : "",
  };
}

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
  campaignChannelOptions = [],
  chapters = [],
  defaultCampaignChannelId,
  shortUrlBase,
  trigger,
}: {
  availableTags: Tag[];
  campaignChannelOptions?: CampaignChannelOption[];
  chapters?: UserChapter[];
  defaultCampaignChannelId?: number;
  shortUrlBase: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border">
        {open ? (
          <CreateLinkForm
            availableTags={availableTags}
            campaignChannelOptions={campaignChannelOptions}
            chapters={chapters}
            defaultCampaignChannelId={defaultCampaignChannelId}
            shortUrlBase={shortUrlBase}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateLinkForm({
  availableTags,
  campaignChannelOptions,
  chapters,
  defaultCampaignChannelId,
  shortUrlBase,
}: {
  availableTags: Tag[];
  campaignChannelOptions: CampaignChannelOption[];
  chapters: UserChapter[];
  defaultCampaignChannelId?: number;
  shortUrlBase: string;
}) {
  const shortHost = shortHostOf(shortUrlBase);
  const defaultCampaignChannel = campaignChannelOptions.find(
    (option) => option.id === defaultCampaignChannelId,
  );
  const defaults = campaignLinkDefaults(defaultCampaignChannel);
  const ogpFetcher = useFetcher<ApiLinksActionData>();
  const createFetcher = useFetcher<ApiLinksActionData>();

  const [destinationUrl, setDestinationUrl] = useState(defaults.destinationUrl);
  const [slug, setSlug] = useState(defaults.slug);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] = useState<LinkVisibility>("private");
  const [sharePrincipalType, setSharePrincipalType] = useState<"user" | "chapter">("chapter");
  const [sharePrincipalId, setSharePrincipalId] = useState(
    chapters[0] ? String(chapters[0].chapterId) : "",
  );
  const [shareRole, setShareRole] = useState<"viewer" | "editor">("viewer");
  const [pendingShares, setPendingShares] = useState<PendingShare[]>([]);
  const [campaignChannelId, setCampaignChannelId] = useState(
    defaultCampaignChannelId === undefined ? "standalone" : String(defaultCampaignChannelId),
  );

  const lastOgpRef = useRef<unknown>(null);
  const prefetchedDefaultDestinationUrlRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  const isBusy = isSubmitting || isUploadingImage;
  const isFetchingOgp = ogpFetcher.state !== "idle";

  const previewSlug = slug || "preview";
  const apexShortUrl = `${shortUrlBase}/${previewSlug}`;
  const previewHost = hostnameOf(destinationUrl);

  function fetchOgpNow(url = destinationUrl) {
    if (!url) return;
    const fd = new FormData();
    fd.set("intent", "fetchOgp");
    fd.set("destinationUrl", url);
    ogpFetcher.submit(fd, { method: "post", action: "/api/links" });
  }

  useEffect(() => {
    if (
      !defaults.destinationUrl ||
      prefetchedDefaultDestinationUrlRef.current === defaults.destinationUrl
    ) {
      return;
    }
    prefetchedDefaultDestinationUrlRef.current = defaults.destinationUrl;
    const fd = new FormData();
    fd.set("intent", "fetchOgp");
    fd.set("destinationUrl", defaults.destinationUrl);
    ogpFetcher.submit(fd, { method: "post", action: "/api/links" });
  }, [defaults.destinationUrl, ogpFetcher.submit]);

  async function uploadPreviewImage(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }

    setIsUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/images/upload", { method: "POST", body: form });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Upload failed (${response.status})`);
      }
      const result = (await response.json()) as { url: string };
      setOgImageUrl(result.url);
      toast.success("Preview image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadPreviewImage(file);
  }

  function onImageDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isUploadingImage) setIsDraggingImage(true);
  }

  function onImageDragLeave(event: DragEvent<HTMLButtonElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingImage(false);
    }
  }

  function onImageDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDraggingImage(false);
    if (isUploadingImage) return;
    const file = event.dataTransfer.files[0];
    if (file) void uploadPreviewImage(file);
  }

  const error =
    createFetcher.data && "error" in createFetcher.data ? createFetcher.data.error : null;

  return (
    <createFetcher.Form
      method="post"
      action="/api/links"
      className="flex h-dvh min-w-0 flex-col sm:h-auto sm:max-h-[calc(100dvh-2rem)]"
    >
      <div className="flex items-center justify-between gap-3 border-b py-3 pr-14 pl-4 sm:pl-5">
        <DialogTitle className="text-base font-semibold">Create new link</DialogTitle>
        <DialogDescription className="sr-only">
          Create a new short link with optional tags and comment.
        </DialogDescription>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 gap-6 overflow-y-auto p-4 sm:p-5 md:grid-cols-3 md:p-6">
        <div className="min-w-0 space-y-5 md:col-span-2">
          {campaignChannelOptions.length > 0 ? (
            <div className="space-y-2">
              <input
                type="hidden"
                name="campaignChannelId"
                value={campaignChannelId === "standalone" ? "" : campaignChannelId}
              />
              <Select
                value={campaignChannelId}
                onValueChange={(value) => {
                  setCampaignChannelId(value);
                  if (value === "standalone") return;
                  const option = campaignChannelOptions.find(
                    (candidate) => String(candidate.id) === value,
                  );
                  const nextDefaults = campaignLinkDefaults(option);
                  setDestinationUrl(nextDefaults.destinationUrl);
                  setSlug(nextDefaults.slug);
                  setTitle("");
                  setDescription("");
                  setOgImageUrl("");
                  fetchOgpNow(nextDefaults.destinationUrl);
                }}
              >
                <SelectTrigger id="create-campaign-channel" size="sm" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone link</SelectItem>
                  {campaignChannelOptions.map((option) => (
                    <SelectItem key={option.id} value={String(option.id)}>
                      {option.campaignName} / {option.channelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Campaign links are jointly owned by your chapter.
              </p>
            </div>
          ) : null}

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
            <div className="flex min-w-0 gap-2">
              <span className="inline-flex h-9 shrink-0 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
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

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel>Tags</FieldLabel>
              <Link
                to="/tags"
                prefetch="intent"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
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

          <div className="space-y-2">
            <FieldLabel htmlFor="create-visibility">Visibility</FieldLabel>
            <input type="hidden" name="visibility" value={visibility} />
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as LinkVisibility)}
            >
              <SelectTrigger id="create-visibility" size="sm" className="w-full min-w-0">
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
            <FieldLabel>Sharing</FieldLabel>
            <div className="rounded-md border bg-card">
              {pendingShares.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">Not shared with anyone.</p>
              ) : (
                <div className="divide-y">
                  {pendingShares.map((share) => (
                    <div
                      key={`${share.principalType}-${share.principalId}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {share.principalType === "chapter"
                          ? (chapters.find(
                              (chapter) => String(chapter.chapterId) === share.principalId,
                            )?.chapterSlug ?? share.principalId)
                          : share.principalId}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {share.role === "editor" ? "Editor" : "Viewer"}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setPendingShares((shares) =>
                              shares.filter(
                                (item) =>
                                  item.principalType !== share.principalType ||
                                  item.principalId !== share.principalId,
                              ),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[140px_1fr_120px_auto]">
              {pendingShares.map((share) => (
                <input
                  key={`${share.principalType}-${share.principalId}`}
                  type="hidden"
                  name="share"
                  value={`${share.principalType}:${share.principalId}:${share.role}`}
                />
              ))}
              <Select
                value={sharePrincipalType}
                onValueChange={(value) => {
                  const nextType = value as "user" | "chapter";
                  setSharePrincipalType(nextType);
                  setSharePrincipalId(
                    nextType === "chapter" ? String(chapters[0]?.chapterId ?? "") : "",
                  );
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Email</SelectItem>
                  <SelectItem value="chapter" disabled={chapters.length === 0}>
                    Chapter
                  </SelectItem>
                </SelectContent>
              </Select>
              {sharePrincipalType === "user" ? (
                <Input
                  type="email"
                  name="sharePrincipalId"
                  placeholder="alice@example.com"
                  value={sharePrincipalId}
                  onChange={(e) => setSharePrincipalId(e.target.value)}
                />
              ) : (
                <Select value={sharePrincipalId} onValueChange={setSharePrincipalId}>
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Choose a chapter" />
                  </SelectTrigger>
                  <SelectContent>
                    {chapters.map((chapter) => (
                      <SelectItem key={chapter.chapterId} value={String(chapter.chapterId)}>
                        {chapter.chapterSlug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={shareRole}
                onValueChange={(value) => setShareRole(value as "viewer" | "editor")}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!sharePrincipalId.trim()) return;
                  const share = {
                    principalType: sharePrincipalType,
                    principalId: sharePrincipalId.trim(),
                    role: shareRole,
                  };
                  setPendingShares((shares) => [
                    ...shares.filter(
                      (item) =>
                        item.principalType !== share.principalType ||
                        item.principalId !== share.principalId,
                    ),
                    share,
                  ]);
                  if (sharePrincipalType === "user") setSharePrincipalId("");
                }}
                disabled={!sharePrincipalId.trim()}
              >
                Share
              </Button>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <FieldLabel>QR Code</FieldLabel>
            <div className="flex items-center justify-center rounded-md border bg-card p-4">
              <QRCodeSVG
                value={apexShortUrl}
                size={112}
                bgColor="transparent"
                className="dark:[&_path:last-of-type]:fill-white"
              />
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
                onClick={() => fetchOgpNow()}
                disabled={isFetchingOgp || !destinationUrl}
              >
                <RefreshCw className={`size-3 ${isFetchingOgp ? "animate-spin" : ""}`} />
                Fetch
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border bg-card">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={isUploadingImage}
                onChange={onImageChange}
              />
              <button
                type="button"
                aria-label="Upload a custom preview image"
                disabled={isUploadingImage}
                onClick={() => imageInputRef.current?.click()}
                onDragEnter={onImageDragOver}
                onDragOver={onImageDragOver}
                onDragLeave={onImageDragLeave}
                onDrop={onImageDrop}
                className={`group relative block aspect-video w-full overflow-hidden bg-muted text-xs text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isDraggingImage ? "bg-primary/15 ring-2 ring-primary ring-inset" : ""
                }`}
              >
                {ogImageUrl ? (
                  <img src={ogImageUrl} alt="OGP preview" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-2">
                    <ImagePlus className="size-5" aria-hidden="true" />
                    Click or drop an image
                  </span>
                )}
                <span
                  className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white transition-opacity ${
                    isUploadingImage || isDraggingImage
                      ? "opacity-100"
                      : ogImageUrl
                        ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        : "opacity-0"
                  }`}
                >
                  {isUploadingImage ? (
                    <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="size-5" aria-hidden="true" />
                  )}
                  {isUploadingImage
                    ? "Uploading to img…"
                    : isDraggingImage
                      ? "Drop to upload"
                      : "Replace image"}
                </span>
              </button>
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

      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={isBusy}>
            Cancel
          </Button>
        </DialogClose>
        <SubmitButton pending={isSubmitting} pendingLabel="Creating…" disabled={isUploadingImage}>
          {isSubmitting ? "Creating…" : "Create link"}
        </SubmitButton>
      </div>
    </createFetcher.Form>
  );
}
