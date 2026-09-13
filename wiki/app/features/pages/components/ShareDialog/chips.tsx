import { IconButton } from "@gdgjp/ui";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { subjectKey } from "./normalize";
import { CHIP_EXIT_DURATION_MS, type ShareSubject } from "./types";

import { Icons } from "@gdgjp/ui";
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
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary py-0.5 pl-0.5 pr-1.5 text-sm text-secondary-foreground">
      <Avatar subject={subject} size="h-8 w-8" />
      <span className="max-w-48 truncate">{subject.label}</span>
      <IconButton
        variant="ghost"
        onClick={() => onRemove(subject)}
        className="rounded-full"
        aria-label={removeLabel}
      >
        <Icons name="X" size={16} />
      </IconButton>
    </span>
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
