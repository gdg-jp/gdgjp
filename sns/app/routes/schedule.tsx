import { Check, ChevronDown, ImagePlus, Tag, X } from "lucide-react";
import { Dialog as DialogPrimitive, DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Form, Link, data, redirect } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { getPost, listPostMedia, listXAccounts } from "~/lib/db.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { claimAndPublish } from "~/lib/publish.server";
import { MAX_IMAGES, MAX_IMAGE_BYTES, nowIso } from "~/lib/utils";
import googlePhotosLogo from "../../photos.png";
import type { Route } from "./+types/schedule";

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const editId = new URL(request.url).searchParams.get("edit");
  const post = editId ? await getPost(context.cloudflare.env.DB, editId) : null;
  if (post && post.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  return {
    ...access,
    accounts: await listXAccounts(context.cloudflare.env.DB, access.chapter.chapterId),
    post,
    media: post ? ((await listPostMedia(context.cloudflare.env.DB, [post.id]))[post.id] ?? []) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  if (intent === "delete") {
    const postId = String(form.get("postId") ?? "");
    const post = await getPost(env.DB, postId);
    if (!post || post.chapterId !== access.chapter.chapterId)
      throw new Response("Not found", { status: 404 });
    const media = (await listPostMedia(env.DB, [post.id]))[post.id] ?? [];
    const deletion = await env.DB.prepare(
      "DELETE FROM posts WHERE id = ? AND status NOT IN ('published', 'posting')",
    )
      .bind(post.id)
      .run();
    if (deletion.meta.changes !== 1)
      return data({ error: "投稿中または投稿済みの予約は削除できません。" }, { status: 409 });
    await Promise.all(media.map((item) => env.MEDIA.delete(item.r2Key)));
    throw redirect("/posts");
  }
  const text = String(form.get("text") ?? "").trim();
  const xAccountId = String(form.get("xAccountId") ?? "");
  const condition = form.get("condition") === "scheduled" ? "scheduled" : "photo_required";
  const scheduledInput = String(form.get("scheduledAt") ?? "");
  const scheduledAt = new Date(`${scheduledInput}:00+09:00`);
  if (!text || text.length > 280 || !xAccountId || Number.isNaN(scheduledAt.getTime()))
    return data({ error: "本文、投稿先、予約日時を確認してください。" }, { status: 400 });
  const account = (await listXAccounts(env.DB, access.chapter.chapterId)).find(
    (item) => item.id === xAccountId,
  );
  if (!account) throw new Response("Forbidden", { status: 403 });
  const id = String(form.get("postId") ?? "") || crypto.randomUUID();
  const existing = await getPost(env.DB, id);
  if (existing && existing.chapterId !== access.chapter.chapterId)
    throw new Response("Forbidden", { status: 403 });
  if (existing?.status === "published" || existing?.status === "posting")
    return data({ error: "投稿中または投稿済みの予約は変更できません。" }, { status: 409 });
  const existingMedia = existing ? ((await listPostMedia(env.DB, [id]))[id] ?? []) : [];
  const deletedMediaIds = new Set(form.getAll("deletedMedia").map(String));
  const deletedMedia = existingMedia.filter((media) => deletedMediaIds.has(media.id));
  const remainingMedia = existingMedia.filter((media) => !deletedMediaIds.has(media.id));
  const files = form
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (
    remainingMedia.length + files.length > MAX_IMAGES ||
    files.some((file) => file.size > MAX_IMAGE_BYTES || !file.type.startsWith("image/"))
  )
    return data(
      { error: "画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。" },
      { status: 400 },
    );
  const preview = await fetchLinkPreview(text).catch(() => null);
  const now = nowIso();
  const status =
    condition === "photo_required" && remainingMedia.length + files.length === 0
      ? "waiting_for_photo"
      : "scheduled";
  if (existing) {
    await env.DB.prepare(
      "UPDATE posts SET x_account_id = ?, text = ?, scheduled_at = ?, condition = ?, status = ?, link_preview_url = ?, link_preview_title = ?, link_preview_description = ?, link_preview_image_url = ?, updated_at = ?, failure_reason = NULL WHERE id = ?",
    )
      .bind(
        xAccountId,
        text,
        scheduledAt.toISOString(),
        condition,
        status,
        preview?.url ?? null,
        preview?.title ?? null,
        preview?.description ?? null,
        preview?.imageUrl ?? null,
        now,
        id,
      )
      .run();
    await Promise.all(
      remainingMedia.map((media, index) =>
        env.DB.prepare("UPDATE post_media SET alt_text = ?, sort_order = ? WHERE id = ?")
          .bind(String(form.get(`alt-${media.id}`) ?? ""), index, media.id)
          .run(),
      ),
    );
    await Promise.all(
      deletedMedia.map(async (media) => {
        await env.MEDIA.delete(media.r2Key);
        await env.DB.prepare("DELETE FROM post_media WHERE id = ?").bind(media.id).run();
      }),
    );
  } else {
    await env.DB.prepare(
      "INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status, created_by_user_id, link_preview_url, link_preview_title, link_preview_description, link_preview_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        access.chapter.chapterId,
        xAccountId,
        text,
        scheduledAt.toISOString(),
        condition,
        status,
        access.user.id,
        preview?.url ?? null,
        preview?.title ?? null,
        preview?.description ?? null,
        preview?.imageUrl ?? null,
        now,
        now,
      )
      .run();
  }
  for (const [index, file] of files.entries()) {
    const key = `${access.chapter.chapterId}/${id}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    await env.DB.prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        id,
        key,
        file.type,
        file.size,
        String(form.get(`new-alt-${index}`) ?? ""),
        remainingMedia.length + index,
        nowIso(),
      )
      .run();
  }
  const handles = String(form.get("tagHandles") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);
  await env.DB.prepare("DELETE FROM post_media_tags WHERE post_id = ?").bind(id).run();
  for (const handle of handles) {
    // Resolve at submit time; failures are user-visible rather than creating an invalid X tag.
    const { resolveXUsername } = await import("~/lib/x.server");
    const resolved = await resolveXUsername(env, xAccountId, handle);
    await env.DB.prepare(
      "INSERT INTO post_media_tags (post_id, x_user_id, username) VALUES (?, ?, ?)",
    )
      .bind(id, resolved.id, resolved.username)
      .run();
  }
  await claimAndPublish(env, id);
  throw redirect("/posts");
}

export default function Schedule({ loaderData, actionData }: Route.ComponentProps) {
  const post = loaderData.post;
  const [xAccountId, setXAccountId] = useState(
    post?.xAccountId ?? loaderData.accounts[0]?.id ?? "",
  );
  const [condition, setCondition] = useState<"scheduled" | "photo_required">(
    post?.condition ?? "photo_required",
  );
  const [newImages, setNewImages] = useState<{ file: File; url: string }[]>([]);
  const [deletedMediaIds, setDeletedMediaIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const selectedAccount = loaderData.accounts.find((account) => account.id === xAccountId);
  const existingMedia = loaderData.media.filter((media) => !deletedMediaIds.includes(media.id));
  const imageCount = existingMedia.length + newImages.length;
  const removeNewImage = (url: string) => {
    const image = newImages.find((item) => item.url === url);
    if (image) URL.revokeObjectURL(image.url);
    const remaining = newImages.filter((item) => item.url !== url);
    const transfer = new DataTransfer();
    for (const item of remaining) transfer.items.add(item.file);
    if (fileInputRef.current) fileInputRef.current.files = transfer.files;
    setNewImages(remaining);
  };
  useEffect(() => {
    return () => {
      for (const image of newImages) URL.revokeObjectURL(image.url);
    };
  }, [newImages]);
  useEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);
  const localDateTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  })
    .format(post ? new Date(post.scheduledAt) : new Date())
    .replace(" ", "T");
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <Form id="schedule-form" method="post" encType="multipart/form-data" className="p-4">
        {post ? <input type="hidden" name="postId" value={post.id} /> : null}
        <input type="hidden" name="condition" value={condition} />
        {actionData?.error ? (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionData.error}</p>
        ) : null}
        <div className="space-y-5">
          <div>
            <span id="x-account-label" className="sr-only">
              投稿先アカウント
            </span>
            <input type="hidden" name="xAccountId" value={xAccountId} />
            <DropdownMenuPrimitive.Root>
              <DropdownMenuPrimitive.Trigger asChild>
                <button
                  type="button"
                  disabled={!loaderData.accounts.length}
                  aria-labelledby="x-account-label"
                  className="flex items-center gap-2 rounded-full p-1 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedAccount ? <XAccountAvatar account={selectedAccount} /> : null}
                  <span className="min-w-0 max-w-48">
                    {selectedAccount ? (
                      <>
                        <span className="block truncate text-sm font-medium">
                          {selectedAccount.displayName}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Xアカウントを認可してください
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                  align="start"
                  sideOffset={4}
                  className="z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-[16rem] overflow-y-auto rounded-xl border bg-card p-1 text-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                >
                  <DropdownMenuPrimitive.RadioGroup
                    value={xAccountId}
                    onValueChange={setXAccountId}
                  >
                    {loaderData.accounts.map((account) => (
                      <DropdownMenuPrimitive.RadioItem
                        key={account.id}
                        value={account.id}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none select-none focus:bg-muted"
                      >
                        <XAccountAvatar account={account} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{account.displayName}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            @{account.username}
                          </span>
                        </span>
                        <DropdownMenuPrimitive.ItemIndicator>
                          <Check className="size-4 text-primary" aria-hidden="true" />
                        </DropdownMenuPrimitive.ItemIndicator>
                      </DropdownMenuPrimitive.RadioItem>
                    ))}
                  </DropdownMenuPrimitive.RadioGroup>
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>
          </div>
          <label className="block">
            <span className="sr-only">本文</span>
            <textarea
              ref={textAreaRef}
              name="text"
              defaultValue={post?.text}
              maxLength={280}
              required
              rows={2}
              placeholder="いまどうしてる？"
              className="w-full resize-none border-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/80"
              onInput={(event) => {
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
              }}
            />
          </label>
          {deletedMediaIds.map((id) => (
            <input key={id} type="hidden" name="deletedMedia" value={id} />
          ))}
          <MediaGrid
            existingMedia={existingMedia}
            newImages={newImages}
            onRemoveExisting={(id) => setDeletedMediaIds((ids) => [...ids, id])}
            onRemoveNew={removeNewImage}
          />
          {imageCount > 0 ? <TagUsersDialog /> : null}
          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-1">
              <label
                className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-primary transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-primary/50"
                aria-label="端末から写真を追加"
              >
                <ImagePlus className="size-6" aria-hidden="true" />
                <input
                  ref={fileInputRef}
                  name="images"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = [
                      ...newImages.map((image) => image.file),
                      ...Array.from(event.currentTarget.files ?? []),
                    ].slice(0, MAX_IMAGES - existingMedia.length);
                    const transfer = new DataTransfer();
                    for (const file of files) transfer.items.add(file);
                    event.currentTarget.files = transfer.files;
                    setNewImages(files.map((file) => ({ file, url: URL.createObjectURL(file) })));
                  }}
                />
              </label>
              {post ? (
                <a
                  href={`/google/photos/connect?postId=${post.id}`}
                  className="inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50"
                  aria-label="Google Photos から写真を選ぶ"
                  title="Google Photos から選ぶ"
                >
                  <img src={googlePhotosLogo} alt="" className="size-6" />
                </a>
              ) : null}
            </div>
            <DropdownMenuPrimitive.Root>
              <DropdownMenuPrimitive.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50"
                >
                  {condition === "scheduled" ? "指定時刻に投稿" : "写真が添付されたら投稿"}
                  <ChevronDown className="size-4" aria-hidden="true" />
                </button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) rounded-xl border bg-card p-1 shadow-lg outline-none animation-duration-150 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                >
                  <DropdownMenuPrimitive.RadioGroup
                    value={condition}
                    onValueChange={(value) => setCondition(value as "scheduled" | "photo_required")}
                  >
                    <DropdownMenuPrimitive.RadioItem
                      value="scheduled"
                      className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm outline-none select-none focus:bg-muted"
                    >
                      指定時刻に投稿
                      <DropdownMenuPrimitive.ItemIndicator>
                        <Check className="size-4 text-primary" />
                      </DropdownMenuPrimitive.ItemIndicator>
                    </DropdownMenuPrimitive.RadioItem>
                    <DropdownMenuPrimitive.RadioItem
                      value="photo_required"
                      className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm outline-none select-none focus:bg-muted"
                    >
                      写真が添付されたら投稿
                      <DropdownMenuPrimitive.ItemIndicator>
                        <Check className="size-4 text-primary" />
                      </DropdownMenuPrimitive.ItemIndicator>
                    </DropdownMenuPrimitive.RadioItem>
                  </DropdownMenuPrimitive.RadioGroup>
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">予約日時（JST）</span>
            <input
              name="scheduledAt"
              type="datetime-local"
              defaultValue={localDateTime}
              required
              className="w-full rounded-xl border bg-card p-3"
            />
          </label>
          <button
            type="submit"
            disabled={!loaderData.accounts.length}
            className="w-full rounded-full bg-primary px-5 py-3 font-bold text-white transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:duration-100 motion-reduce:active:scale-[0.99] disabled:opacity-50"
          >
            {post ? "変更を保存" : "予約する"}
          </button>
          {post ? (
            <div className="space-y-3">
              <Link to="/posts" className="block text-center text-sm text-muted-foreground">
                キャンセル
              </Link>
              <button
                type="submit"
                name="intent"
                value="delete"
                className="w-full rounded-full border border-destructive px-5 py-3 font-bold text-destructive transition-colors hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-destructive/50"
                onClick={(event) => {
                  if (!window.confirm("この予約投稿を削除します。よろしいですか？"))
                    event.preventDefault();
                }}
              >
                削除
              </button>
            </div>
          ) : null}
        </div>
      </Form>
    </AppShell>
  );
}

function MediaGrid({
  existingMedia,
  newImages,
  onRemoveExisting,
  onRemoveNew,
}: {
  existingMedia: { id: string; altText: string }[];
  newImages: { file: File; url: string }[];
  onRemoveExisting: (id: string) => void;
  onRemoveNew: (url: string) => void;
}) {
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const images = [
    ...existingMedia.map((image) => ({
      id: image.id,
      src: `/api/media/${image.id}`,
      alt: image.altText,
      inputName: `alt-${image.id}`,
      isNew: false,
      remove: () => onRemoveExisting(image.id),
    })),
    ...newImages.map((image, index) => ({
      src: image.url,
      alt: "",
      inputName: `new-alt-${index}`,
      isNew: true,
      remove: () => onRemoveNew(image.url),
    })),
  ];
  if (images.length === 0) return null;
  return (
    <div
      className={`grid overflow-hidden rounded-2xl bg-muted ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {images.map((image, index) => (
        <div
          key={image.src}
          className={`relative min-w-0 ${image.isNew ? "animate-in fade-in-0 zoom-in-95 animation-duration-150 ease-out motion-reduce:animation-duration-100" : ""} ${images.length === 3 && index === 0 ? "row-span-2" : ""}`}
          style={
            images.length === 1 ? { aspectRatio: imageAspectRatios[image.src] ?? 3 / 4 } : undefined
          }
        >
          <img
            src={image.src}
            alt={image.alt}
            className={`h-full w-full object-cover ${images.length === 1 ? "" : "aspect-square"}`}
            onLoad={(event) => {
              if (images.length !== 1) return;
              const { naturalHeight, naturalWidth } = event.currentTarget;
              if (!naturalWidth || !naturalHeight) return;
              setImageAspectRatios((ratios) => ({
                ...ratios,
                [image.src]: Math.max(naturalWidth / naturalHeight, 3 / 4),
              }));
            }}
          />
          <button
            type="button"
            onClick={image.remove}
            className="absolute top-2 right-2 rounded-full bg-black/55 p-1 text-white/75 shadow-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-primary/70"
            aria-label="画像を削除"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <AltTextDialog inputName={image.inputName} defaultValue={image.alt} />
        </div>
      ))}
    </div>
  );
}

function AltTextDialog({ inputName, defaultValue }: { inputName: string; defaultValue: string }) {
  const [altText, setAltText] = useState(defaultValue);
  return (
    <DialogPrimitive.Root>
      <input type="hidden" name={inputName} value={altText} />
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="absolute right-2 bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white/75 shadow-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-[3px] focus-visible:ring-primary/70"
          aria-label="画像の説明（Alt）を編集"
        >
          Alt
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-xl outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="font-semibold">画像の説明</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                画像を見られない人にも内容が伝わるように説明します。
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="rounded-full p-1 hover:bg-muted" aria-label="閉じる">
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <label className="mt-4 block">
            <span className="sr-only">画像の説明</span>
            <textarea
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              rows={3}
              placeholder="画像の説明を入力"
              className="w-full resize-none rounded-xl border bg-background p-3 text-sm"
            />
          </label>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TagUsersDialog() {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <Tag className="size-3" aria-hidden="true" />
          タグ付けするユーザー
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-xl outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="font-semibold">
                タグ付けするユーザー
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                ユーザー名を空白またはカンマで区切って入力します。
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="rounded-full p-1 hover:bg-muted" aria-label="閉じる">
                <X className="size-5" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <input
            form="schedule-form"
            name="tagHandles"
            placeholder="@gdg_tokyo @gdg_osaka"
            className="mt-4 w-full rounded-xl border bg-background p-3"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function XAccountAvatar({
  account,
}: {
  account: { displayName: string; profileImageUrl: string | null; username: string };
}) {
  return (
    <span className="flex size-10 shrink-0 overflow-hidden rounded-full bg-foreground text-background">
      {account.profileImageUrl ? (
        <img
          src={account.profileImageUrl}
          alt={`${account.displayName} のXアカウントアイコン`}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-lg" aria-hidden="true">
          𝕏
        </span>
      )}
    </span>
  );
}
