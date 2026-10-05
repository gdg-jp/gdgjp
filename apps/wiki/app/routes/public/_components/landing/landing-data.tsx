import type React from "react";
import {
  IconBookOpen,
  IconBrain,
  IconCheck,
  IconGlobe,
  IconSparkles,
  IconUpload,
  IconUsers,
} from "./icons";

export const GDG = {
  blue: {
    bg: "var(--color-brand-google-blue-soft)",
    text: "var(--color-brand-google-blue)",
    accent: "var(--color-brand-google-blue)",
  },
  green: {
    bg: "var(--color-brand-google-green-soft)",
    text: "var(--color-brand-google-green)",
    accent: "var(--color-brand-google-green)",
  },
  yellow: {
    bg: "var(--color-brand-google-yellow-soft)",
    text: "var(--color-brand-google-yellow)",
    accent: "var(--color-brand-google-yellow)",
  },
  red: {
    bg: "var(--color-brand-google-red-soft)",
    text: "var(--color-brand-google-red)",
    accent: "var(--color-brand-google-red)",
  },
} as const;

// ---------------------------------------------------------------------------
// Feature card data
// ---------------------------------------------------------------------------

export type Feature = {
  key: string;
  titleKey: string;
  descKey: string;
  color: (typeof GDG)[keyof typeof GDG];
  icon: React.ReactNode;
};

export const FEATURES: Feature[] = [
  {
    key: "ingest",
    titleKey: "lp.feature_ingest_title",
    descKey: "lp.feature_ingest_desc",
    color: GDG.blue,
    icon: <IconBrain />,
  },
  {
    key: "bilingual",
    titleKey: "lp.feature_bilingual_title",
    descKey: "lp.feature_bilingual_desc",
    color: GDG.green,
    icon: <IconGlobe />,
  },
  {
    key: "kb",
    titleKey: "lp.feature_kb_title",
    descKey: "lp.feature_kb_desc",
    color: GDG.yellow,
    icon: <IconBookOpen />,
  },
  {
    key: "members",
    titleKey: "lp.feature_members_title",
    descKey: "lp.feature_members_desc",
    color: GDG.red,
    icon: <IconUsers />,
  },
];

// ---------------------------------------------------------------------------
// How It Works steps
// ---------------------------------------------------------------------------

export type Step = {
  num: number;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
  color: (typeof GDG)[keyof typeof GDG];
};

export const STEPS: Step[] = [
  {
    num: 1,
    titleKey: "lp.how_step1_title",
    descKey: "lp.how_step1_desc",
    icon: <IconUpload />,
    color: GDG.blue,
  },
  {
    num: 2,
    titleKey: "lp.how_step2_title",
    descKey: "lp.how_step2_desc",
    icon: <IconSparkles />,
    color: GDG.red,
  },
  {
    num: 3,
    titleKey: "lp.how_step3_title",
    descKey: "lp.how_step3_desc",
    icon: <IconCheck />,
    color: GDG.green,
  },
];
