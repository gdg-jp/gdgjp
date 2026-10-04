import { eq } from "drizzle-orm";
import { MdEditor } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { useTheme } from "@gdgjp/design-system";

import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect } from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/features/auth/utils.server";
import { generateSlug } from "~/features/ingestion/slug";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

import { Icons } from "@gdgjp/design-system";
export const meta: MetaFunction = () => [{ title: "New Page — GDG Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const formData = await request.formData();
  const titleJa = (formData.get("titleJa") as string) ?? "";
  const titleEn = (formData.get("titleEn") as string) ?? "";
  const contentJa = (formData.get("contentJa") as string) ?? "";
  const contentEn = (formData.get("contentEn") as string) ?? "";

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
    translationStatusEn: titleEn.trim() || contentEn.trim() ? "human" : "missing",
    status: "published",
    visibility: "restricted",
    generalRole: "viewer",
    origin: "human",
    chapterId: null,
    authorId: user.id,
    lastEditedBy: user.id,
  });

  return redirect(`/wiki/${slug}`, { headers: { "X-Wiki-Page-Id": pageId } });
}

// ---------------------------------------------------------------------------
// Route component
// ---------------------------------------------------------------------------

export default function NewPage() {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const [titleJa, setTitleJa] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [contentJa, setContentJa] = useState("");
  const [contentEn, setContentEn] = useState("");
  const [activeLang, setActiveLang] = useState<"ja" | "en">("ja");

  const isJaActive = activeLang === "ja";
  const isEnActive = activeLang === "en";

  return (
    <Form method="post" className="flex flex-col" style={{ height: "calc(100dvh - 3.5rem)" }}>
      {/* Hidden content fields — always kept in sync */}
      <input type="hidden" name="contentJa" value={contentJa} />
      <input type="hidden" name="contentEn" value={contentEn} />

      {/* ------------------------------------------------------------------ */}
      {/* Mini-header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky top-14 z-10 grid grid-cols-2 items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-2 shadow-sm sm:flex sm:flex-wrap sm:gap-2">
        {/* Row 1 col 1 (mobile) / inline (desktop): back + title */}
        <div className="flex min-w-0 items-center gap-1 sm:flex-1">
          <Link
            to="/"
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-neutral hover:text-foreground"
            aria-label={t("editor.back_to_page")}
          >
            <Icons name="ArrowLeft" size={18} />
          </Link>

          {/* Title inputs — toggled by active language, both always in DOM */}
          <input
            name="titleJa"
            value={titleJa}
            onChange={(e) => setTitleJa(e.target.value)}
            placeholder={t("editor.title_ja")}
            required={isJaActive}
            aria-hidden={!isJaActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ring ${!isJaActive ? "hidden" : ""}`}
          />
          <input
            name="titleEn"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder={t("editor.title_en")}
            aria-hidden={!isEnActive}
            className={`min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-base font-medium text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ring ${!isEnActive ? "hidden" : ""}`}
          />
        </div>

        {/* Row 1 col 2 (mobile) / inline (desktop): lang switcher + actions */}
        <div className="flex shrink-0 items-center justify-end gap-2 sm:ml-auto">
          {/* Language switcher */}
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
            {(["ja", "en"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setActiveLang(lang)}
                className={`px-3 py-1 text-sm font-medium transition-colors ${
                  activeLang === lang
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-surface text-muted hover:bg-neutral hover:text-foreground"
                }`}
              >
                {lang === "ja" ? t("language.ja") : t("language.en")}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t("editor.publish")} ↗
          </button>
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
