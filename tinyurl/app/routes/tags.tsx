import {
  Globe,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Form, useFetcher } from "react-router";
import { toast } from "sonner";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import { GdgMark } from "~/components/gdg-mark";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  type TagWithCount,
  createTag,
  deleteTag,
  listTagsForChapterWithCounts,
  listTagsForUserWithCounts,
  updateTag,
} from "~/lib/db";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/tags";

export function meta() {
  return [{ title: "Tags — GDG Japan Links" }];
}

const TAG_COLORS = ["red", "yellow", "green", "blue", "purple", "brown", "gray"] as const;
type TagColor = (typeof TAG_COLORS)[number];

function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}

function normalizeColor(value: string | null | undefined): TagColor {
  if (!value) return "gray";
  const lower = value.toLowerCase();
  if (isTagColor(lower)) return lower;
  return "gray";
}

const COLOR_CLASSES: Record<TagColor, { bg: string; text: string; ring: string; chip: string }> = {
  red: {
    bg: "bg-red-100 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    ring: "ring-red-200 dark:ring-red-900",
    chip: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  yellow: {
    bg: "bg-yellow-100 dark:bg-yellow-950/40",
    text: "text-yellow-700 dark:text-yellow-300",
    ring: "ring-yellow-200 dark:ring-yellow-900",
    chip: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  green: {
    bg: "bg-green-100 dark:bg-green-950/40",
    text: "text-green-700 dark:text-green-300",
    ring: "ring-green-200 dark:ring-green-900",
    chip: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
  blue: {
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-200 dark:ring-blue-900",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-950/40",
    text: "text-purple-700 dark:text-purple-300",
    ring: "ring-purple-200 dark:ring-purple-900",
    chip: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  brown: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-800 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-900",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  gray: {
    bg: "bg-gray-100 dark:bg-gray-800/60",
    text: "text-gray-700 dark:text-gray-300",
    ring: "ring-gray-300 dark:ring-gray-700",
    chip: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
  },
};

const PAGE_SIZE = 10;

async function requireAuthAndChapter(args: Route.LoaderArgs | Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter } = await requireUserWithChapter(env, args.request);
  return { env, user, chapter };
}

export async function loader(args: Route.LoaderArgs) {
  const { env, user, chapter } = await requireAuthAndChapter(args);
  const [userTags, chapterTags] = await Promise.all([
    listTagsForUserWithCounts(env.DB, user.id),
    listTagsForChapterWithCounts(env.DB, chapter.chapterId),
  ]);
  return { user: { email: user.email, name: user.name }, userTags, chapterTags, chapter };
}

type ActionData = { ok: true } | { error: string };

export async function action(args: Route.ActionArgs): Promise<ActionData | null> {
  const { env, user, chapter } = await requireAuthAndChapter(args);
  const form = await args.request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid tag id." };
    await deleteTag(env.DB, id);
    return { ok: true };
  }

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const color = normalizeColor(String(form.get("color") ?? ""));
    const scope = String(form.get("scope") ?? "user");
    if (!name) return { error: "Name is required." };
    if (name.length > 32) return { error: "Name must be 32 characters or less." };

    if (scope === "chapter") {
      const result = await createTag(env.DB, {
        name,
        color,
        ownerChapterId: chapter.chapterId,
      });
      if (!result.ok) return { error: `Tag "${name}" already exists.` };
      return { ok: true };
    }
    const result = await createTag(env.DB, {
      name,
      color,
      ownerUserId: user.id,
    });
    if (!result.ok) return { error: `Tag "${name}" already exists.` };
    return { ok: true };
  }

  if (intent === "update") {
    const id = Number(form.get("id"));
    const name = String(form.get("name") ?? "").trim();
    const color = normalizeColor(String(form.get("color") ?? ""));
    if (!Number.isInteger(id) || id <= 0) return { error: "Invalid tag id." };
    if (!name) return { error: "Name is required." };
    if (name.length > 32) return { error: "Name must be 32 characters or less." };
    const result = await updateTag(env.DB, { id, name, color });
    if (!result.ok) return { error: `Tag "${name}" already exists.` };
    return { ok: true };
  }

  return { error: "Unknown action." };
}

type TagRow = TagWithCount & { scope: "user" | "chapter" };

export default function Tags({ loaderData }: Route.ComponentProps) {
  const { user, userTags, chapterTags, chapter } = loaderData;

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);

  const tags: TagRow[] = useMemo(() => {
    const u: TagRow[] = userTags.map((t) => ({ ...t, scope: "user" }));
    const c: TagRow[] = chapterTags.map((t) => ({ ...t, scope: "chapter" }));
    return [...u, ...c].sort((a, b) => a.name.localeCompare(b.name));
  }, [userTags, chapterTags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const visible = filtered.slice(pageStart, pageEnd);

  // Keyboard shortcut: "C" opens create dialog
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      setCreateOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DashboardShell user={user}>
      <DashboardPage>
        <DashboardPageHeader
          title="Tags"
          titleAccessory={
            <a
              href="https://dub.co/help/article/how-to-use-tags"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Learn about tags"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <HelpCircle className="size-4" />
            </a>
          }
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-foreground text-background hover:bg-foreground/90">
                  Create tag
                  <kbd className="rounded border border-background/30 bg-background/10 px-1.5 py-0.5 text-[10px] font-medium leading-none">
                    C
                  </kbd>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md p-0 sm:max-w-md">
                <CreateTagForm chapter={chapter} onDone={() => setCreateOpen(false)} />
              </DialogContent>
            </Dialog>
          }
        />

        <div className="rounded-xl border bg-card">
          <div className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search..."
                className="h-10 rounded-full bg-muted/40 pl-10"
              />
            </div>
          </div>

          <div>
            {visible.length === 0 ? (
              <EmptyState query={query} hasAny={tags.length > 0} />
            ) : (
              <ul className="divide-y">
                {visible.map((tag) => (
                  <TagListItem
                    key={`${tag.scope}-${tag.id}`}
                    tag={tag}
                    onEdit={() => setEditTarget(tag)}
                    onDelete={() => setDeleteTarget(tag)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Viewing {pageStart + 1}-{pageEnd} of {filtered.length}{" "}
              {filtered.length === 1 ? "tag" : "tags"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </DashboardPage>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md p-0 sm:max-w-md">
          {editTarget ? <EditTagForm tag={editTarget} onDone={() => setEditTarget(null)} /> : null}
        </DialogContent>
      </Dialog>

      <DeleteTagAlert tag={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </DashboardShell>
  );
}

function TagListItem({
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
          <TagIcon className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">{tag.name}</span>
        {tag.scope === "chapter" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Chapter
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
          <Globe className="size-3" />
          <span className="tabular-nums">{tag.linkCount}</span>{" "}
          {tag.linkCount === 1 ? "link" : "links"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${tag.name}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function EmptyState({ query, hasAny }: { query: string; hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <TagIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">
        {query ? `No tags match "${query}"` : hasAny ? "No tags found" : "No tags yet"}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Tags help you organize your links. Create one to get started.
      </p>
    </div>
  );
}

function FormShell({
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
        <DialogDescription className="text-sm text-muted-foreground">
          {description}
        </DialogDescription>
      </div>
      {children}
    </div>
  );
}

function ColorSwatchRadio({
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
    <label
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
    </label>
  );
}

function CreateTagForm({
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

        <div className="space-y-2">
          <Label htmlFor="create-tag-name" className="text-sm font-medium">
            Tag Name
          </Label>
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
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Tag Color</Label>
            <HelpCircle className="size-3.5 text-muted-foreground" />
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
          <div className="space-y-2">
            <Label htmlFor="create-tag-scope" className="text-sm font-medium">
              Scope
            </Label>
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
          </div>
        ) : (
          <input type="hidden" name="scope" value="user" />
        )}

        <SubmitButton
          className="w-full"
          pending={submitting}
          pendingLabel="Creating…"
          disabled={!name.trim()}
        >
          {submitting ? "Creating…" : "Create tag"}
        </SubmitButton>
      </fetcher.Form>
    </FormShell>
  );
}

function EditTagForm({ tag, onDone }: { tag: TagRow; onDone: () => void }) {
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

        <div className="space-y-2">
          <Label htmlFor="edit-tag-name" className="text-sm font-medium">
            Tag Name
          </Label>
          <Input
            id="edit-tag-name"
            name="name"
            required
            maxLength={32}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Tag Color</Label>
            <HelpCircle className="size-3.5 text-muted-foreground" />
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

        <SubmitButton
          className="w-full"
          pending={submitting}
          pendingLabel="Saving…"
          disabled={!name.trim()}
        >
          {submitting ? "Saving…" : "Save changes"}
        </SubmitButton>
      </fetcher.Form>
    </FormShell>
  );
}

function DeleteTagAlert({ tag, onClose }: { tag: TagRow | null; onClose: () => void }) {
  return (
    <AlertDialog open={tag !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
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
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {tag ? (
            <Form method="post" onSubmit={onClose}>
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={tag.id} />
              <AlertDialogAction type="submit" variant="destructive">
                Delete
              </AlertDialogAction>
            </Form>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
