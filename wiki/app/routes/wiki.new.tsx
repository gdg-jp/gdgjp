import { eq } from "drizzle-orm";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { ArrowLeft } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { useThemeMode } from "~/hooks/useThemeMode";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { generateSlug } from "~/lib/ingestion-pipeline.server";
import { insertPageOwner } from "~/lib/page-access.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const meta: MetaFunction = () => [{ title: "New Page — GDGoC Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const canLead = user.isAdmin;
  return {
    canPublish: canLead,
    canChangeVisibility: canLead,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const formData = await request.formData();
  const intent = formData.get("intent") as "save" | "publish";
  const titleJa = (formData.get("titleJa") as string) ?? "";
  const titleEn = (formData.get("titleEn") as string) ?? "";
  const contentJa = (formData.get("contentJa") as string) ?? "";
  const contentEn = (formData.get("contentEn") as string) ?? "";
  const visibility = (formData.get("visibility") as string) || "public";

  const canLead = user.isAdmin;
  const isPublish = intent === "publish" && canLead;

  // Generate unique slug
  const baseSlug = generateSlug(titleJa || titleEn, titleEn);
  let slug = baseSlug;
  const existing = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.slug, slug))
    .get();
  if (existing) {
    slug = `${baseSlug}-${nanoid(6)}`;
  }

  const pageId = nanoid();

  await db.insert(schema.pages).values({
    id: pageId,
    titleJa,
    titleEn,
    slug,
    contentJa,
    contentEn,
    status: isPublish ? "published" : "draft",
    visibility,
    chapterId: null,
    authorId: user.id,
    lastEditedBy: user.id,
  });

  await insertPageOwner(db, pageId, user.id, user.email);

  if (isPublish) {
    await env.TRANSLATION_QUEUE.send({ pageId });
    return redirect(`/wiki/${slug}`);
  }

  return redirect(`/wiki/${slug}/edit`);
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function NewPage() {
  const { canPublish, canChangeVisibility } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const theme = useThemeMode();

  const [titleJa, setTitleJa] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [contentJa, setContentJa] = useState("");
  const [contentEn, setContentEn] = useState("");
  const [activeLang, setActiveLang] = useState<"ja" | "en">("ja");
  const [visibility, setVisibility] = useState("public");

  const isJaActive = activeLang === "ja";
  const isEnActive = activeLang === "en";

  return (
    <Form method="post" className="flex flex-col" style={{ height: "calc(100dvh - 3.5rem)" }}>
      {/* Hidden content fields — always kept in sync */}
      <input type="hidden" name="contentJa" value={contentJa} />
      <input type="hidden" name="contentEn" value={contentEn} />
      {canChangeVisibility && <input type="hidden" name="visibility" value={visibility} />}

      {/* ------------------------------------------------------------------ */}
      {/* Mini-header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky top-14 z-10 grid grid-cols-2 items-center gap-x-2 gap-y-1 border-b border-gray-200 bg-white px-3 py-2 shadow-sm sm:flex sm:flex-wrap sm:gap-2">
        {/* Row 1 col 1 (mobile) / inline (desktop): back + title */}
        <div className="flex min-w-0 items-center gap-1 sm:flex-1">
          <Link
            to="/"
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={t("editor.back_to_page")}
          >
            <ArrowLeft size={18} />
          </Link>

          {/* Title inputs — toggled by active language, both always in DOM */}
          <input
            name="titleJa"
            value={titleJa}
            onChange={(e) => setTitleJa(e.target.value)}
            placeholder={t("editor.title_ja")}
            required={isJaActive}
            aria-hidden={!isJaActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isJaActive ? "hidden" : ""}`}
          />
          <input
            name="titleEn"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder={t("editor.title_en")}
            aria-hidden={!isEnActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEnActive ? "hidden" : ""}`}
          />
        </div>

        {/* Row 1 col 2 (mobile) / inline (desktop): lang switcher + actions */}
        <div className="flex shrink-0 items-center justify-end gap-2 sm:ml-auto">
          {/* Language switcher */}
          <div className="flex shrink-0 overflow-hidden rounded-md border border-gray-200">
            {(["ja", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setActiveLang(lang)}
                className={`px-3 py-1 text-sm font-medium transition-colors ${
                  activeLang === lang
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                {lang === "ja" ? t("language.ja") : t("language.en")}
              </button>
            ))}
          </div>

          {/* Visibility select */}
          {canChangeVisibility && (
            <select
              aria-label={t("wiki.visibility")}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="max-w-36 shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700"
            >
              <option value="public">{t("wiki.visibility_public")}</option>
              <option value="private_to_chapter">{t("wiki.visibility_chapter")}</option>
              <option value="private_to_lead">{t("wiki.visibility_lead")}</option>
            </select>
          )}

          <button
            type="submit"
            name="intent"
            value="save"
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span className="hidden sm:inline">{t("editor.save_draft")}</span>
            <span className="sm:hidden">{t("editor.save")}</span>
          </button>
          {canPublish && (
            <button
              type="submit"
              name="intent"
              value="publish"
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {t("editor.publish")} ↗
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Editor body — no padding, full size                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className={`min-h-0 flex-1 ${isJaActive ? "" : "hidden"}`}>
        <MdEditor
          modelValue={contentJa}
          onChange={setContentJa}
          language="en-US"
          theme={theme}
          style={{ height: "100%" }}
        />
      </div>
      <div className={`min-h-0 flex-1 ${isEnActive ? "" : "hidden"}`}>
        <MdEditor
          modelValue={contentEn}
          onChange={setContentEn}
          language="en-US"
          theme={theme}
          style={{ height: "100%" }}
        />
      </div>
    </Form>
  );
}
