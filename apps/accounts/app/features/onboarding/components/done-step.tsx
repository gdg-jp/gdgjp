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
} from "@gdgjp/design-system";
import { cn } from "@gdgjp/design-system";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChapterKind, ChapterRegion } from "~/features/chapters/types";

import type { OnboardingChapter } from "../types";
import { softSpring, spring } from "./transitions";

export function DoneStep({ chapters }: { chapters: OnboardingChapter[] }) {
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
