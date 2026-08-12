import type { AuthUser } from "@gdgjp/gdg-lib";
import { motion, useReducedMotion } from "motion/react";
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
            requester: { id: user.id, email: user.email, name: user.name },
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

function AmbientOrb({
  className,
  reduceMotion,
  delay = 0,
  x = 0,
  y = 0,
}: {
  className: string;
  reduceMotion: boolean | null;
  delay?: number;
  x?: number;
  y?: number;
}) {
  return (
    <motion.div
      aria-hidden="true"
      className={className}
      initial={false}
      animate={
        reduceMotion
          ? undefined
          : {
              x: [0, x, 0],
              y: [0, y, 0],
              scale: [1, 1.06, 1],
            }
      }
      transition={
        reduceMotion
          ? undefined
          : { duration: 14 + delay * 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay }
      }
    />
  );
}

export default function OnboardingPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative min-h-dvh overflow-hidden bg-muted/40">
      <AmbientOrb
        reduceMotion={reduceMotion}
        className="pointer-events-none absolute -top-36 -right-20 size-[28rem] rounded-full bg-gdg-blue/15 blur-3xl"
        x={-24}
        y={30}
      />
      <AmbientOrb
        reduceMotion={reduceMotion}
        className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-gdg-green/15 blur-3xl"
        delay={1.2}
        x={28}
        y={-22}
      />
      <AmbientOrb
        reduceMotion={reduceMotion}
        className="pointer-events-none absolute top-[28%] left-[42%] size-[18rem] -translate-x-1/2 rounded-full bg-gdg-yellow/12 blur-3xl"
        delay={2}
        x={18}
        y={24}
      />
      <AmbientOrb
        reduceMotion={reduceMotion}
        className="pointer-events-none absolute top-[55%] right-[12%] size-[14rem] rounded-full bg-gdg-red/10 blur-3xl"
        delay={0.6}
        x={-16}
        y={-18}
      />

      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-10 sm:py-14">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 30 }
          }
        >
          <Link
            to="/dashboard"
            className="mb-8 inline-flex w-fit items-center gap-3 rounded-2xl border border-border/50 bg-background/50 px-3 py-2 pr-4 shadow-sm backdrop-blur-sm transition-colors hover:bg-background/80"
            aria-label={loaderData.user.name}
          >
            <GdgMark size="sm" />
            <span className="text-sm font-medium tracking-tight">{t("app.name")}</span>
          </Link>
        </motion.div>
        <OnboardingWizard chapters={loaderData.chapters} />
      </main>
    </div>
  );
}
