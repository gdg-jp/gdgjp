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
import { CHAPTER_REGIONS } from "~/features/chapters/chapter-regions";
import type { Chapter, ChapterKind, ChapterRegion } from "~/features/chapters/types";

import type { OnboardingChapter } from "../types";
import { ChapterStep } from "./chapter-step";
import { DoneStep } from "./done-step";
import { KindStep } from "./kind-step";
import { MoreStep } from "./more-step";
import { StepProgress } from "./step-progress";
import { softSpring, spring } from "./transitions";

type WizardStep = "kind" | "chapter" | "more" | "done";

type RequestActionData = { ok: true; intent: "request"; chapterIds: number[] } | { error: string };

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
