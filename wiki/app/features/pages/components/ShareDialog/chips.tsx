import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { MotionPresence } from "~/components/ui/motion";
import { Avatar } from "./avatar";
import { subjectKey } from "./normalize";
import { CHIP_EXIT_DURATION_MS, type ShareSubject } from "./types";

function SelectedChip({
  subject,
  present,
  onRemove,
  onExited,
  removeLabel,
}: {
  subject: ShareSubject;
  present: boolean;
  onRemove: (subject: ShareSubject) => void;
  onExited: (subject: ShareSubject) => void;
  removeLabel: string;
}) {
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    if (present) return;
    const timer = window.setTimeout(() => onExitedRef.current(subject), CHIP_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [present, subject]);

  return (
    <MotionPresence
      as="span"
      present={present}
      distance={0}
      enterDuration={240}
      exitDuration={CHIP_EXIT_DURATION_MS}
      reducedDuration={180}
      reducedOpacity={0}
      scale={0.92}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary py-0.5 pl-0.5 pr-1.5 text-sm text-secondary-foreground"
    >
      <Avatar subject={subject} size="h-8 w-8" />
      <span className="max-w-48 truncate">{subject.label}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onRemove(subject)}
        className="rounded-full"
        aria-label={removeLabel}
      >
        <X size={16} />
      </Button>
    </MotionPresence>
  );
}

export function SelectedChips({
  selected,
  onRemove,
  removeLabel,
}: {
  selected: ShareSubject[];
  onRemove: (subject: ShareSubject) => void;
  removeLabel: (subject: ShareSubject) => string;
}) {
  const [rendered, setRendered] = useState(selected);
  const selectedKeys = new Set(selected.map(subjectKey));

  useEffect(() => {
    setRendered((current) => {
      const selectedByKey = new Map(selected.map((subject) => [subjectKey(subject), subject]));
      const currentKeys = new Set(current.map(subjectKey));
      return [
        ...current.map((subject) => selectedByKey.get(subjectKey(subject)) ?? subject),
        ...selected.filter((subject) => !currentKeys.has(subjectKey(subject))),
      ];
    });
  }, [selected]);

  return rendered.map((subject) => (
    <SelectedChip
      key={subjectKey(subject)}
      subject={subject}
      present={selectedKeys.has(subjectKey(subject))}
      onRemove={onRemove}
      onExited={(exited) => {
        setRendered((items) => items.filter((item) => subjectKey(item) !== subjectKey(exited)));
      }}
      removeLabel={removeLabel(subject)}
    />
  ));
}
