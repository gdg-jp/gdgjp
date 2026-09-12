import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Icons,
  Input,
  Progress,
  ProgressIndicator,
  Stack,
  Text,
} from "@gdgjp/ui";
import { cn } from "@gdgjp/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { CHAPTER_REGIONS } from "~/lib/chapter-regions";
import type { Chapter, ChapterKind, ChapterRegion } from "~/lib/db";

export type OnboardingChapter = Pick<Chapter, "id" | "slug" | "name" | "kind" | "region">;

type WizardStep = "kind" | "chapter" | "more" | "done";

type RequestActionData = { ok: true; intent: "request"; chapterIds: number[] } | { error: string };

const spring = { type: "spring" as const, stiffness: 380, damping: 32 };
const softSpring = { type: "spring" as const, stiffness: 280, damping: 28 };
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
      <Stack align="center" className="mx-auto max-w-lg text-center">
        <Heading level={1}>{t("onboarding.empty.title")}</Heading>
        <Text tone="muted">{t("onboarding.empty.description")}</Text>
        <Button asChild variant="outline">
          <Link to="/dashboard">{t("onboarding.done.dashboard")}</Link>
        </Button>
      </Stack>
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
        <Badge tone="info" className="w-fit">
          {t("app.name")}
        </Badge>
        <Stack className="gap-2">
          <Heading level={1} className="text-3xl sm:text-4xl">
            {t("onboarding.title")}
          </Heading>
          <Text tone="muted" className="max-w-xl sm:text-base">
            {t("onboarding.subtitle")}
          </Text>
        </Stack>
        <StepProgress current={current} />
      </motion.header>

      {requestError ? (
        <Alert tone="danger" title={t("onboarding.errorTitle")}>
          {requestError}
        </Alert>
      ) : null}

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.12 }}
        className="relative"
      >
        <Card className="onboarding-card p-5 sm:p-7">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              className="onboarding-step flex flex-col"
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
        </Card>
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
      <Progress value={(current / (labels.length - 1)) * 100} aria-label={t("onboarding.title")}>
        <ProgressIndicator />
      </Progress>
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
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "onboarding-success-icon bg-success"
                      : "bg-neutral text-muted",
                )}
                animate={
                  reduceMotion || !active
                    ? undefined
                    : { scale: [1, 1.08, 1], transition: { duration: 0.45 } }
                }
                aria-current={active ? "step" : undefined}
              >
                {done ? <Icons name="Check" size={14} aria-hidden="true" /> : i + 1}
              </motion.span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:inline",
                  active ? "font-medium text-foreground" : "text-muted",
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
  return (
    <Stack>
      <Stack className="gap-1 text-center sm:text-left">
        <Heading level={2}>{t("onboarding.kind.title")}</Heading>
        <Text size="sm" tone="muted">
          {t("onboarding.kind.subtitle")}
        </Text>
      </Stack>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              kind: "gdg" as const,
              icon: "Users" as const,
              title: t("onboarding.kind.gdgTitle"),
              description: t("onboarding.kind.gdgDescription"),
              iconWrap: "bg-gdg-blue/10 text-gdg-blue",
            },
            {
              kind: "gdgoc" as const,
              icon: "GraduationCap" as const,
              title: t("onboarding.kind.gdgocTitle"),
              description: t("onboarding.kind.gdgocDescription"),
              iconWrap: "bg-gdg-green/10 text-gdg-green",
            },
          ] as const
        ).map((option) => (
          <Button
            key={option.kind}
            type="button"
            onClick={() => onSelect(option.kind)}
            variant="outline"
            className="min-h-36 flex-col items-start gap-4 p-5 text-left"
          >
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-2xl",
                option.iconWrap,
              )}
            >
              <Icons name={option.icon} size={20} aria-hidden="true" />
            </span>
            <span className="space-y-1.5">
              <span className="block text-lg font-medium tracking-tight">{option.title}</span>
              <span className="block text-sm leading-relaxed text-muted">{option.description}</span>
            </span>
          </Button>
        ))}
      </div>
    </Stack>
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

  return (
    <Stack className="flex-1">
      <Stack className="gap-1 text-center sm:text-left">
        <Heading level={2}>{t("onboarding.chapter.title")}</Heading>
        <Text size="sm" tone="muted">
          {t("onboarding.chapter.subtitle")}
        </Text>
      </Stack>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted">
          {t("onboarding.chapter.regionLabel")}
        </legend>
        <div className="onboarding-region-list -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {regions.map((r) => {
            const selected = region === r;
            return (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={selected ? "primary" : "outline"}
                aria-pressed={selected}
                onClick={() => onRegionChange(r)}
                className="shrink-0"
              >
                <Icons name="MapPin" size={14} aria-hidden="true" />
                {t(`region.${r}`)}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <FormField
        id="onboarding-chapter-search"
        label={t("onboarding.chapter.searchAria")}
        hideLabel
        className="gap-0"
      >
        <div className="relative">
          <Icons
            name="Search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("onboarding.chapter.searchPlaceholder")}
            className="w-full pl-9"
          />
        </div>
      </FormField>

      {chapters.length === 0 ? (
        <Text
          size="sm"
          tone="muted"
          className="rounded-md border border-dashed border-border px-4 py-8 text-center"
        >
          {t("onboarding.chapter.noMatches")}
        </Text>
      ) : (
        <ul className="onboarding-chapter-list grid gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
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
                  <Button
                    type="button"
                    variant={selected ? "primary" : "outline"}
                    onClick={() => onSelect(chapter.id)}
                    aria-pressed={selected}
                    className="min-h-14 w-full justify-start p-3.5 text-left sm:p-4"
                  >
                    {selected ? <Icons name="Check" size={16} aria-hidden="true" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{chapter.name}</span>
                      <span className="block truncate font-mono text-xs text-muted">
                        {chapter.slug}
                      </span>
                    </span>
                  </Button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {primaryName ? (
        <Text className="truncate rounded-md border border-border px-3 py-2 text-sm">
          {t("onboarding.chapter.selected", { name: primaryName })}
        </Text>
      ) : null}

      <StepFooter>
        <Button type="button" variant="ghost" fullWidth onClick={onBack} className="sm:w-auto">
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
            fullWidth
            disabled={primaryId == null}
            onClick={onContinue}
            className="sm:min-w-40"
          >
            {t("onboarding.continue")}
          </Button>
        </motion.div>
      </StepFooter>
    </Stack>
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
    <Stack className="flex-1">
      <Stack className="gap-1 text-center sm:text-left">
        <Heading level={2}>{t("onboarding.more.title")}</Heading>
        <Text size="sm" tone="muted">
          {t("onboarding.more.subtitle", {
            kind: kind === "gdg" ? t("kind.gdg") : t("kind.gdgoc"),
          })}
        </Text>
      </Stack>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 rounded-md border border-border bg-neutral px-4 py-3"
      >
        <span className="onboarding-success-icon flex size-9 shrink-0 items-center justify-center rounded-full bg-success">
          <Icons name="Check" size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <Text className="truncate font-medium">{primary.name}</Text>
          <Text size="sm" tone="muted">
            {t("onboarding.more.primaryLabel")}
          </Text>
        </div>
      </motion.div>

      {candidates.length > 0 ? (
        <ul className="onboarding-extra-list grid gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
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
                <div className="flex min-h-14 w-full items-start gap-3 rounded-md border border-border bg-surface p-3.5 text-left">
                  <Checkbox
                    id={`onboarding-extra-${chapter.id}`}
                    checked={selected}
                    onCheckedChange={() => onToggle(chapter.id)}
                  />
                  <span className="min-w-0">
                    <label
                      htmlFor={`onboarding-extra-${chapter.id}`}
                      className="block truncate text-sm font-medium"
                    >
                      {chapter.name}
                    </label>
                    <span className="block text-xs text-muted">
                      {t(`region.${chapter.region}`)}
                    </span>
                  </span>
                </div>
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
          fullWidth
          className="sm:w-auto"
        >
          {t("onboarding.back")}
        </Button>
        <Button
          type="button"
          size="lg"
          loading={pending}
          onClick={onSubmit}
          fullWidth
          className="sm:min-w-44"
        >
          {submitLabel}
        </Button>
      </StepFooter>
    </Stack>
  );
}

function DoneStep({ chapters }: { chapters: OnboardingChapter[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <Stack align="center" className="text-center">
      <div className="relative mx-auto grid place-items-center py-2">
        <motion.div
          initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : softSpring}
          className="relative flex size-20 items-center justify-center rounded-full bg-success/15 text-success"
        >
          <motion.span
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.12 }}
          >
            <Icons name="Check" size={36} aria-hidden="true" />
          </motion.span>
        </motion.div>
      </div>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.15 }}
        className="space-y-2"
      >
        <Heading level={2}>{t("onboarding.done.title")}</Heading>
        <Text tone="muted" className="mx-auto max-w-md">
          {t("onboarding.done.subtitle")}
        </Text>
      </motion.div>
      <ul className="mx-auto max-w-sm space-y-2 text-left">
        {chapters.map((c, index) => (
          <motion.li
            key={c.id}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={reduceMotion ? { duration: 0 } : { ...spring, delay: 0.2 + index * 0.06 }}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-neutral px-3 py-2.5 text-sm"
          >
            <span className="truncate font-medium">{c.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
              <Icons name="Sparkles" size={12} aria-hidden="true" />
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
        <Button asChild size="lg" fullWidth className="sm:w-auto sm:min-w-44">
          <Link to="/dashboard">{t("onboarding.done.dashboard")}</Link>
        </Button>
      </motion.div>
    </Stack>
  );
}
