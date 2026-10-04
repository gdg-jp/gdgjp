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
import { softSpring, spring } from "./transitions";

export function StepProgress({ current }: { current: number }) {
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
