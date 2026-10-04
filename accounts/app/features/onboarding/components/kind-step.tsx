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

export function KindStep({ onSelect }: { onSelect: (kind: ChapterKind) => void }) {
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
