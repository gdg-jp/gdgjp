import { motion } from "motion/react";
import { memo } from "react";
import { AnimatedCount } from "~/components/motion";
import { tap, transitions } from "~/components/motion-presets";
import type { Topic } from "../protocol";

export const TopicCard = memo(function TopicCard({
  topic,
  votes,
  accent,
  interactive,
  onDelete,
}: {
  topic: Topic;
  votes: number;
  accent: string;
  interactive: boolean;
  onDelete: () => void;
}) {
  return (
    <motion.div
      whileHover={interactive ? { y: -3 } : undefined}
      transition={transitions.spring}
      className="relative rounded-[2rem] border-2 border-black bg-white p-8 lg:p-10"
      style={{ borderTop: `14px solid ${accent}` }}
    >
      <motion.button
        {...tap}
        type="button"
        aria-label="このテーマを削除"
        onClick={onDelete}
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border-2 border-black bg-white text-2xl leading-none transition hover:bg-gdg-red hover:text-white"
      >
        ×
      </motion.button>
      <p className="pr-12 text-4xl font-bold leading-snug break-words lg:text-5xl">{topic.text}</p>
      <p className="mt-4 text-lg text-neutral-500">
        <AnimatedCount value={votes} /> 票
      </p>
    </motion.div>
  );
});

export const StackCard = memo(function StackCard({
  count,
  top,
  votes,
  accent,
  interactive,
  onOpen,
}: {
  count: number;
  top: Topic;
  votes: number;
  accent: string;
  interactive: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={interactive ? { y: -3 } : undefined}
      whileTap={{ scale: 0.98 }}
      transition={transitions.spring}
      className="block w-full text-left"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 translate-x-2 translate-y-2 rounded-[2rem] border-2 border-black bg-white"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 translate-x-1 translate-y-1 rounded-[2rem] border-2 border-black bg-white"
      />
      <div
        className="relative rounded-[2rem] border-2 border-black bg-white p-8 lg:p-10"
        style={{ borderTop: `14px solid ${accent}` }}
      >
        <span className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border-2 border-black bg-gdg-yellow text-lg font-bold">
          {count}
        </span>
        <p className="pr-12 text-4xl font-bold leading-snug break-words lg:text-5xl">{top.text}</p>
        <p className="mt-4 text-lg text-neutral-500">
          まとめて <AnimatedCount value={votes} /> 票 ・ タップで展開
        </p>
      </div>
    </motion.button>
  );
});
