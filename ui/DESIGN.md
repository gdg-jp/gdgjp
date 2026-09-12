---
version: alpha
name: GDG Apps UI
description: A private React 19 design system for GDG Apps, built around calm clay surfaces, semantic tokens, accessible Radix interactions, and restrained motion.
colors:
  white: "#FFFFFF"
  white-2: "#F8F8F8"
  black: "#141414"
  black-2: "#1E1E1E"
  primary: "#4285F4"
  on-primary: "#FFFFFF"
  primary-hover: "#5692F5"
  secondary: "#5D899D"
  on-secondary: "#FFFFFF"
  secondary-hover: "#6B9AAE"
  gdg-red: "#EA4335"
  gdg-green: "#34A853"
  gdg-yellow: "#F9AB00"
  background: "#F8F8F8"
  background-dark: "#1E1E1E"
  surface: "#FFFFFF"
  surface-dark: "#141414"
  text: "#1E1E1E"
  text-dark: "#F8F8F8"
  muted: "#606060"
  muted-dark: "#B0B0B0"
  border: "rgb(30 30 30 / 10%)"
  border-dark: "rgb(240 240 240 / 12%)"
  input-border: "#858585"
  input-border-dark: "#777777"
  link: "#185ABC"
  link-dark: "#8AB4F8"
  focus: "#185ABC"
  focus-dark: "#8AB4F8"
  selected: "#E8F0FE"
  selected-dark: "#253655"
  neutral: "#E7E7E7"
  neutral-dark: "#303030"
  hover: "#EAEAEA"
  hover-dark: "#292929"
  danger: "#B3261E"
  danger-dark: "#FFB4AB"
  on-danger: "#FFFFFF"
  on-danger-dark: "#601410"
  danger-surface: "#FCE8E6"
  danger-surface-dark: "#3C2020"
  success: "#176B35"
  success-dark: "#81C995"
  success-surface: "#E6F4EA"
  success-surface-dark: "#183323"
  warning: "#765000"
  warning-dark: "#FDD663"
  warning-surface: "#FEF3D1"
  warning-surface-dark: "#382E17"
  overlay: "rgb(0 0 0 / 45%)"
typography:
  display:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 32px
    fontWeight: 650
    lineHeight: 1.3
  heading-md:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.3
  heading-sm:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 20px
    fontWeight: 650
    lineHeight: 1.3
  body-md:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.6
  caption:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: '"Google Sans", "Noto Sans JP", system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  inline-code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 0.9em
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: 0px
  sm: 14px
  control: 18px
  card: 28px
  dialog: 32px
  pill: 9999px
  circle: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  control: 40px
  touch: 44px
  sidebar-width: 240px
  page-max: 1280px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "24px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "8px 12px"
  popup:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "6px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "32px"
  badge:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
---

# GDG Apps UI Design System

## Overview

GDG Apps UI is the private React 19 design system for GDG Japan applications. It is independent
of application routing, authentication, data fetching, and product-specific business logic. The
system turns design decisions into a stable sequence: semantic tokens, accessible interaction
primitives, components, and then page composition.

Status: **Accepted**. The current visual decisions were accepted on September 11, 2026. The
initial rollout is limited to this private library and a fictional administration interface; it
does not migrate existing applications, publish an npm package, or define hosting and deployment.
The tinyurl application is a reference for information density and navigation only, not a source
of truth for its CSS or business logic.

The token source is `src/styles/tokens.css`. Do not create a second hand-edited token file for
DTCG, Figma, or Tailwind. A future integration may convert this source in one direction. The
distributed CSS uses the named layers `gdg-tokens`, `gdg-base`, `gdg-components`, and consumer
`utilities`, in that order, so consumer utilities can intentionally override component styling.
Radix provides the interaction foundation; preserve its focus, ARIA, keyboard, controlled,
uncontrolled, event, and ref contracts rather than implementing parallel primitives.

## Colors

The palette is calm and neutral at rest, with GDG Blue reserved for the most important action.
Secondary actions use a desaturated, green-leaning slate blue. Light and dark themes keep the
same brand colors while changing semantic surfaces, text, state tones, and shadow treatment.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| Background | `#F8F8F8` | `#1E1E1E` | Page canvas and recessed input surface |
| Surface | `#FFFFFF` | `#141414` | Cards, dialogs, popups, and raised content |
| Text | `#1E1E1E` | `#F8F8F8` | Primary content and headings |
| Muted | `#606060` | `#B0B0B0` | Supporting copy, metadata, and inactive labels |
| Primary | `#4285F4` | `#4285F4` | The single most important action or selected control |
| On-primary | `#FFFFFF` | `#FFFFFF` | Primary button and selected-control foreground |
| Primary hover | `#5692F5` | `#5692F5` | Raised primary action on precise hover |
| Secondary | `#5D899D` | `#5D899D` | Supporting action surfaces |
| On-secondary | `#FFFFFF` | `#FFFFFF` | Secondary action foreground |
| Secondary hover | `#6B9AAE` | `#6B9AAE` | Supporting action on precise hover |
| Link / focus | `#185ABC` | `#8AB4F8` | Links, selected text, and keyboard focus |
| Selected | `#E8F0FE` | `#253655` | Selected navigation, menu, and informational states |
| Neutral | `#E7E7E7` | `#303030` | Neutral badges, tab tracks, and neutral controls |
| Hover | `#EAEAEA` | `#292929` | Non-primary hover surfaces |
| Border | `rgb(30 30 30 / 10%)` | `rgb(240 240 240 / 12%)` | Structural separators only |
| Input border | `#858585` | `#777777` | Input-related semantic color when a border is required |
| Danger | `#B3261E` | `#FFB4AB` | Errors and destructive states |
| Danger surface | `#FCE8E6` | `#3C2020` | Error background |
| Success | `#176B35` | `#81C995` | Successful or completed states |
| Success surface | `#E6F4EA` | `#183323` | Success background |
| Warning | `#765000` | `#FDD663` | Warnings and attention states |
| Warning surface | `#FEF3D1` | `#382E17` | Warning background |
| Overlay | `rgb(0 0 0 / 45%)` | `rgb(0 0 0 / 45%)` | Modal scrim |
| GDG red / green / yellow | `#EA4335` / `#34A853` / `#F9AB00` | Same | Brand accents, not small status text |

Primary white-on-blue is approximately 3.56:1, a known limitation of the brand color for normal
text. Secondary white-on-slate is approximately 3.8:1, and its hover tone is approximately 3.1:1.
Use primary and secondary as action surfaces, not as normal-size body text or small status labels.
Keep normal text at 4.5:1 and essential control or focus indicators at 3:1 or better. Use the
semantic `danger`, `success`, and `warning` tokens instead of placing raw red, green, or yellow
on small text. When a consumer overrides a hover token, it must preserve the same minimum contrast.

## Typography

The type system uses bundled Google Sans for the Latin voice and Noto Sans JP for Japanese content,
with `system-ui` as a final fallback. `fonts.css` is an optional, independently imported package
entry. The default page size is 16px with a 1.6 line height; controls use 14px and headings use
20–32px with a strong 650 weight. Text wraps anywhere when necessary so long Japanese labels and
user content do not force a layout overflow.

| Level | Size | Weight | Line height | Use |
| --- | ---: | ---: | ---: | --- |
| Display / H1 | 32px | 650 | 1.3 | Page-level title |
| H2 | 24px | 650 | 1.3 | Major section heading |
| H3–H6 | 20px | 650 | 1.3 | Local heading hierarchy |
| Body | 16px | 400 | 1.6 | Default reading text |
| Label / control | 14px | 600 | 1.4–1.6 | Form labels and actions |
| Small | 14px | 400 | 1.6 | Help, descriptions, and metadata |
| Caption | 12px | 400 | 1.6 | Compact supporting information |

Use semantic heading levels and meaningful labels; do not communicate hierarchy with font size
alone. Inline code switches to a monospace stack, uses a compact 0.9em size, and receives the
same small squircle treatment as other compact surfaces.

## Layout

Layout follows a fluid, mobile-first model with a 1280px maximum page width. The spacing rhythm is
based on a 4px unit, with 8px, 12px, 16px, 24px, 32px, and 48px as the common steps. Use the
smallest step that preserves grouping and legibility; create hierarchy with alignment, whitespace,
and type rather than with extra decoration.

- `Stack` is the default vertical composition primitive and uses a 16px gap.
- `Inline` wraps related controls and uses a 12px gap.
- Cards use 24px internal padding on desktop and 16px on narrow screens.
- The main content area uses 32px page padding on desktop and 24px vertical / 16px horizontal
  padding below the 768px breakpoint.
- The standard sidebar is 240px wide. The compact icon state is 64px wide; an off-canvas state
  removes it from the layout.
- The application shell header is at least 64px tall. The sidebar is hidden in the simple shell
  below 768px; the composable sidebar can become a fixed mobile panel.
- Coarse-pointer controls use at least 44px hit areas. Do not shrink a visual icon below the
  touch target just to make the layout denser.

Keep related information in one visual group. Avoid nested cards; use `Stack`, `Inline`, and
`Separator` to organize content inside a surface. Tables scroll within their own region when the
viewport is narrow, and overflow must not expand the page horizontally.

## Elevation & Depth

The visual language is soft claymorphism: a filled surface is distinguished by a restrained outer
lift and a subtle inner highlight, not by a black or white outline. The depth should feel calm and
tactile, with low-contrast, diffused shadows. Do not introduce gradients, glass effects, or heavy
blur as decoration.

The authoritative shadow tokens are defined in `src/styles/tokens.css`:

| Token | Use |
| --- | --- |
| `--gdg-shadow-sm` | Buttons, badges, avatars, compact controls, selected tabs, and small raised surfaces |
| `--gdg-shadow-md` | Cards, popups, toast surfaces, charts, floating sidebars, and other content surfaces |
| `--gdg-shadow-lg` | Dialogs and the highest-priority modal surface |
| `--gdg-shadow-hover` | A small lift for precise-pointer hover states |
| `--gdg-shadow-pressed` | Inset, pressed button state |
| `--gdg-shadow-inset` | Inputs, tracks, tab rails, accordion content, and skeleton placeholders |
| `--gdg-shadow-right` / `left` / `bottom` | Adjacent-surface separation for sidebars, sheets, and headers |

Buttons, cards, badges, avatars, inputs, checkbox/radio/switch controls, popups, dialogs, alerts,
and toasts normally use `border: 0` plus a shadow. Ghost buttons are shadowless at rest, while
ghost bubbles remain shadowless. Structural separators such as table rows, accordion inner sections, `Separator`, and
the questionnaire choice outline retain the thin semantic border. In forced-colors mode, replace
shadow-only boundaries with `1px solid ButtonText`; selected states use a `Highlight` outline.

The default focus treatment is a 2px `--gdg-focus` outline with a 3px offset. Invalid fields and
invalid controls add a danger-colored outer ring while preserving their inset or raised shadow.
Layers are ordered intentionally: sticky content 10, overlay 40, popup 50, toast 60, and skip
link 100.

## Shapes

Finite radii use the shared `corner-shape: squircle` token, with ordinary `border-radius` as the
fallback for browsers that do not support `corner-shape`. This gives containers and controls a
soft, intentional geometry without making the UI bubbly. Circular and pill primitives explicitly
keep round corners, and zero-radius primitives remain square.

| Shape | Value | Use |
| --- | ---: | --- |
| Compact squircle | 14px | Small controls, menu items, media, and compact feedback |
| Control squircle | 18px | Buttons, inputs, popups, navigation items, and ordinary cards |
| Card squircle | 28px | Large cards, sidebars, sheets, and drawers |
| Dialog squircle | 32px | Dialog content |
| Pill | `9999px` | Badges, switches, tab rails, and tab triggers |
| Circle | `50%` | Avatars, radio indicators, slider thumbs, and circular media |
| Square | `0` | Grouped button children and intentionally edge-to-edge primitives |

Use one coherent shape language within a view. Preserve the specialized pill and circle geometry
when composing a component; do not apply the global squircle rule to a control that is explicitly
round.

## Components

### Actions

Use one `Button` with the primary variant for the most important action in a screen. Use secondary
for supporting actions, outline for a neutral action on a surface, ghost for low-emphasis actions,
and danger only for destructive confirmation. Medium buttons are 40px high; `sm` is 32px and `lg`
uses the 44px touch size. Buttons are raised with the small shadow, move up only for a precise
pointer hover, and use the pressed inset shadow with a 120ms press response. Ghost buttons are
shadowless at rest; a precise-pointer hover may use the small hover lift while remaining lower
emphasis than a filled action. `IconButton` requires an accessible label, and a normal `Button`
defaults to `type="button"`.

### Forms and selection

`FormField` owns the relationship between one input and its label, description, and error message.
It generates stable IDs and propagates required, disabled, and invalid state. The consumer owns
the `name`, validation, and submission logic. Do not put multiple independent inputs in one
`FormField`.

Use `Input` and `Textarea` with the inset shadow. Read-only controls remain selectable and
copyable; disabled controls are not interactive. `InputGroup` creates one shared inset surface,
and `InputOTP` keeps its active slot distinct with the focus token. `Calendar` and `DatePicker`
use the same surface and control geometry; the date text input accepts sequential digits, inserts
year/month separators, and formats the value as `YYYY/MM/DD` without requiring `/` keystrokes.

Choose selection controls by meaning: `RadioGroup` for one choice from a small set, `Select` for
one choice from a larger set, `Switch` for an immediate binary setting, and `Checkbox` for consent
or form selection. Give the group an accessible name and each item a visible or programmatic label.
Use `Combobox` and `Command` for searchable choice or command entry, but keep their initial use
lightweight and Radix-based.

### Surfaces and data

`Card` is a single raised clay surface with generous padding. Keep cards from becoming nested
containers; combine content with `Stack` and `Separator`. `Badge` is pill-shaped and uses neutral,
info, success, warning, or danger tones. `Avatar`, `Attachment`, `Bubble`, `Message`, `Item`, and
`Chart` use compact surfaces and must preserve their content hierarchy at narrow widths.

Use `Table` for structured comparison, with the consumer providing a caption, table sections, and
`scope` on header cells. It has a 640px minimum content width and scrolls inside `Table`'s own
region when needed. `DataTable` is a lightweight, content-driven table; it is not a virtualized
data grid. `Pagination`, `Progress`, `Empty`, `EmptyState`, `Skeleton`, and `Spinner` communicate
state without replacing the underlying semantic content.

### Overlays and navigation

Use `Tooltip` only for short supplemental context; required information must remain visible.
`Popover` is for a small action surface anchored to a trigger. `Dialog` temporarily concentrates
work and must include a title and description. `Sheet` is for supporting navigation or context from
an edge, while `AlertDialog` is for a confirmation that needs an explicit cancel and action.
`DropdownMenu`, `ContextMenu`, `HoverCard`, `Menubar`, and `NavigationMenu` retain Radix keyboard
navigation and placement semantics. Portal content inherits the document theme; per-subtree themes
are not provided.

`AppShell` and `Sidebar` establish the navigation frame. The default composable sidebar can
collapse to an icon rail; use `offcanvas` when it should leave the layout entirely. `PageHeader`,
`Breadcrumb`, `SidebarNav`, `Toolbar`, `Tabs`, `Accordion`, `Resizable`, `ScrollArea`, and
`Direction` provide composition and orientation, not product-specific routing or URL logic.

### Feedback and state

`Alert` is persistent inline feedback with a semantic tone. `Toast` is reserved for a short-lived
result of an action; errors that require resolution must also appear on the relevant field or in an
alert. `Skeleton` is a restrained visual placeholder and is not, by itself, a loading announcement;
use a labelled `Spinner`, a parent `aria-busy`, or an accompanying message. `Icons` wraps
`lucide-animated` so consumers import only from `@gdgjp/ui`. Its default
`animateOnHover` behavior runs the selected icon's animation on hover; `animateOnHover={false}`
disables it, and `prefers-reduced-motion` disables this decorative hover animation. `Toaster` keeps
Sonner's positioning, stacking, dismissal, and action behavior while applying the library's theme tokens.

### Accessibility and motion contract

Preserve native element props and refs. Radix controlled and uncontrolled behavior, events, focus
restoration, Escape handling, Tab handling, and ARIA semantics are public contracts. Dialogs and
sheets need a title and description; controlled displays without a trigger must explicitly restore
focus with `onCloseAutoFocus`. Breadcrumbs and selected navigation links expose
`aria-current="page"`. Toolbar is a layout primitive and does not claim an ARIA toolbar role or
invent arrow-key navigation.

Motion exists for feedback, state comprehension, and preserving spatial relationships:

| Interaction | Duration | Treatment |
| --- | ---: | --- |
| Pointer press and selection indicators | 120ms | Transform, opacity, or background transition |
| Tooltip | 125ms | Opacity and transform from the trigger |
| Popover, menu, and select | 180ms | Opacity and transform from the trigger |
| Dialog and overlay | 250ms | Opacity; dialog may start at `scale(.97)` |
| Sheet | 280ms | Edge-specific `translateX` with the drawer easing |
| Accordion and collapsible | 200ms | Measured height and opacity |
| Skeleton shimmer | 2400ms | Constant transform/opacity shimmer |
| Icon hover animation | Icon-specific | Feedback on precise-pointer hover; disabled for reduced motion |

The standard easing is `cubic-bezier(0.23, 1, 0.32, 1)`; sheets use
`cubic-bezier(0.32, 0.72, 0, 1)`. Use CSS transitions and Radix Presence's exit lifetime so
visual transitions remain interruptible while the DOM stays mounted long enough to complete. Use
Radix placement variables for transform origins. Keyboard-triggered actions skip transitions, and
theme changes, tab changes, and list refreshes do not receive decorative movement.

For `prefers-reduced-motion`, remove translation and scale while retaining a short opacity change
where it still communicates state. Stop spinner rotation and skeleton shimmer without removing the
loading announcement. Never use `transition: all`, `scale(0)`, or `ease-in` for UI motion.

## Do's and Don'ts

- Do use semantic tokens and keep CSS as the only hand-edited token source. Don't add literal theme
  colors to component styles.
- Do reserve primary for one dominant action per screen. Don't distribute GDG Blue across every
  link, status label, and secondary action.
- Do keep the clay surface language soft and consistent. Don't reintroduce decorative outlines,
  gradients, glass effects, or excessive blur.
- Do preserve light, dark, forced-colors, reduced-motion, keyboard, and narrow-layout behavior.
  Don't treat an axe result or a green unit-test run as a substitute for real interaction review.
- Do use native semantics and Radix primitives. Don't reimplement focus management, ARIA behavior,
  keyboard navigation, or portal lifecycle.
- Do keep required information visible and put resolvable errors next to the affected field. Don't
  hide required content in a tooltip or use a toast as the only error channel.
- Do test long Japanese content, narrow screens, coarse pointers, and both theme modes. Don't let
  text, tables, popups, or attachments force horizontal page overflow.
- Do use official logos and event-specific decoration only as supplied, unmodified assets. Don't
  mix event branding into the neutral base system by default.

Every visual or public-contract change must state its purpose and non-purpose, cover light and dark
states, document keyboard and focus behavior, and consider labels, reduced motion, forced colors,
long Japanese content, and narrow layouts. Keep implementation, stories, tests, consumer examples,
`README.md`, and this document synchronized. Review appearance changes against the baseline images,
and record intentional snapshot changes with the change.
