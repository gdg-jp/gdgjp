import { motion, useDragControls, useMotionValue } from "motion/react";
import type { Desk } from "~/features/board/protocol";
import type { Transform } from "../geometry";

/**
 * One desk on the canvas: Motion handles translation drag, raw pointer math
 * (in the parent, via `onHandleStart`) handles resize/rotate. Extracted into
 * its own component because each desk needs its own `useDragControls`.
 */
export function DeskNode({
  desk,
  t,
  onBeginGesture,
  onEndGesture,
  onDragCommit,
  onHandleStart,
  onRemove,
}: {
  desk: Desk;
  t: Transform;
  onBeginGesture: (frozen: Transform) => void;
  onEndGesture: () => void;
  onDragCommit: (desk: Desk) => void;
  onHandleStart: (e: React.PointerEvent, desk: Desk, mode: "resize" | "rotate") => void;
  onRemove: (id: string) => void;
}) {
  const controls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  return (
    <motion.div
      drag
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      // Opacity-only entrance (a new desk fades in); scale-out on removal.
      // Deliberately no transform on enter and no `layout` — the resize/rotate
      // pointer math reads this node's box directly and must not see it scaled.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ opacity: { duration: 0.18 }, scale: { duration: 0.18 } }}
      onPointerDown={(e) => {
        onBeginGesture(t);
        controls.start(e);
      }}
      onDragEnd={(_e, info) => {
        // Reset the drag transform immediately so it doesn't fight the
        // committed left/top once `onDragCommit` lands in state.
        x.set(0);
        y.set(0);
        onEndGesture();
        onDragCommit({
          ...desk,
          x: desk.x + info.offset.x / t.scale,
          y: desk.y + info.offset.y / t.scale,
        });
      }}
      className="absolute cursor-grab touch-none rounded-2xl border-2 border-black bg-surface active:cursor-grabbing"
      style={{
        x,
        y,
        width: desk.width * t.scale,
        height: desk.height * t.scale,
        left: desk.x * t.scale + t.offsetX,
        top: desk.y * t.scale + t.offsetY,
        rotate: desk.rotation,
      }}
    >
      <div className="grid h-full place-items-center p-1 text-center text-xs font-bold text-neutral-600">
        {desk.label || "机"}
      </div>
      <button
        type="button"
        aria-label="机を削除"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(desk.id)}
        className="absolute -right-2 -top-2 grid size-6 touch-none place-items-center rounded-full border-2 border-black bg-white text-xs leading-none hover:bg-gdg-red hover:text-white"
      >
        ×
      </button>
      <button
        type="button"
        aria-label="回転"
        onPointerDown={(e) => onHandleStart(e, desk, "rotate")}
        className="absolute -top-6 left-1/2 size-4 -translate-x-1/2 touch-none cursor-alias rounded-full border-2 border-black bg-gdg-yellow"
      />
      <button
        type="button"
        aria-label="サイズ変更"
        onPointerDown={(e) => onHandleStart(e, desk, "resize")}
        className="absolute -bottom-2 -right-2 size-4 touch-none cursor-nwse-resize rounded-full border-2 border-black bg-gdg-green"
      />
    </motion.div>
  );
}
