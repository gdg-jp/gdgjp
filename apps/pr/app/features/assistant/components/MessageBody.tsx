import { Fragment } from "react";

/** Plain text with line breaks kept and URLs as links. Nothing is rendered as HTML. */
export function MessageBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"'「」（）()、。]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: the split is stable for a given text
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="text-link underline"
          >
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the split is stable for a given text
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}
