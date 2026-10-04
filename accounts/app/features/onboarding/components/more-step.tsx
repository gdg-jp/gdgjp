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
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChapterKind, ChapterRegion } from "~/features/chapters/types";

import type { OnboardingChapter } from "../types";
import { StepFooter } from "./step-footer";
import { softSpring, spring } from "./transitions";

export function MoreStep({
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
