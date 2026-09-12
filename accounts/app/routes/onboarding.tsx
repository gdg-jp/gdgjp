import type { AuthUser } from "@gdgjp/gdg-lib";
import { useTranslation } from "react-i18next";
import { Link, data, redirect } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { OnboardingWizard } from "~/components/onboarding/onboarding-wizard";
import { ThemeToggle } from "~/components/theme-toggle";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { isOnboardingVisibleSlug } from "~/lib/chapter-regions";
import {
  bustChaptersWithCountsCache,
  getChapterById,
  getOrganizerEmailsForChapter,
  listChapters,
  listMembershipsForUser,
  requestMembership,
} from "~/lib/db";
import { sendJoinRequestSubmitted } from "~/lib/email.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { clearOnboardingSkip, serializeOnboardingSkip } from "~/lib/onboarding-skip.server";
import type { Route } from "./+types/onboarding";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, userResult] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).then(
      (u) => ({ ok: true as const, user: u }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
  ]);
  if (!userResult.ok) {
    if (userResult.err instanceof Response && userResult.err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw userResult.err;
  }
  const user: AuthUser = userResult.user;
  const memberships = await listMembershipsForUser(env.DB, user.id);
  if (memberships.length > 0) {
    throw redirect("/dashboard", {
      headers: { "Set-Cookie": await clearOnboardingSkip() },
    });
  }
  const chapters = (await listChapters(env.DB))
    .filter((c) => isOnboardingVisibleSlug(c.slug))
    .map(({ id, slug, name, kind, region }) => ({ id, slug, name, kind, region }));
  return { user, chapters, title: t("meta.onboarding") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  const locale = (await i18n.getLocale(args.request)) === "ja" ? "ja" : "en";
  let user: AuthUser;
  try {
    user = await requireUser(env, args.request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw err;
  }

  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "skip") {
    throw redirect("/dashboard", {
      headers: { "Set-Cookie": await serializeOnboardingSkip() },
    });
  }

  if (intent === "request") {
    const rawIds = form.getAll("chapterId").map((v) => Number(v));
    const chapterIds = [...new Set(rawIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (chapterIds.length === 0) {
      return { error: t("errors.selectChapter") };
    }

    const accepted: number[] = [];
    for (const chapterId of chapterIds) {
      const chapter = await getChapterById(env.DB, chapterId);
      if (!chapter || !isOnboardingVisibleSlug(chapter.slug)) {
        return { error: t("errors.chapterNotFound") };
      }
      const result = await requestMembership(env.DB, user.id, chapterId);
      if (!result.ok && result.reason === "chapter_not_found") {
        return { error: t("errors.chapterNotFound") };
      }
      // already_in_chapter: treat as success for idempotent multi-submit
      if (result.ok || result.reason === "already_in_chapter") {
        accepted.push(chapterId);
      }
      if (result.ok) {
        const organizerEmails = await getOrganizerEmailsForChapter(env.DB, chapterId);
        sendJoinRequestSubmitted(
          { env, ctx: args.context.cloudflare.ctx, locale },
          {
            chapter,
            requester: {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              isAdmin: user.isAdmin,
            },
            organizerEmails,
          },
        );
      }
    }

    if (accepted.length === 0) {
      return { error: t("errors.selectChapter") };
    }
    await bustChaptersWithCountsCache();
    return data(
      { ok: true as const, intent: "request" as const, chapterIds: accepted },
      { headers: { "Set-Cookie": await clearOnboardingSkip() } },
    );
  }

  return { error: t("errors.unknownAction") };
}

export default function OnboardingPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-10 sm:py-14">
        <div>
          <Link
            to="/dashboard"
            className="mb-8 inline-flex w-fit items-center gap-3 rounded-md px-3 py-2 pr-4"
            aria-label={loaderData.user.name}
          >
            <GdgMark size="sm" />
            <span className="text-sm font-medium tracking-tight">{t("app.name")}</span>
          </Link>
        </div>
        <OnboardingWizard chapters={loaderData.chapters} />
      </main>
    </div>
  );
}
