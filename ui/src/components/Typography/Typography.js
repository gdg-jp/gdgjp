import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
const defaultElements = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  lead: "p",
  large: "div",
  small: "small",
  muted: "p",
  p: "p",
  blockquote: "blockquote",
  "inline-code": "code",
  list: "ul",
};
export function Typography({ variant = "p", as, className, ...props }) {
  const Tag = as ?? defaultElements[variant];
  return _jsx(Tag, {
    ...props,
    className: cn("gdg-typography", `gdg-typography-${variant}`, className),
  });
}
function createTypographyPart(variant) {
  return function TypographyPart({ className, ...props }) {
    return _jsx(Typography, { ...props, variant: variant, className: className });
  };
}
export const TypographyH1 = createTypographyPart("h1");
export const TypographyH2 = createTypographyPart("h2");
export const TypographyH3 = createTypographyPart("h3");
export const TypographyLead = createTypographyPart("lead");
export const TypographyLarge = createTypographyPart("large");
export const TypographySmall = createTypographyPart("small");
export const TypographyMuted = createTypographyPart("muted");
export const TypographyP = createTypographyPart("p");
export const TypographyBlockquote = createTypographyPart("blockquote");
export const TypographyInlineCode = createTypographyPart("inline-code");
export const TypographyList = createTypographyPart("list");
