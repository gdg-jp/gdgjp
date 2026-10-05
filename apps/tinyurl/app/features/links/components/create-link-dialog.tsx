import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  IconButton,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@gdgjp/design-system";
import { MAX_IMAGE_UPLOAD_BYTES } from "@gdgjp/gdg-lib";
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
import type { UserChapter } from "~/features/auth/chapter.server";
import type { ApiLinksActionData } from "~/features/links/link-http.types";
import type { LinkVisibility } from "~/features/links/link-record";
import { shortDomainLabel } from "~/features/links/short-url";
import { generateRandomSlug } from "~/features/links/slug";
import { TagCombobox } from "~/features/tags/components/tag-combobox";
import type { Tag } from "~/features/tags/tag-record";

export type CampaignChannelOption = {
  id: number;
  campaignName: string;
  campaignCode?: string;
  defaultDestinationUrl?: string | null;
  channelName: string;
  channelCode?: string;
};

export type LinkDomainOption = { id: number; hostname: string };

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

export function CreateLinkDialog({
  availableTags,
  campaignChannelOptions = [],
  chapters = [],
  defaultCampaignChannelId,
  defaultFolderId,
  domainOptions,
  shortUrlBase,
  trigger,
}: {
  availableTags: Tag[];
  campaignChannelOptions?: CampaignChannelOption[];
  chapters?: UserChapter[];
  defaultCampaignChannelId?: number;
  /** The destination folder for links created from a folder detail page. */
  defaultFolderId?: number;
  domainOptions?: LinkDomainOption[];
  shortUrlBase: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        {open ? (
          <CreateLinkForm
            availableTags={availableTags}
            campaignChannelOptions={campaignChannelOptions}
            chapters={chapters}
            defaultCampaignChannelId={defaultCampaignChannelId}
            defaultFolderId={defaultFolderId}
            domainOptions={domainOptions}
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
  defaultFolderId,
  shortUrlBase,
  domainOptions = [{ id: 1, hostname: shortHostOf(shortUrlBase) }],
}: {
  availableTags: Tag[];
  campaignChannelOptions: CampaignChannelOption[];
  chapters: UserChapter[];
  defaultCampaignChannelId?: number;
  defaultFolderId?: number;
  domainOptions?: LinkDomainOption[];
  shortUrlBase: string;
}) {
  const [domainId, setDomainId] = useState(String(domainOptions[0]?.id ?? 1));
  const [goLinksHelpOpen, setGoLinksHelpOpen] = useState(false);
  const selectedDomain = domainOptions.find((domain) => String(domain.id) === domainId);
  const shortHost = selectedDomain?.hostname ?? shortHostOf(shortUrlBase);
  const isGoLinkDomain = shortHost.toLowerCase() === "go.gdgs.jp";
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
  const apexShortUrl = `https://${shortHost}/${previewSlug}`;
  const shortDisplay = isGoLinkDomain ? `go/${previewSlug}` : `${shortHost}/${previewSlug}`;
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
          {defaultCampaignChannelId !== undefined ? (
            <input type="hidden" name="campaignChannelId" value={defaultCampaignChannelId} />
          ) : null}
          {defaultFolderId !== undefined ? (
            <input type="hidden" name="folderId" value={defaultFolderId} />
          ) : null}

          <FormField id="create-destinationUrl" label={<>Destination URL</>} required>
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
          </FormField>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="create-slug">Short Link</Label>
              <IconButton
                type="button"
                variant="ghost"
                aria-label="Generate random slug"
                onClick={() => setSlug(generateRandomSlug(7))}
              >
                <Icons name="Waypoints" aria-hidden="true" className="size-3.5" />
              </IconButton>
            </div>
            <div className="flex min-w-0 gap-2">
              <input type="hidden" name="domainId" value={domainId} />
              <div className="relative shrink-0">
                <Select value={domainId} onValueChange={setDomainId}>
                  <SelectTrigger
                    id="create-domain"
                    aria-label="Short link domain"
                    className="h-9 min-w-32 bg-surface text-muted shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {domainOptions.map((domain) => (
                      <SelectItem key={domain.id} value={String(domain.id)}>
                        {shortDomainLabel(domain.hostname)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isGoLinkDomain ? (
                  <Dialog open={goLinksHelpOpen} onOpenChange={setGoLinksHelpOpen}>
                    <DialogTrigger asChild>
                      <IconButton
                        type="button"
                        variant="ghost"
                        aria-label="How to use go links in Chrome"
                        className="absolute top-1/2 right-8 z-10 -translate-y-1/2"
                      >
                        <Icons name="CircleHelp" aria-hidden="true" className="size-4" />
                      </IconButton>
                    </DialogTrigger>
                    <DialogContent className="max-w-[24rem] gap-0 overflow-hidden p-0 sm:max-w-[24rem]">
                      <div className="border-b px-5 py-4 pr-14">
                        <DialogTitle>Use go/ links in Chrome</DialogTitle>
                        <DialogDescription className="mt-1">
                          Install the GDG Japan Go Links extension to open links such as go/docs
                          directly from Chrome.
                        </DialogDescription>
                      </div>
                      <div className="space-y-5 px-5 py-4">
                        <Button fullWidth asChild className="">
                          <a href="https://github.com/gdg-jp/gdgjp/releases/latest/download/gdg-japan-go-links.zip">
                            <Icons name="Download" aria-hidden="true" className="size-4" />
                            Download Chrome Extension
                          </a>
                        </Button>
                        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
                          <li>Download and unzip the extension file.</li>
                          <li>
                            Open{" "}
                            <code className="rounded bg-surface px-1 py-0.5">
                              chrome://extensions
                            </code>{" "}
                            in Chrome.
                          </li>
                          <li>Turn on Developer mode.</li>
                          <li>Select Load unpacked, then choose the folder you unzipped.</li>
                        </ol>
                      </div>
                      <div className="flex justify-end border-t px-5 py-3">
                        <DialogClose asChild>
                          <Button type="button" variant="outline">
                            Close
                          </Button>
                        </DialogClose>
                      </div>
                    </DialogContent>
                  </Dialog>
                ) : null}
              </div>
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
              <Label>Tags</Label>
              <Link
                to="/tags"
                prefetch="intent"
                className="text-xs text-muted hover:text-foreground"
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

          <FormField id="create-comment" label={<>Comment</>}>
            <Textarea
              id="create-comment"
              name="comment"
              placeholder="Add a comment"
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </FormField>

          <div className="space-y-2">
            <Label htmlFor="create-visibility">Visibility</Label>
            <input type="hidden" name="visibility" value={visibility} />
            <Select
              value={visibility}
              onValueChange={(value) => setVisibility(value as LinkVisibility)}
            >
              <SelectTrigger id="create-visibility" className="w-full min-w-0">
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
            <Label>Sharing</Label>
            <div className="rounded-md border bg-surface">
              {pendingShares.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted">Not shared with anyone.</p>
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
                      <span className="flex items-center gap-2 text-xs text-muted">
                        {share.role === "editor" ? "Editor" : "Viewer"}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
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
            <div className="grid min-w-0 grid-cols-2 gap-2 rounded-md border bg-surface p-3 lg:grid-cols-[112px_minmax(0,1fr)_100px_auto]">
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
                <SelectTrigger>
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
                  <SelectTrigger>
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
                <SelectTrigger>
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
            <Label>QR Code</Label>
            <div className="flex items-center justify-center rounded-md border bg-surface p-4">
              <QRCodeSVG
                value={apexShortUrl}
                size={112}
                bgColor="transparent"
                className="dark:[&_path:last-of-type]:fill-white"
              />
            </div>
            <p className="break-all text-center font-mono text-xs text-muted">{shortDisplay}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Custom Link Preview</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fetchOgpNow()}
                disabled={isFetchingOgp || !destinationUrl}
              >
                <Icons
                  name="RefreshCw"
                  aria-hidden="true"
                  className={`size-3 ${isFetchingOgp ? "animate-spin" : ""}`}
                />
                Fetch
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border bg-surface">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={isUploadingImage}
                onChange={onImageChange}
              />
              <Button
                variant="ghost"
                type="button"
                fullWidth
                aria-label="Upload a custom preview image"
                disabled={isUploadingImage}
                onClick={() => imageInputRef.current?.click()}
                onDragEnter={onImageDragOver}
                onDragOver={onImageDragOver}
                onDragLeave={onImageDragLeave}
                onDrop={onImageDrop}
                className={`group relative block aspect-video overflow-hidden bg-surface text-xs text-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isDraggingImage ? "bg-primary/15 ring-2 ring-primary ring-inset" : ""
                }`}
              >
                {ogImageUrl ? (
                  <img src={ogImageUrl} alt="OGP preview" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-2">
                    <Icons name="GalleryThumbnails" aria-hidden="true" className="size-5" />
                    Click or drop an image
                  </span>
                )}
                <span
                  className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/90 text-foreground transition-opacity ${
                    isUploadingImage || isDraggingImage
                      ? "opacity-100"
                      : ogImageUrl
                        ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        : "opacity-0"
                  }`}
                >
                  {isUploadingImage ? (
                    <Icons name="LoaderCircle" aria-hidden="true" className="size-5 animate-spin" />
                  ) : (
                    <Icons name="Upload" aria-hidden="true" className="size-5" />
                  )}
                  {isUploadingImage
                    ? "Uploading to img…"
                    : isDraggingImage
                      ? "Drop to upload"
                      : "Replace image"}
                </span>
              </Button>
              <div className="space-y-1 px-3 py-2">
                <p className="truncate text-sm font-medium">{title || previewHost || "Untitled"}</p>
                {description ? (
                  <p className="line-clamp-2 text-xs text-muted">{description}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <FormField id="create-title" label={<>Title</>}>
                <Input
                  id="create-title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormField>
              <FormField id="create-description" label={<>Description</>}>
                <Textarea
                  id="create-description"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </FormField>
              <FormField id="create-ogImageUrl" label={<>Image URL</>}>
                <Input
                  id="create-ogImageUrl"
                  name="ogImageUrl"
                  type="url"
                  value={ogImageUrl}
                  onChange={(e) => setOgImageUrl(e.target.value)}
                />
              </FormField>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-5 pb-4 md:px-6">
          <Alert tone="danger" title="Error">
            {error}
          </Alert>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={isBusy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={isSubmitting} disabled={isUploadingImage}>
          {isSubmitting ? "Creating…" : "Create link"}
        </Button>
      </div>
    </createFetcher.Form>
  );
}
