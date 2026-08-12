import { Check, GraduationCap, MapPin, Search, Sparkles, Users } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SubmitButton } from "~/components/ui/submit-button";
import { CHAPTER_REGIONS } from "~/lib/chapter-regions";
import type { Chapter, ChapterKind, ChapterRegion } from "~/lib/db";
import { cn } from "~/lib/utils";

export type OnboardingChapter = Pick<Chapter, "id" | "slug" | "name" | "kind" | "region">;

type WizardStep = "kind" | "chapter" | "more" | "done";

type RequestActionData = { ok: true; intent: "request"; chapterIds: number[] } | { error: string };

const spring = { type: "spring" as const, stiffness: 380, damping: 32 };
const softSpring = { type: "spring" as const, stiffness: 280, damping: 28 };
const STEP_COLORS = ["bg-gdg-blue", "bg-gdg-red", "bg-gdg-yellow", "bg-gdg-green"] as const;

function stepIndex(step: WizardStep): number {
  switch (step) {
    case "kind":
      return 0;
    case "chapter":
      return 1;
    case "more":
      return 2;
    case "done":
      return 3;
  }
}

export function OnboardingWizard({ chapters }: { chapters: OnboardingChapter[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const fetcher = useFetcher<RequestActionData>();
  const [step, setStep] = useState<WizardStep>("kind");
  const [direction, setDirection] = useState(1);
  const [kind, setKind] = useState<ChapterKind | null>(null);
  const [region, setRegion] = useState<ChapterRegion | null>(null);
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [extraIds, setExtraIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");

  const kindChapters = useMemo(
    () => (kind ? chapters.filter((c) => c.kind === kind) : []),
    [chapters, kind],
  );

  const regionsWithChapters = useMemo(() => {
    const present = new Set(kindChapters.map((c) => c.region));
    return CHAPTER_REGIONS.filter((r) => r !== "other" && present.has(r));
  }, [kindChapters]);

  useEffect(() => {
    if (!region && regionsWithChapters.length > 0) {
      setRegion(regionsWithChapters[0] ?? null);
    }
  }, [region, regionsWithChapters]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return kindChapters.filter((c) => {
      if (region && c.region !== region) return false;
      if (!q) return true;
      return `${c.name} ${c.slug}`.toLocaleLowerCase().includes(q);
    });
  }, [kindChapters, query, region]);

  const primary = primaryId == null ? null : (chapters.find((c) => c.id === primaryId) ?? null);
  const moreCandidates = kindChapters.filter((c) => c.id !== primaryId);

  const isSubmitting = fetcher.state !== "idle";
  const requestError = fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined;
  const requestedIds =
    fetcher.data && "ok" in fetcher.data && fetcher.data.ok ? fetcher.data.chapterIds : null;

  useEffect(() => {
    if (requestedIds && step !== "done") {
      setDirection(1);
      setStep("done");
    }
  }, [requestedIds, step]);

  function go(next: WizardStep, dir: number) {
    setDirection(dir);
    setStep(next);
  }

  function selectKind(next: ChapterKind) {
    setKind(next);
    setRegion(null);
    setPrimaryId(null);
    setExtraIds([]);
    setQuery("");
    go("chapter", 1);
  }

  function toggleExtra(id: number) {
    setExtraIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submitRequests(ids: number[]) {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length === 0) return;
    const fd = new FormData();
    fd.set("intent", "request");
    for (const id of unique) fd.append("chapterId", String(id));
    fetcher.submit(fd, { method: "post" });
  }

  const transition = reduceMotion ? { duration: 0 } : softSpring;
  const variants = {
    enter: (dir: number) => (reduceMotion ? { opacity: 0 } : { x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => (reduceMotion ? { opacity: 0 } : { x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  if (chapters.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <h1 className="text-2xl font-medium tracking-tight">{t("onboarding.empty.title")}</h1>
        <p className="text-muted-foreground">{t("onboarding.empty.description")}</p>
        <Button asChild variant="outline">
          <Link to="/dashboard">{t("onboarding.done.dashboard")}</Link>
        </Button>
      </div>
    );
  }

  const current = stepIndex(step);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.05 }}
        className="space-y-4 text-center sm:text-left"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-gdg-blue" />
            <span className="size-1.5 rounded-full bg-gdg-red" />
            <span className="size-1.5 rounded-full bg-gdg-yellow" />
            <span className="size-1.5 rounded-full bg-gdg-green" />
          </span>
          {t("app.name")}
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
            {t("onboarding.title")}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("onboarding.subtitle")}
          </p>
        </div>
        <StepProgress current={current} />
      </motion.header>

      {requestError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("onboarding.errorTitle")}</AlertTitle>
          <AlertDescription>{requestError}</AlertDescription>
        </Alert>
      ) : null}

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.12 }}
        className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/80 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)] backdrop-blur-md"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(90deg, var(--color-gdg-blue), var(--color-gdg-red), var(--color-gdg-yellow), var(--color-gdg-green))",
          }}
        />
        <div className="relative min-h-[24rem] p-5 sm:p-7">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              className="flex min-h-[22rem] flex-col"
            >
              {step === "kind" ? <KindStep onSelect={selectKind} /> : null}
              {step === "chapter" && kind ? (
                <ChapterStep
                  kind={kind}
                  regions={regionsWithChapters}
                  region={region}
                  onRegionChange={setRegion}
                  query={query}
                  onQueryChange={setQuery}
                  chapters={filtered}
                  primaryId={primaryId}
                  onSelect={setPrimaryId}
                  onBack={() => go("kind", -1)}
                  onContinue={() => {
                    if (primaryId != null) go("more", 1);
                  }}
                  primaryName={primary?.name}
                />
              ) : null}
              {step === "more" && kind && primary ? (
                <MoreStep
                  kind={kind}
                  primary={primary}
                  candidates={moreCandidates}
                  extraIds={extraIds}
                  onToggle={toggleExtra}
                  onBack={() => go("chapter", -1)}
                  onSubmit={() => submitRequests([primary.id, ...extraIds])}
                  pending={isSubmitting}
                />
              ) : null}
              {step === "done" && requestedIds ? (
                <DoneStep chapters={chapters.filter((c) => requestedIds.includes(c.id))} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function StepProgress({ current }: { current: number }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const labels = [
    t("onboarding.steps.kind"),
    t("onboarding.steps.chapter"),
    t("onboarding.steps.more"),
    t("onboarding.steps.done"),
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {STEP_COLORS.map((color, i) => (
          <motion.div
            key={color}
            className={cn("h-full flex-1 first:rounded-l-full last:rounded-r-full", color)}
            initial={false}
            animate={{ opacity: i <= current ? 1 : 0.15, scaleY: i <= current ? 1 : 0.7 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: i * 0.04 }}
            style={{ transformOrigin: "center" }}
          />
        ))}
      </div>
      <ol className="flex items-center justify-between gap-2" aria-label={t("onboarding.title")}>
        {labels.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
              <motion.span
                layout
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  active
                    ? "bg-foreground text-background"
                    : done
                      ? cn(STEP_COLORS[i], "text-white")
                      : "bg-muted text-muted-foreground",
                )}
                animate={
                  reduceMotion || !active
                    ? undefined
                    : { scale: [1, 1.08, 1], transition: { duration: 0.45 } }
                }
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </motion.span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:inline",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

function KindStep({ onSelect }: { onSelect: (kind: ChapterKind) => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center sm:text-left">
        <h2 className="text-xl font-medium tracking-tight">{t("onboarding.kind.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.kind.subtitle")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              kind: "gdg" as const,
              icon: Users,
              title: t("onboarding.kind.gdgTitle"),
              description: t("onboarding.kind.gdgDescription"),
              bar: "from-gdg-blue via-gdg-blue/80 to-gdg-blue/40",
              iconWrap: "bg-gdg-blue/10 text-gdg-blue",
              accent: "hover:border-gdg-blue/50 hover:bg-gdg-blue/[0.04]",
            },
            {
              kind: "gdgoc" as const,
              icon: GraduationCap,
              title: t("onboarding.kind.gdgocTitle"),
              description: t("onboarding.kind.gdgocDescription"),
              bar: "from-gdg-green via-gdg-green/80 to-gdg-green/40",
              iconWrap: "bg-gdg-green/10 text-gdg-green",
              accent: "hover:border-gdg-green/50 hover:bg-gdg-green/[0.04]",
            },
          ] as const
        ).map((option, index) => (
          <motion.button
            key={option.kind}
            type="button"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.08 + index * 0.08 }}
            whileHover={reduceMotion ? undefined : { y: -3, scale: 1.015 }}
            whileTap={reduceMotion ? undefined : { scale: 0.985 }}
            onClick={() => onSelect(option.kind)}
            className={cn(
              "group relative flex min-h-36 flex-col gap-4 overflow-hidden rounded-2xl border border-border/80 bg-background/80 p-5 text-left shadow-sm transition-colors",
              option.accent,
            )}
          >
            <span
              className={cn("absolute inset-x-0 top-0 h-1 bg-linear-to-r", option.bar)}
              aria-hidden="true"
            />
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-105",
                option.iconWrap,
              )}
            >
              <option.icon className="size-5" aria-hidden="true" />
            </span>
            <span className="space-y-1.5">
              <span className="block text-lg font-medium tracking-tight">{option.title}</span>
              <span className="block text-sm leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function ChapterStep({
  kind,
  regions,
  region,
  onRegionChange,
  query,
  onQueryChange,
  chapters,
  primaryId,
  onSelect,
  onBack,
  onContinue,
  primaryName,
}: {
  kind: ChapterKind;
  regions: ChapterRegion[];
  region: ChapterRegion | null;
  onRegionChange: (region: ChapterRegion) => void;
  query: string;
  onQueryChange: (q: string) => void;
  chapters: OnboardingChapter[];
  primaryId: number | null;
  onSelect: (id: number) => void;
  onBack: () => void;
  onContinue: () => void;
  primaryName?: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const accent = kind === "gdg" ? "gdg-blue" : "gdg-green";

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="space-y-1 text-center sm:text-left">
        <h2 className="text-xl font-medium tracking-tight">{t("onboarding.chapter.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.chapter.subtitle")}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">
          {t("onboarding.chapter.regionLabel")}
        </legend>
        <LayoutGroup id="region-pills">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
            {regions.map((r) => {
              const selected = region === r;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onRegionChange(r)}
                  className={cn(
                    "relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors",
                    selected
                      ? accent === "gdg-blue"
                        ? "text-gdg-blue"
                        : "text-gdg-green"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {selected ? (
                    <motion.span
                      layoutId="region-pill"
                      className={cn(
                        "absolute inset-0 rounded-full border",
                        accent === "gdg-blue"
                          ? "border-gdg-blue/40 bg-gdg-blue/10"
                          : "border-gdg-green/40 bg-gdg-green/10",
                      )}
                      transition={reduceMotion ? { duration: 0 } : spring}
                    />
                  ) : (
                    <span className="absolute inset-0 rounded-full border border-border/80" />
                  )}
                  <MapPin className="relative size-3.5" aria-hidden="true" />
                  <span className="relative">{t(`region.${r}`)}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </fieldset>

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("onboarding.chapter.searchPlaceholder")}
          aria-label={t("onboarding.chapter.searchAria")}
          className="h-11 rounded-xl border-border/80 bg-background/70 pl-9"
        />
      </div>

      {chapters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
          {t("onboarding.chapter.noMatches")}
        </p>
      ) : (
        <ul className="grid max-h-[16rem] gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[18rem] sm:grid-cols-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {chapters.map((chapter, index) => {
              const selected = primaryId === chapter.id;
              return (
                <motion.li
                  key={chapter.id}
                  layout
                  initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { ...spring, delay: Math.min(index, 10) * 0.025 }
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSelect(chapter.id)}
                    className={cn(
                      "relative flex min-h-14 w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors sm:p-4",
                      selected
                        ? accent === "gdg-blue"
                          ? "border-gdg-blue bg-gdg-blue/5 shadow-[0_0_0_1px_rgba(66,133,244,0.25)]"
                          : "border-gdg-green bg-gdg-green/5 shadow-[0_0_0_1px_rgba(52,168,83,0.25)]"
                        : "border-border/80 bg-background/60 hover:bg-muted/50",
                    )}
                  >
                    {selected ? (
                      <motion.span
                        layoutId="chapter-check"
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white",
                          accent === "gdg-blue" ? "bg-gdg-blue" : "bg-gdg-green",
                        )}
                        transition={reduceMotion ? { duration: 0 } : spring}
                      >
                        <Check className="size-3" aria-hidden="true" />
                      </motion.span>
                    ) : (
                      <span className="mt-0.5 size-5 shrink-0 rounded-full border border-border" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{chapter.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {chapter.slug}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {primaryName ? (
        <p
          className={cn(
            "truncate rounded-xl border px-3 py-2 text-sm",
            accent === "gdg-blue"
              ? "border-gdg-blue/30 bg-gdg-blue/5 text-gdg-blue"
              : "border-gdg-green/30 bg-gdg-green/5 text-gdg-green",
          )}
        >
          {t("onboarding.chapter.selected", { name: primaryName })}
        </p>
      ) : null}

      <StepFooter>
        <Button type="button" variant="ghost" onClick={onBack} className="w-full sm:w-auto">
          {t("onboarding.back")}
        </Button>
        <motion.div
          className="w-full sm:w-auto"
          animate={
            primaryId == null || reduceMotion
              ? undefined
              : { scale: [1, 1.02, 1], transition: { duration: 0.35 } }
          }
          key={primaryId ?? "none"}
        >
          <Button
            type="button"
            size="lg"
            disabled={primaryId == null}
            onClick={onContinue}
            className="w-full sm:min-w-40"
          >
            {t("onboarding.continue")}
          </Button>
        </motion.div>
      </StepFooter>
    </div>
  );
}

function MoreStep({
  kind,
  primary,
  candidates,
  extraIds,
  onToggle,
  onBack,
  onSubmit,
  pending,
}: {
  kind: ChapterKind;
  primary: OnboardingChapter;
  candidates: OnboardingChapter[];
  extraIds: number[];
  onToggle: (id: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const totalCount = 1 + extraIds.length;
  const submitLabel =
    extraIds.length > 0
      ? t("onboarding.more.submitWithCount", { count: totalCount })
      : t("onboarding.more.submit");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="space-y-1 text-center sm:text-left">
        <h2 className="text-xl font-medium tracking-tight">{t("onboarding.more.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.more.subtitle", {
            kind: kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc"),
          })}
        </p>
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-3 rounded-2xl border px-4 py-3",
          kind === "gdg"
            ? "border-gdg-blue/30 bg-gdg-blue/5"
            : "border-gdg-green/30 bg-gdg-green/5",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
            kind === "gdg" ? "bg-gdg-blue" : "bg-gdg-green",
          )}
        >
          <Check className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">{primary.name}</p>
          <p className="text-muted-foreground">{t("onboarding.more.primaryLabel")}</p>
        </div>
      </motion.div>

      {candidates.length > 0 ? (
        <ul className="grid max-h-[14rem] gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[16rem] sm:grid-cols-2">
          {candidates.map((chapter, index) => {
            const selected = extraIds.includes(chapter.id);
            return (
              <motion.li
                key={chapter.id}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduceMotion ? { duration: 0 } : { ...spring, delay: Math.min(index, 12) * 0.02 }
                }
              >
                <button
                  type="button"
                  onClick={() => onToggle(chapter.id)}
                  className={cn(
                    "flex min-h-14 w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border/80 bg-background/60 hover:bg-muted/50",
                  )}
                >
                  <motion.span
                    animate={selected && !reduceMotion ? { scale: [0.9, 1.08, 1] } : { scale: 1 }}
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                      selected && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {selected ? <Check className="size-3" aria-hidden="true" /> : null}
                  </motion.span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{chapter.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`region.${chapter.region}`)}
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      ) : null}

      <StepFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {t("onboarding.back")}
        </Button>
        <SubmitButton
          type="button"
          size="lg"
          pending={pending}
          pendingLabel={t("onboarding.more.submitPending")}
          onClick={onSubmit}
          className="w-full sm:min-w-44"
        >
          {submitLabel}
        </SubmitButton>
      </StepFooter>
    </div>
  );
}

function DoneStep({ chapters }: { chapters: OnboardingChapter[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const burst = [
    { className: "bg-gdg-blue", x: -28, y: -18 },
    { className: "bg-gdg-red", x: 26, y: -22 },
    { className: "bg-gdg-yellow", x: -22, y: 20 },
    { className: "bg-gdg-green", x: 30, y: 16 },
  ];

  return (
    <div className="space-y-6 text-center">
      <div className="relative mx-auto grid place-items-center py-2">
        {!reduceMotion
          ? burst.map((dot, i) => (
              <motion.span
                key={dot.className}
                className={cn("absolute size-2.5 rounded-full", dot.className)}
                initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                animate={{ opacity: [0, 1, 0], scale: [0.4, 1, 0.6], x: dot.x, y: dot.y }}
                transition={{ duration: 0.9, delay: 0.1 + i * 0.05, ease: "easeOut" }}
                aria-hidden="true"
              />
            ))
          : null}
        <motion.div
          initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : softSpring}
          className="relative flex size-20 items-center justify-center rounded-full bg-gdg-green/15 text-gdg-green"
        >
          <motion.span
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.12 }}
          >
            <Check className="size-9" aria-hidden="true" />
          </motion.span>
        </motion.div>
      </div>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.15 }}
        className="space-y-2"
      >
        <h2 className="text-2xl font-medium tracking-tight">{t("onboarding.done.title")}</h2>
        <p className="mx-auto max-w-md text-muted-foreground">{t("onboarding.done.subtitle")}</p>
      </motion.div>
      <ul className="mx-auto max-w-sm space-y-2 text-left">
        {chapters.map((c, index) => (
          <motion.li
            key={c.id}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.2 + index * 0.06 }}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 text-sm"
          >
            <span className="truncate font-medium">{c.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-gdg-green">
              <Sparkles className="size-3" aria-hidden="true" />
              {t("onboarding.done.requested")}
            </span>
          </motion.li>
        ))}
      </ul>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.28 }}
      >
        <Button asChild size="lg" className="w-full sm:w-auto sm:min-w-44">
          <Link to="/dashboard">{t("onboarding.done.dashboard")}</Link>
        </Button>
      </motion.div>
    </div>
  );
}
