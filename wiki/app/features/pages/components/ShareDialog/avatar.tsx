import { initial } from "./normalize";
import { GENERAL_ACCESS, type GeneralAccess, type ShareSubject } from "./types";

import { Icons } from "@gdgjp/ui";
export function Avatar({
  subject,
  size = "h-10 w-10",
}: {
  subject: ShareSubject;
  size?: string;
}) {
  if (subject.image) {
    return (
      <img
        src={subject.image}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-border-border/10 dark:ring-border-border/10`}
      />
    );
  }
  const iconName = subject.type === "chapter" ? "UsersRound" : "UserRound";
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-selected text-link`}
    >
      {subject.type === "chapter" ? <Icons name={iconName} size={18} /> : initial(subject.label)}
    </span>
  );
}

export function AccessIcon({ value }: { value: GeneralAccess }) {
  const Icon = GENERAL_ACCESS.find((option) => option.value === value)?.icon;
  return Icon ? <Icon size={20} aria-hidden="true" /> : <Icons name="LockKeyhole" size={20} />;
}
