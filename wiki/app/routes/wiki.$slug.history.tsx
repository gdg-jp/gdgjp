import { diffLines } from "diff";
import { eq } from "drizzle-orm";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/preview.css";
import { History } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import * as schema from "~/db/schema";
import { useThemeMode } from "~/hooks/useThemeMode";
import { hasRole, requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { canUserSeePageAsync } from "~/lib/page-visibility.server";
import { tiptapToMarkdown } from "~/lib/tiptap-convert";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data
      ? `History: ${data.page.titleEn || data.page.titleJa} — GDGoC Japan Wiki`
      : "Page history",
  },
];

type VersionRow = {
  id: string;
  titleJa: string;
  titleEn: string;
  editedBy: string;
  savedAt: number;
  editorName: string | null;
};

type VersionRaw = {
  id: string;
  title_ja: string;
  title_en: string;
  edited_by: string;
  saved_at: number;
  editor_name: string | null;
};

type VersionFullRaw = VersionRaw & {
  content_ja: string;
  content_en: string;
};

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireRole(request, env, "member");
  const db = getDb(env);

  const page = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      slug: schema.pages.slug,
      status: schema.pages.status,
      visibility: schema.pages.visibility,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page || page.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  if (!(await canUserSeePageAsync(db, sessionUser, page))) {
    throw new Response("Not Found", { status: 404 });
  }

  const versionsResult = (await env.DB.prepare(
    `SELECT pv.id, pv.title_ja, pv.title_en, pv.edited_by, pv.saved_at,
            u.name AS editor_name
     FROM page_versions pv
     LEFT JOIN user u ON pv.edited_by = u.id
     WHERE pv.page_id = ?
     ORDER BY pv.saved_at DESC
     LIMIT 10`,
  )
    .bind(page.id)
    .all()) as { results: VersionRaw[] };

  const versions: VersionRow[] = (versionsResult.results ?? []).map((r) => ({
    id: r.id,
    titleJa: r.title_ja,
    titleEn: r.title_en,
    editedBy: r.edited_by,
    savedAt: r.saved_at,
    editorName: r.editor_name,
  }));

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const lang: "ja" | "en" = langParam === "ja" || langParam === "en" ? langParam : "ja";
  const versionId = url.searchParams.get("v");

  let selectedVersion: {
    id: string;
    titleJa: string;
    titleEn: string;
    contentJa: string;
    contentEn: string;
    savedAt: number;
    editorName: string | null;
  } | null = null;

  if (versionId) {
    const vRow = (await env.DB.prepare(
      `SELECT pv.id, pv.title_ja, pv.title_en, pv.content_ja, pv.content_en, pv.saved_at,
              u.name AS editor_name
       FROM page_versions pv
       LEFT JOIN user u ON pv.edited_by = u.id
       WHERE pv.id = ? AND pv.page_id = ?`,
    )
      .bind(versionId, page.id)
      .first()) as VersionFullRaw | null;

    if (vRow) {
      selectedVersion = {
        id: vRow.id,
        titleJa: vRow.title_ja,
        titleEn: vRow.title_en,
        contentJa: tiptapToMarkdown(vRow.content_ja ?? ""),
        contentEn: tiptapToMarkdown(vRow.content_en ?? ""),
        savedAt: vRow.saved_at,
        editorName: vRow.editor_name,
      };
    }
  }

  const userRole = sessionUser.role as string;
  const canRevert = hasRole(userRole, "lead") || page.authorId === sessionUser.id;

  return {
    page: {
      slug: page.slug,
      titleJa: page.titleJa,
      titleEn: page.titleEn,
      currentContentJa: tiptapToMarkdown(page.contentJa ?? ""),
      currentContentEn: tiptapToMarkdown(page.contentEn ?? ""),
    },
    versions,
    selectedVersion,
    lang,
    canRevert,
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const versionId = formData.get("versionId") as string | null;

  if (intent !== "revert" || !versionId) {
    throw new Response("Bad Request", { status: 400 });
  }

  const db = getDb(env);
  const page = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      authorId: schema.pages.authorId,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      status: schema.pages.status,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page || page.status !== "published") throw new Response("Not Found", { status: 404 });

  const userRole = user.role as string;
  if (!hasRole(userRole, "lead") && page.authorId !== user.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const vRow = (await env.DB.prepare(
    `SELECT content_ja, content_en, title_ja, title_en
     FROM page_versions WHERE id = ? AND page_id = ?`,
  )
    .bind(versionId, page.id)
    .first()) as {
    content_ja: string;
    content_en: string;
    title_ja: string;
    title_en: string;
  } | null;

  if (!vRow) throw new Response("Version Not Found", { status: 404 });

  const snapshotId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.batch([
    // Snapshot current state before overwriting
    env.DB.prepare(
      `INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId,
      page.id,
      page.contentJa,
      page.contentEn,
      page.titleJa,
      page.titleEn,
      user.id,
      now,
    ),
    // Overwrite with version content
    env.DB.prepare(
      `UPDATE pages SET title_ja = ?, title_en = ?, content_ja = ?, content_en = ?,
          last_edited_by = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(vRow.title_ja, vRow.title_en, vRow.content_ja, vRow.content_en, user.id, page.id),
    // Prune — keep last 10
    env.DB.prepare(
      `DELETE FROM page_versions WHERE page_id = ? AND id NOT IN (
         SELECT id FROM page_versions WHERE page_id = ? ORDER BY saved_at DESC LIMIT 10
       )`,
    ).bind(page.id, page.id),
  ]);

  return redirect(`/wiki/${params.slug}`);
}

function relativeTimeDiff(savedAt: number): { key: string; count?: number } {
  const diffMs = Date.now() - savedAt * 1000;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return { key: "time.just_now" };
  if (diffMins < 60) return { key: "time.minutes_ago", count: diffMins };
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return { key: "time.hours_ago", count: diffHours };
  return { key: "time.days_ago", count: Math.floor(diffHours / 24) };
}

export default function WikiHistory() {
  const { page, versions, selectedVersion, lang, canRevert } = useLoaderData<typeof loader>();
  const { t } = useTranslation("common");
  const theme = useThemeMode();
  const [diffMode, setDiffMode] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const revertFetcher = useFetcher();

  const pageTitle = lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  const versionUrl = (vId: string, l = lang) => {
    const p = new URLSearchParams({ lang: l, v: vId });
    return `/wiki/${page.slug}/history?${p}`;
  };

  const langUrl = (l: string) => {
    const p = new URLSearchParams({ lang: l });
    if (selectedVersion) p.set("v", selectedVersion.id);
    return `/wiki/${page.slug}/history?${p}`;
  };

  const displayTitle = selectedVersion
    ? lang === "en"
      ? selectedVersion.titleEn || selectedVersion.titleJa
      : selectedVersion.titleJa || selectedVersion.titleEn
    : null;

  const versionContent = selectedVersion
    ? lang === "en"
      ? selectedVersion.contentEn || selectedVersion.contentJa
      : selectedVersion.contentJa || selectedVersion.contentEn
    : null;

  const currentContent =
    lang === "en"
      ? page.currentContentEn || page.currentContentJa
      : page.currentContentJa || page.currentContentEn;

  const diffResult =
    diffMode && selectedVersion && versionContent
      ? diffLines(currentContent ?? "", versionContent)
      : null;

  const isReverting = revertFetcher.state !== "idle";

  return (
    <div className="flex min-h-full flex-col">
      {/* Mini-header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 md:px-10">
        <Link to={`/wiki/${page.slug}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← {pageTitle}
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
          <History size={14} />
          {t("wiki.history")}
        </div>
      </div>

      <div className="flex flex-1 gap-0 px-4 py-4 md:px-10 md:py-6">
        {/* Left: version list */}
        <aside className="mr-6 w-56 shrink-0 border-r border-gray-100 pr-4">
          {versions.length === 0 ? (
            <p className="text-sm text-gray-400">{t("wiki.history_empty")}</p>
          ) : (
            <ul className="space-y-1">
              {/* "Current" entry linking back to live page */}
              <li>
                <Link
                  to={`/wiki/${page.slug}`}
                  className="block rounded-md px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                >
                  <div className="font-medium text-gray-700">{t("wiki.history_current")}</div>
                  <div className="truncate text-xs text-gray-400">{pageTitle}</div>
                </Link>
              </li>

              {versions.map((v) => {
                const isActive = selectedVersion?.id === v.id;
                const rt = relativeTimeDiff(v.savedAt);
                const timeStr = rt.count !== undefined ? t(rt.key, { count: rt.count }) : t(rt.key);
                return (
                  <li key={v.id}>
                    <Link
                      to={versionUrl(v.id)}
                      className={[
                        "block rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700"
                          : "text-gray-600 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      <div className="truncate font-medium">
                        {lang === "en" ? v.titleEn || v.titleJa : v.titleJa || v.titleEn}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {v.editorName ?? v.editedBy.slice(0, 8)}
                        {" · "}
                        {timeStr}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Right: content preview */}
        <div className="min-w-0 flex-1">
          {/* Language tabs + Preview/Diff toggle */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex w-fit shrink-0 gap-1 rounded-md border border-gray-200 bg-white p-0.5">
              {(["ja", "en"] as const).map((l) => {
                const isActive = lang === l;
                return (
                  <Link
                    key={l}
                    to={langUrl(l)}
                    className={[
                      "min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors",
                      isActive ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-100",
                    ].join(" ")}
                  >
                    {l === "ja" ? "JA" : "EN"}
                  </Link>
                );
              })}
            </div>

            {selectedVersion && (
              <div className="flex w-fit gap-1 rounded-md border border-gray-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setDiffMode(false)}
                  className={[
                    "rounded px-2 py-1 text-sm font-medium transition-colors",
                    !diffMode ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-100",
                  ].join(" ")}
                >
                  {t("wiki.history_preview")}
                </button>
                <button
                  type="button"
                  onClick={() => setDiffMode(true)}
                  className={[
                    "rounded px-2 py-1 text-sm font-medium transition-colors",
                    diffMode ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-100",
                  ].join(" ")}
                >
                  {t("wiki.history_diff")}
                </button>
              </div>
            )}
          </div>

          {selectedVersion ? (
            <>
              <h1 className="mb-4 text-2xl font-bold text-gray-900">{displayTitle}</h1>

              {diffMode && diffResult ? (
                <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed">
                  {diffResult.map((part, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable diff output
                      key={i}
                      className={
                        part.added
                          ? "bg-green-50 text-green-800"
                          : part.removed
                            ? "bg-red-50 text-red-700 line-through"
                            : "text-gray-700"
                      }
                    >
                      {part.value
                        .split("\n")
                        .filter(
                          (_, idx, arr) =>
                            idx < arr.length - 1 || part.value.endsWith("\n") || arr.length === 1,
                        )
                        .map((line, lineIdx) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable line output
                          <span key={lineIdx} className="block whitespace-pre">
                            {part.added ? "+ " : part.removed ? "- " : "  "}
                            {line}
                          </span>
                        ))}
                    </div>
                  ))}
                </pre>
              ) : versionContent ? (
                <MdPreview
                  modelValue={versionContent}
                  theme={theme}
                  autoFoldThreshold={Number.POSITIVE_INFINITY}
                />
              ) : (
                <p className="text-gray-400">{t("wiki.history_no_content")}</p>
              )}

              {canRevert && (
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setRevertOpen(true)}
                    disabled={isReverting}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    {isReverting ? t("wiki.history_reverting") : t("wiki.history_revert")}
                  </button>
                </div>
              )}

              <ConfirmDialog
                open={revertOpen}
                title={t("wiki.history_revert_title")}
                message={t("wiki.history_revert_confirm")}
                confirmLabel={t("wiki.history_revert")}
                cancelLabel={t("cancel")}
                onConfirm={() => {
                  setRevertOpen(false);
                  revertFetcher.submit(
                    { intent: "revert", versionId: selectedVersion.id },
                    { method: "post" },
                  );
                }}
                onCancel={() => setRevertOpen(false)}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <History size={32} className="mb-3 opacity-30" />
              <p className="text-sm">{t("wiki.history_empty")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
