import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Icons,
  Input,
  PageHeader,
  Stack,
} from "@gdgjp/design-system";
import { useEffect, useMemo, useState } from "react";
import type { TagRow } from "~/features/tags/components/tag-list";
import { TagListItem } from "~/features/tags/components/tag-list";
import { EmptyState } from "~/features/tags/components/tag-list";
import { CreateTagForm } from "~/features/tags/components/tag-list";
import { EditTagForm } from "~/features/tags/components/tag-list";
import { DeleteTagAlert } from "~/features/tags/components/tag-list";
import { loader as loadPage, action as mutatePage } from "~/features/tags/page.server";

import { DashboardShell } from "~/layouts/dashboard-shell";
import type { Route } from "./+types/tags";

export function meta() {
  return [{ title: "Tags — GDG Japan Links" }];
}

export function loader(args: Route.LoaderArgs) {
  return loadPage(args);
}

export function action(args: Route.ActionArgs) {
  return mutatePage(args);
}

const PAGE_SIZE = 10;

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
      <Stack className="mx-auto w-full min-w-0 max-w-6xl">
        <PageHeader
          title={
            <>
              Tags{" "}
              {
                <a
                  href="https://dub.co/help/article/how-to-use-tags"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Learn about tags"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  <Icons name="CircleHelp" aria-hidden="true" className="size-4" />
                </a>
              }
            </>
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

        <div className="rounded-xl border bg-surface">
          <div className="p-4">
            <div className="relative">
              <Icons
                name="Search"
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search..."
                className="h-10 rounded-full bg-surface/40 pl-10"
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
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
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
      </Stack>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md p-0 sm:max-w-md">
          {editTarget ? <EditTagForm tag={editTarget} onDone={() => setEditTarget(null)} /> : null}
        </DialogContent>
      </Dialog>

      <DeleteTagAlert tag={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </DashboardShell>
  );
}
