import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  cn,
  toast,
} from "@gdgjp/design-system";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import type { ActionData } from "~/features/tags/page.server";
import { TAG_COLORS } from "~/features/tags/tag-colors";
import type { TagColor } from "~/features/tags/tag-colors";
import { normalizeColor } from "~/features/tags/tag-colors";
import { COLOR_CLASSES } from "~/features/tags/tag-colors";
import type { TagWithCount } from "~/features/tags/tag-record";
export type TagRow = TagWithCount & { scope: "user" | "chapter" };

export function TagListItem({
  tag,
  onEdit,
  onDelete,
}: {
  tag: TagRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = normalizeColor(tag.color);
  const cls = COLOR_CLASSES[color];
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
            cls.bg,
            cls.text,
          )}
          aria-hidden
        >
          <Icons name="Tag" aria-hidden="true" className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">{tag.name}</span>
        {tag.scope === "chapter" ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            Chapter
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted">
          <Icons name="Globe" aria-hidden="true" className="size-3" />
          <span className="tabular-nums">{tag.linkCount}</span>{" "}
          {tag.linkCount === 1 ? "link" : "links"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" aria-label={`Actions for ${tag.name}`}>
              <Icons name="MoreHorizontal" aria-hidden="true" className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={onEdit}>
              <Icons name="Pencil" aria-hidden="true" className="size-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger" onSelect={onDelete}>
              <Icons name="Trash2" aria-hidden="true" className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function EmptyState({ query, hasAny }: { query: string; hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface">
        <Icons name="Tag" aria-hidden="true" className="size-5 text-muted" />
      </div>
      <p className="text-sm font-medium">
        {query ? `No tags match "${query}"` : hasAny ? "No tags found" : "No tags yet"}
      </p>
      <p className="max-w-sm text-xs text-muted">
        Tags help you organize your links. Create one to get started.
      </p>
    </div>
  );
}

export function FormShell({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
        <GdgMark size="md" />
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="text-sm text-muted">{description}</DialogDescription>
      </div>
      {children}
    </div>
  );
}

export function ColorSwatchRadio({
  name,
  value,
  selected,
  onChange,
}: {
  name: string;
  value: TagColor;
  selected: TagColor;
  onChange: (value: TagColor) => void;
}) {
  const active = selected === value;
  const cls = COLOR_CLASSES[value];
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <Label
      className={cn(
        "cursor-pointer select-none rounded-md px-2.5 py-1 text-xs font-medium transition-shadow",
        cls.chip,
        active ? "ring-2 ring-foreground/70" : "ring-1 ring-transparent hover:ring-foreground/20",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </Label>
  );
}

export function CreateTagForm({
  chapter,
  onDone,
}: {
  chapter: { chapterId: number; chapterSlug: string } | null;
  onDone: () => void;
}) {
  const fetcher = useFetcher<ActionData>();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("gray");
  const [scope, setScope] = useState<"user" | "chapter">("user");
  const submitting = fetcher.state !== "idle";
  const lastDataRef = useRef<unknown>(null);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;
    if ("ok" in data && data.ok) {
      toast.success(`Tag "${name}" created`);
      onDone();
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data, name, onDone]);

  return (
    <FormShell
      title="Create tag"
      description={
        <>
          Use tags to organize your links.{" "}
          <a
            href="https://dub.co/help/article/how-to-use-tags"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Learn more
          </a>
        </>
      }
    >
      <fetcher.Form method="post" className="space-y-5 px-6 pb-6 pt-4">
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="color" value={color} />

        <FormField id="create-tag-name" label={<>Tag Name</>} required>
          <Input
            id="create-tag-name"
            name="name"
            placeholder="New Tag"
            required
            maxLength={32}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Tag Color</Label>
            <Icons name="CircleHelp" aria-hidden="true" className="size-3.5 text-muted" />
          </div>
          <div className="flex flex-wrap gap-2">
            {TAG_COLORS.map((c) => (
              <ColorSwatchRadio
                key={c}
                name="color-radio"
                value={c}
                selected={color}
                onChange={setColor}
              />
            ))}
          </div>
        </div>

        {chapter ? (
          <FormField id="create-tag-scope" label={<>Scope</>}>
            <Select
              name="scope"
              value={scope}
              onValueChange={(v) => setScope(v as "user" | "chapter")}
            >
              <SelectTrigger id="create-tag-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">My tags</SelectItem>
                <SelectItem value="chapter">Chapter ({chapter.chapterSlug})</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <input type="hidden" name="scope" value="user" />
        )}

        <Button fullWidth type="submit" className="" loading={submitting} disabled={!name.trim()}>
          {submitting ? "Creating…" : "Create tag"}
        </Button>
      </fetcher.Form>
    </FormShell>
  );
}

export function EditTagForm({ tag, onDone }: { tag: TagRow; onDone: () => void }) {
  const fetcher = useFetcher<ActionData>();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(normalizeColor(tag.color));
  const submitting = fetcher.state !== "idle";
  const lastDataRef = useRef<unknown>(null);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;
    if ("ok" in data && data.ok) {
      toast.success(`Tag "${name}" updated`);
      onDone();
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data, name, onDone]);

  return (
    <FormShell title="Edit tag" description="Update the tag name or color.">
      <fetcher.Form method="post" className="space-y-5 px-6 pb-6 pt-4">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="id" value={tag.id} />
        <input type="hidden" name="color" value={color} />

        <FormField id="edit-tag-name" label={<>Tag Name</>} required>
          <Input
            id="edit-tag-name"
            name="name"
            required
            maxLength={32}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Tag Color</Label>
            <Icons name="CircleHelp" aria-hidden="true" className="size-3.5 text-muted" />
          </div>
          <div className="flex flex-wrap gap-2">
            {TAG_COLORS.map((c) => (
              <ColorSwatchRadio
                key={c}
                name="color-radio-edit"
                value={c}
                selected={color}
                onChange={setColor}
              />
            ))}
          </div>
        </div>

        <Button fullWidth type="submit" className="" loading={submitting} disabled={!name.trim()}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </fetcher.Form>
    </FormShell>
  );
}

export function DeleteTagAlert({ tag, onClose }: { tag: TagRow | null; onClose: () => void }) {
  return (
    <AlertDialog open={tag !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <div className="space-y-2">
          <AlertDialogTitle>Delete tag?</AlertDialogTitle>
          <AlertDialogDescription>
            {tag ? (
              <>
                Are you sure you want to delete <span className="font-medium">{tag.name}</span>?
                {tag.linkCount > 0 ? (
                  <>
                    {" "}
                    This will remove the tag from {tag.linkCount}{" "}
                    {tag.linkCount === 1 ? "link" : "links"}.
                  </>
                ) : null}{" "}
                This action cannot be undone.
              </>
            ) : null}
          </AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          {tag ? (
            <Form method="post" onSubmit={onClose}>
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={tag.id} />
              <AlertDialogAction asChild>
                <Button variant="danger" type="submit">
                  Delete
                </Button>
              </AlertDialogAction>
            </Form>
          ) : null}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
