import { Check, ChevronDown, ImagePlus } from "lucide-react";
import {
  AlertDialog as AlertDialogPrimitive,
  DropdownMenu as DropdownMenuPrimitive,
} from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";
import {
  MediaGrid,
  TagUsersDialog,
  XAccountAvatar,
  XCharacterCounter,
  XPostComposer,
} from "~/features/posts/components/composer-controls";
import { MAX_IMAGES } from "~/features/posts/media-policy";
import { type PostingOption, postingOptionCookie } from "~/features/posts/posting-option";
import { loadSchedule, submitSchedule } from "~/features/posts/schedule.server";
import { parseXPostText } from "~/features/posts/x-text";
import { AppShell } from "~/layouts/app-shell";
import googlePhotosLogo from "../../../photos.png";
import type { Route } from "./+types/schedule";

export function loader({ request, context }: Route.LoaderArgs) {
  return loadSchedule(request, context.cloudflare.env);
}

export function action({ request, context }: Route.ActionArgs) {
  return submitSchedule(request, context.cloudflare.env);
}

export default function ScheduleEditor({ loaderData, actionData }: Route.ComponentProps) {
  const post = loaderData.post;
  const [xAccountId, setXAccountId] = useState(
    post?.xAccountId ?? loaderData.accounts[0]?.id ?? "",
  );
  const [postingOption, setPostingOption] = useState<PostingOption>(
    post?.condition ?? loaderData.defaultPostingOption,
  );
  const [text, setText] = useState(post?.text ?? "");
  const [newImages, setNewImages] = useState<{ file: File; url: string }[]>([]);
  const [deletedMediaIds, setDeletedMediaIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const selectedAccount = loaderData.accounts.find((account) => account.id === xAccountId);
  const existingMedia = loaderData.media.filter((media) => !deletedMediaIds.includes(media.id));
  const imageCount = existingMedia.length + newImages.length;
  const textResult = parseXPostText(text);
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
        <input type="hidden" name="postingOption" value={postingOption} />
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
          <label htmlFor="post-text" className="block">
            <span className="sr-only">本文</span>
            <XPostComposer text={text} textAreaRef={textAreaRef} onTextChange={setText} />
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
              <button
                type="submit"
                name="intent"
                value="save_and_add_google_photos"
                disabled={!loaderData.accounts.length}
                className="inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Google Photos から写真を選ぶ"
                title="Google Photos から選ぶ"
              >
                <img src={googlePhotosLogo} alt="" className="size-6" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <XCharacterCounter text={text} result={textResult} />
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50"
                  >
                    {postingOption === "immediate"
                      ? "今すぐ投稿"
                      : postingOption === "scheduled"
                        ? "指定時刻に投稿"
                        : "画像が添付されるまで待ってから投稿"}
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
                      value={postingOption}
                      onValueChange={(value) => {
                        const option = value as PostingOption;
                        setPostingOption(option);
                        document.cookie = postingOptionCookie(option);
                      }}
                    >
                      <DropdownMenuPrimitive.RadioItem
                        value="immediate"
                        className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm outline-none select-none focus:bg-muted"
                      >
                        今すぐ投稿
                        <DropdownMenuPrimitive.ItemIndicator>
                          <Check className="size-4 text-primary" />
                        </DropdownMenuPrimitive.ItemIndicator>
                      </DropdownMenuPrimitive.RadioItem>
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
                        画像が添付されるまで待ってから投稿
                        <DropdownMenuPrimitive.ItemIndicator>
                          <Check className="size-4 text-primary" />
                        </DropdownMenuPrimitive.ItemIndicator>
                      </DropdownMenuPrimitive.RadioItem>
                    </DropdownMenuPrimitive.RadioGroup>
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
            </div>
          </div>
          {postingOption !== "immediate" ? (
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
          ) : null}
          <button
            type="submit"
            disabled={!loaderData.accounts.length || !text.trim() || !textResult.valid}
            className="w-full rounded-full bg-primary px-5 py-3 font-bold text-white transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:duration-100 motion-reduce:active:scale-[0.99] disabled:opacity-50"
          >
            {post ? "変更を保存" : postingOption === "immediate" ? "今すぐ投稿" : "予約する"}
          </button>
          {post ? (
            <div className="space-y-3">
              <Link to="/posts" className="block text-center text-sm text-muted-foreground">
                キャンセル
              </Link>
              <AlertDialogPrimitive.Root>
                <AlertDialogPrimitive.Trigger asChild>
                  <button
                    type="button"
                    className="w-full rounded-full border border-destructive px-5 py-3 font-bold text-destructive transition-colors hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-destructive/50"
                  >
                    削除
                  </button>
                </AlertDialogPrimitive.Trigger>
                <AlertDialogPrimitive.Portal>
                  <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                  <AlertDialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-lg outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
                    <div className="grid gap-1.5 text-center sm:text-left">
                      <AlertDialogPrimitive.Title className="text-lg font-semibold">
                        予約投稿を削除しますか？
                      </AlertDialogPrimitive.Title>
                      <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
                        この操作は取り消せません。投稿と添付画像が削除されます。
                      </AlertDialogPrimitive.Description>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <AlertDialogPrimitive.Cancel asChild>
                        <button
                          type="button"
                          className="rounded-full border px-5 py-2 font-bold transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-primary/50"
                        >
                          キャンセル
                        </button>
                      </AlertDialogPrimitive.Cancel>
                      <AlertDialogPrimitive.Action asChild>
                        <button
                          type="submit"
                          form="schedule-form"
                          name="intent"
                          value="delete"
                          className="rounded-full bg-destructive px-5 py-2 font-bold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:ring-[3px] focus-visible:ring-destructive/50"
                        >
                          削除する
                        </button>
                      </AlertDialogPrimitive.Action>
                    </div>
                  </AlertDialogPrimitive.Content>
                </AlertDialogPrimitive.Portal>
              </AlertDialogPrimitive.Root>
            </div>
          ) : null}
        </div>
      </Form>
    </AppShell>
  );
}
