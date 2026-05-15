import { and, desc, eq } from "drizzle-orm";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import Tooltip from "~/components/Tooltip";
import * as schema from "~/db/schema";
import { hasRole, requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { deletePageEmbeddings } from "~/lib/embedding-pipeline.server";
import { timeAgo } from "~/lib/time";

export const meta: MetaFunction = () => [{ title: "Archived — GDGoC Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const db = getDb(env);

  const isAdmin = user.role === "admin";
  const isLead = hasRole(user.role as string, "lead");

  const pages = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      updatedAt: schema.pages.updatedAt,
      authorId: schema.pages.authorId,
    })
    .from(schema.pages)
    .where(
      isLead
        ? eq(schema.pages.status, "archived")
        : and(eq(schema.pages.status, "archived"), eq(schema.pages.authorId, user.id)),
    )
    .orderBy(desc(schema.pages.updatedAt))
    .all();

  return { pages, isAdmin, isLead, currentUserId: user.id };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");
  const db = getDb(env);

  const form = await request.formData();
  const intent = form.get("intent");
  const pageId = form.get("pageId") as string;

  if (!pageId) throw new Response("Missing pageId", { status: 400 });

  const page = await db
    .select({ id: schema.pages.id, authorId: schema.pages.authorId })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page) throw new Response("Not Found", { status: 404 });

  if (intent === "restorePage") {
    if (page.authorId !== user.id && !hasRole(user.role as string, "lead"))
      throw new Response("Forbidden", { status: 403 });
    await db
      .update(schema.pages)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(schema.pages.id, pageId));
    return {};
  }

  if (intent === "deletePage") {
    if (user.role !== "admin") throw new Response("Forbidden", { status: 403 });
    try {
      await deletePageEmbeddings(env, db, pageId);
    } catch {
      // best-effort cleanup
    }
    await db.batch([
      db.delete(schema.pageTags).where(eq(schema.pageTags.pageId, pageId)),
      db.delete(schema.pageAttachments).where(eq(schema.pageAttachments.pageId, pageId)),
      db.delete(schema.pageVersions).where(eq(schema.pageVersions.pageId, pageId)),
      db.delete(schema.pages).where(eq(schema.pages.id, pageId)),
    ]);
    return {};
  }

  throw new Response("Unknown intent", { status: 400 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PageRow = {
  id: string;
  authorId: string;
  titleJa: string;
  titleEn: string;
  updatedAt: Date | string | null;
};

function ArchivedRow({
  page,
  canRestore,
  canDelete,
}: {
  page: PageRow;
  canRestore: boolean;
  canDelete: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const title = page.titleEn || page.titleJa;

  const isActing = fetcher.state !== "idle";

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <span className="block truncate font-medium text-gray-800">{title}</span>
        {page.updatedAt && (
          <time className="text-xs text-gray-400">{timeAgo(new Date(page.updatedAt), t)}</time>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <fetcher.Form method="post">
          <input type="hidden" name="pageId" value={page.id} />
          <Tooltip label={t("archived.restore_no_permission")} disabled={!canRestore}>
            <button
              type="submit"
              name="intent"
              value="restorePage"
              disabled={isActing || !canRestore}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-green-50 hover:text-green-700 disabled:opacity-50"
            >
              <RotateCcw size={13} />
              {t("archived.restore")}
            </button>
          </Tooltip>
        </fetcher.Form>
        <Tooltip label={t("archived.delete_no_permission")} disabled={!canDelete}>
          <button
            type="button"
            disabled={isActing || !canDelete}
            onClick={canDelete ? () => setDeleteDialogOpen(true) : undefined}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            <Trash2 size={13} />
            {t("archived.delete")}
          </button>
        </Tooltip>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("archived.delete")}
        message={t("archived.delete_confirm", { title })}
        confirmLabel={t("archived.delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          fetcher.submit({ intent: "deletePage", pageId: page.id }, { method: "post" });
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </li>
  );
}

export default function ArchivedPage() {
  const { pages, isAdmin, isLead, currentUserId } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">{t("archived.title")}</h1>

      {!isLead && <p className="mb-6 text-sm text-gray-500">{t("archived.own_pages_note")}</p>}
      {isLead && <p className="mb-6 text-sm text-gray-500">{t("archived.all_pages_note")}</p>}

      {pages.length === 0 ? (
        <p className="text-sm text-gray-400">{t("archived.empty")}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {pages.map((page) => (
            <ArchivedRow
              key={page.id}
              page={page}
              canRestore={page.authorId === currentUserId || isLead}
              canDelete={isAdmin}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
