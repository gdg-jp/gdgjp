import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { AnimatedCount } from "~/components/motion";
import { listItem, transitions } from "~/components/motion-presets";

export function VoteDialog({
  slug,
  open,
  onOpenChange,
  topics,
  voteCounts,
  initialMyVotes,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  topics: { id: string; text: string }[];
  voteCounts: Record<string, number>;
  initialMyVotes: string[];
}) {
  const fetcher = useFetcher();
  const [myVotes, setMyVotes] = useState<Set<string>>(() => new Set(initialMyVotes));

  useEffect(() => {
    if (open) setMyVotes(new Set(initialMyVotes));
  }, [open, initialMyVotes]);

  const sorted = useMemo(
    () => [...topics].sort((a, b) => (voteCounts[b.id] ?? 0) - (voteCounts[a.id] ?? 0)),
    [topics, voteCounts],
  );

  function toggle(topicId: string) {
    setMyVotes((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
    fetcher.submit({ intent: "vote", topicId }, { method: "post", action: `/${slug}` });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 bg-black/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fade}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 flex max-h-[85dvh] w-[92vw] max-w-lg flex-col rounded-[1.5rem] border-2 border-black bg-white p-6 shadow-xl"
                initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
                transition={transitions.spring}
              >
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-xl font-bold">テーマに投票</Dialog.Title>
                  <Dialog.Close
                    aria-label="閉じる"
                    className="grid size-9 place-items-center rounded-full border-2 border-black text-xl leading-none hover:bg-neutral-100"
                  >
                    ×
                  </Dialog.Close>
                </div>
                <Dialog.Description className="mt-1 text-sm text-neutral-600">
                  気になるテーマに 👍 を付けましょう（テーマごとに1回、取り消しも可）。
                </Dialog.Description>

                <ul className="mt-4 space-y-2 overflow-y-auto">
                  {sorted.length === 0 ? (
                    <li className="py-6 text-center text-neutral-500">まだテーマがありません。</li>
                  ) : (
                    <AnimatePresence initial={false}>
                      {sorted.map((t) => {
                        const voted = myVotes.has(t.id);
                        return (
                          <motion.li
                            key={t.id}
                            layout="position"
                            variants={listItem}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            transition={transitions.springSoft}
                            className="flex items-center gap-3 rounded-xl border-2 border-black p-3"
                          >
                            <span className="flex-1 break-words">{t.text}</span>
                            <span className="tabular-nums text-sm text-neutral-500">
                              <AnimatedCount value={voteCounts[t.id] ?? 0} />
                            </span>
                            <motion.button
                              type="button"
                              onClick={() => toggle(t.id)}
                              aria-pressed={voted}
                              whileTap={{ scale: 0.85 }}
                              transition={transitions.spring}
                              className={`rounded-full border-2 border-black px-4 py-1.5 font-bold transition ${
                                voted ? "bg-gdg-green text-white" : "bg-white hover:bg-neutral-100"
                              }`}
                            >
                              👍
                            </motion.button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </ul>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
