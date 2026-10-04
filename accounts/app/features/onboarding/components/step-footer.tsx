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

export function StepFooter({ children, className }: { children: ReactNode; className?: string }) {
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
