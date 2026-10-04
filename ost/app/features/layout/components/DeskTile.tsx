import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo } from "react";
import { staggerDelay, transitions } from "~/components/motion-presets";

export const DeskTile = memo(function DeskTile({
  index,
  label,
  x,
  y,
  width,
  height,
  rotation,
  scale,
  offsetX,
  offsetY,
  assignedKey,
  assignedText,
}: {
  index: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  assignedKey: string;
  assignedText: string;
}) {
  const reduceMotion = useReducedMotion();
  const lines = assignedText ? assignedText.split("\n") : [];

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }}
      transition={transitions.springSoft}
      className="absolute"
      style={{
        width: width * scale,
        height: height * scale,
        left: x * scale + offsetX,
        top: y * scale + offsetY,
      }}
    >
      <motion.div
        animate={{ rotate: rotation }}
        transition={transitions.springSoft}
        className="grid h-full w-full place-items-center rounded-2xl border-2 border-black bg-surface p-2 text-center"
      >
        <div>
          <div className="text-xs font-bold text-neutral-500">{label || "机"}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={assignedKey || "none"}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ ...transitions.fade, delay: reduceMotion ? 0 : staggerDelay(index) }}
            >
              {lines.length === 0 ? (
                <div className="text-sm text-neutral-400">未割り当て</div>
              ) : (
                lines.map((text, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: assigned lines are positional, no stable id here
                    key={i}
                    className="text-sm font-bold leading-tight break-words"
                  >
                    {text}
                  </div>
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
});
