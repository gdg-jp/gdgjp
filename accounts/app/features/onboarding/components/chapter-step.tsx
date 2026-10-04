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

export function ChapterStep({
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
                    fullWidth
                    className="min-h-14 justify-start p-3.5 text-left sm:p-4"
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
