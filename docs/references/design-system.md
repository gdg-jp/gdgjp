I researched current primary sources from W3C/WAI, the Design Tokens Community Group, MDN, Storybook, Figma, Atlassian, Radix, React Aria, and SemVer. The strongest pattern is to treat a design system as **frontend infrastructure**, not merely a collection of reusable React components.

## Recommended architecture

A maintainable web design system should look roughly like this:

```text
Design language
      ↓
Design tokens
      ↓
Accessible behavioral primitives
      ↓
UI components
      ↓
Patterns / compositions
      ↓
Product screens
```

Alongside that stack are documentation, automated tests, releases, contribution rules, and governance.

The most important architectural rule is that **higher layers consume lower layers but should not bypass them**. For example, a `Button` consumes semantic tokens rather than `#1868db`; a `ConfirmDialog` composes `Dialog` and `Button` rather than rebuilding focus handling.

---

## 1. Start with an interface audit, not implementation

Before building anything, inventory the existing frontend.

Look through real product screens and identify repeated decisions: colors, typography, spacing, radii, shadows, iconography, breakpoints, buttons, inputs, cards, dialogs, menus, tables, navigation, empty states, loading patterns, validation, alerts, and so on.

Then classify them into four levels:

| Level            | Examples                                              |
| ---------------- | ----------------------------------------------------- |
| Foundations      | color, typography, spacing, radius, elevation, motion |
| Components       | Button, Input, Checkbox, Dialog                       |
| Compositions     | FormField, SearchBox, DateRangePicker                 |
| Product patterns | checkout flow, filters, settings page, bulk actions   |

Do **not** initially attempt to systematize every UI in the application. Find the small number of decisions and components responsible for most repetition.

This also prevents a common failure mode: designing a theoretical library that does not reflect actual product requirements.

---

## 2. Make tokens the foundation

This area has matured substantially. As of September 2026, the Design Tokens Community Group has a **stable 2025.10 specification**, its first stable version. It defines a portable JSON representation for design tokens, including token types, aliases/references, groups, and composite values. ([デザイントークン][1])

I would use three token layers:

```text
Primitive / reference tokens
        ↓
Semantic tokens
        ↓
Component tokens (only where useful)
```

For example:

```text
color.blue.600
        ↓
color.action.primary
        ↓
button.primary.background
```

The crucial layer is the middle one.

Bad:

```css
.button {
  background: var(--blue-600);
}
```

Better:

```css
.button {
  background: var(--color-action-primary);
}
```

Now dark mode, high-contrast themes, rebranding, or other themes can change the meaning of `action-primary` without changing `Button`.

Atlassian uses this same semantic principle: token names communicate **how the value should be used**, allowing themes and system-wide changes without replacing hard-coded values throughout applications. ([Atlassian Design][2])

### Token categories

I would establish tokens for color, typography, spacing, sizing, radius, border, elevation/shadow, opacity, z-index/layering, motion duration/easing and, if relevant, density.

Figma Variables can represent reusable values and modes such as light/dark themes, so they map reasonably well to this model. ([Figmaヘルプセンター][3])

But avoid creating two independent sources of truth—one in Figma and one in code. Pick an authoritative token model and establish an explicit synchronization process.

---

## 3. Use the DTCG format as the exchange layer

A simplified token file might look conceptually like this:

```json
{
  "color": {
    "blue": {
      "600": {
        "$type": "color",
        "$value": {
          "colorSpace": "srgb",
          "components": [0.1, 0.35, 0.85]
        }
      }
    },
    "action": {
      "primary": {
        "$type": "color",
        "$value": "{color.blue.600}"
      }
    }
  }
}
```

The DTCG specification explicitly supports curly-brace token aliases such as `{colors.blue}`; these resolve to the target token value. ([デザイントークン][4])

The JSON representation should generally be a **source format**, not what your application consumes directly.

Compile it to web artifacts such as:

```css
:root {
  --ds-color-action-primary: #1765d8;
  --ds-space-100: 0.25rem;
  --ds-space-200: 0.5rem;
  --ds-radius-medium: 0.5rem;
}
```

CSS custom properties are particularly appropriate because they participate in inheritance and the CSS cascade and can therefore support runtime theming. ([MDN Web Docs][5])

---

## 4. Design themes as token mappings

Avoid writing separate dark-mode versions of every component.

Instead:

```css
:root,
[data-theme="light"] {
  --ds-color-surface: white;
  --ds-color-text: #171717;
  --ds-color-action-primary: #1f63d3;
}

[data-theme="dark"] {
  --ds-color-surface: #171717;
  --ds-color-text: #f5f5f5;
  --ds-color-action-primary: #76a9ff;
}

.button {
  color: var(--ds-color-text-on-action);
  background: var(--ds-color-action-primary);
}
```

Modern CSS also provides `color-scheme`, `prefers-color-scheme`, and `light-dark()`. `light-dark()` has been broadly available in modern browsers since 2024, but semantic tokens are still the more scalable abstraction when you have multiple themes or brands. ([MDN Web Docs][6])

Also design explicitly for reduced motion, increased contrast, and forced-colors/high-contrast environments rather than assuming light/dark is the entire theming problem. ([MDN Web Docs][7])

---

## 5. Separate behavior from appearance

For simple components such as `Button`, native HTML gets you most of the behavior.

Complex UI is different:

```text
Dialog
Select
Combobox
Menu
Tabs
Tooltip
Popover
Listbox
DatePicker
Tree
DataGrid
```

These require focus management, keyboard interaction, ARIA state, screen-reader semantics, pointer/touch handling, and often internationalization.

WAI's ARIA Authoring Practices Guide documents the expected interaction models. For example, composite widgets have specific conventions for `Tab`, arrow-key navigation, and focus management. ([W3C][8])

My recommendation is therefore:

**Use native HTML first. For complex widgets, build on mature accessible primitives rather than implementing ARIA behavior from scratch unless you have a compelling requirement.**

For React specifically, Radix Primitives and React Aria are examples of this architecture. Both provide unstyled accessible behavior intended to serve as a foundation for custom design systems. ([Radix UI][9])

This produces a cleaner separation:

```text
React Aria / Radix / internal primitive
                ↓
        your behavior contract
                ↓
         your design tokens
                ↓
          your Button/Dialog/etc.
```

You retain your own visual system without owning every difficult browser/accessibility edge case.

---

## 6. Treat component APIs as public APIs

A design-system component is infrastructure consumed by other developers.

So this:

```tsx
<Button size="medium" variant="primary" disabled>
  Save
</Button>
```

is an API contract in exactly the same sense as a JavaScript library API.

Prefer **small semantic APIs** over styling APIs.

For example:

```tsx
<Button variant="primary" />
<Button variant="secondary" />
<Button variant="danger" />
```

is generally healthier than:

```tsx
<Button background="blue600" radius="8" paddingX="12" fontWeight="600" />
```

The second approach turns every consumer into a design-system author and rapidly destroys consistency.

Also avoid combinatorial APIs:

```tsx
<Button
  color="..."
  hierarchy="..."
  emphasis="..."
  appearance="..."
  tone="..."
  intent="..."
/>
```

Every additional dimension multiplies the number of states you need to document, design, test, and support.

A useful rule is:

> **Props should express product/UI semantics, not expose arbitrary CSS.**

Escape hatches are sometimes necessary, but they should remain escape hatches.

---

## 7. Define state matrices before declaring a component complete

A `Button` is not just its default screenshot.

Its contract includes:

```text
default
hover
active
focus-visible
disabled
loading

× primary / secondary / danger
× small / medium / large
× light / dark
× normal / forced colors
× LTR / RTL where applicable
```

The same principle becomes even more important for forms.

An `Input` may require:

```text
empty
populated
placeholder
focus
disabled
readonly
invalid
required
with label
with help text
with validation message
```

Document those states deliberately rather than discovering them gradually in product code.

---

## 8. Accessibility belongs inside the system

Target **WCAG 2.2** as the baseline. It remains the current W3C Recommendation and defines testable accessibility criteria that are technology-independent. ([W3C][10])

For each interactive component, define its accessibility contract together with its visual contract:

```text
HTML semantics
Accessible name
Keyboard interaction
Focus behavior
Screen-reader state
Focus-visible appearance
Contrast
Zoom/reflow
Touch target behavior
Reduced motion
Forced colors
RTL
```

This creates enormous leverage.

If ten teams implement ten dialogs independently, you have ten accessibility implementations to audit.

If all ten consume one correct dialog primitive, you concentrate that work in one place.

Automated accessibility tests help, but they do not prove accessibility. Storybook's accessibility tooling uses axe-core and explicitly describes automated checks as a first line of QA rather than complete validation. ([Storybook][11])

Manual keyboard and assistive-technology testing remains necessary.

---

## 9. Make Storybook the executable documentation layer

For most component-based web stacks, I would use Storybook—or an equivalent component workbench—as part of the system rather than creating a custom documentation application first.

A story should represent a meaningful component state:

```text
Button
 ├── Primary
 ├── Secondary
 ├── Danger
 ├── Disabled
 ├── Loading
 ├── LongLabel
 └── IconOnly
```

Current Storybook treats stories as rendered component states and can derive component documentation from them. Autodocs generates interface documentation while MDX can add usage guidance and design rationale. ([Storybook][12])

A useful component documentation page should explain:

```text
What it is
When to use it
When not to use it
Anatomy
Variants
States
Content guidelines
Accessibility behavior
Props/API
Examples
Do / don't guidance
Related components
Migration/deprecation information
```

Documentation about **when not to use something** is particularly valuable. Otherwise the design system becomes a catalog rather than a decision system.

---

## 10. Turn stories into the testing matrix

This is another reason to make stories comprehensive.

Modern Storybook supports browser-based component/interaction tests, accessibility tests, and visual regression testing. ([Storybook][13])

A sensible CI pipeline is therefore:

```text
lint
  ↓
typecheck
  ↓
unit tests
  ↓
build token artifacts
  ↓
build component library
  ↓
render Storybook stories
  ↓
interaction tests
  ↓
accessibility checks
  ↓
visual regression
  ↓
package
```

Do not attempt to interaction-test every possible visual combination. Use visual regression for broad rendering coverage and interaction tests for behavior-heavy states.

---

## 11. Use the CSS cascade intentionally

I would also define an explicit CSS layering strategy.

For example:

```css
@layer reset, ds-base, ds-components, utilities;
```

Then make the precedence policy part of the public design-system contract.

Cascade layers provide explicit control over style precedence instead of relying on increasingly specific selectors. ([MDN Web Docs][14])

One useful library strategy is to keep design-system CSS in a named layer so an application's intentional unlayered overrides can win without specificity hacks.

Avoid systems that require:

```css
.app .page .widget .button.button-primary {
  ...
}
```

or widespread `!important`.

That indicates the styling architecture is fighting CSS instead of using it.

---

## 12. Package it as several concerns, not one giant dependency

For a substantial system, a structure like this works well:

```text
design-system/
│
├── packages/
│   ├── tokens/
│   │   ├── src/
│   │   └── dist/
│   │
│   ├── css/
│   │   ├── reset.css
│   │   ├── foundations.css
│   │   └── themes.css
│   │
│   ├── icons/
│   │
│   ├── primitives/
│   │
│   ├── react/
│   │   ├── Button/
│   │   ├── Dialog/
│   │   ├── Input/
│   │   └── ...
│   │
│   └── eslint-plugin/
│
├── apps/
│   └── storybook/
│
└── tooling/
    ├── tokens/
    └── release/
```

Not every organization needs all of these packages.

For a smaller frontend, start with:

```text
tokens
components
storybook
```

and split packages only once independent distribution or ownership makes the separation useful.

A premature monorepo full of twenty packages is not a design system achievement.

---

## 13. Version it like infrastructure

Once multiple applications consume the design system, backwards compatibility matters.

Define what constitutes your public API:

```text
component names
props/events
DOM expectations where relevant
token names
CSS custom properties
theme contracts
icon names
package exports
```

Then use semantic versioning.

SemVer defines patch releases for backward-compatible bug fixes, minor releases for backward-compatible functionality, and major releases for incompatible public API changes. ([Semantic Versioning][15])

Design tokens deserve the same discipline. Deleting:

```css
--ds-color-text-secondary
```

can be just as breaking as deleting a JavaScript prop.

Use deprecations and migration tooling instead of casually renaming public tokens or props.

---

## 14. Governance is what turns a library into a system

The repository needs an ownership model.

A practical lifecycle looks like:

```text
Need identified in product
        ↓
Check existing component/pattern
        ↓
Propose extension or new primitive
        ↓
Design + engineering + accessibility review
        ↓
Implement + document + test
        ↓
Release
        ↓
Adopt in actual product
        ↓
Observe usage
        ↓
Improve / deprecate
```

Do not make the design-system team the only team allowed to contribute; that tends to create a bottleneck.

But also do not allow unrestricted additions; that creates duplicate components and inconsistent APIs.

Use a **federated contribution model with centralized standards**.

Figma's own design-system guidance similarly includes documentation, stakeholder feedback, managed contributions, versioning, changelogs, and ongoing updates rather than treating the system as a one-time library project. ([Figmaヘルプセンター][16])

---

# A concrete build sequence

For a new web frontend, I would implement it in this order:

1. **Audit 5–10 representative screens.** Identify repeated decisions and the top 10–15 components by usage.
2. **Define foundations and semantic tokens.** Establish light/dark mappings and accessibility requirements before implementing dozens of components.
3. **Create the component infrastructure.** TypeScript, CSS strategy, Storybook, automated accessibility checks, visual tests, publishing and CI.
4. **Build a small core.** Start with Button, Link, Text, Icon, Stack/Flex, Input, Checkbox, Radio, Select, FormField, Alert and Dialog—not 60 components.
5. **Adopt the core in a real product flow.** This exposes missing requirements far faster than designing components abstractly.
6. **Add compositions and patterns only when repetition is proven.**
7. **Establish releases and contribution governance.** Once another application consumes the library, the public API becomes a compatibility obligation.

The critical point is **Step 5**. A design system developed entirely inside Storybook tends to look elegant while failing under real application constraints.

---

## The target architecture

If I were designing one today for a TypeScript/React frontend, my default architecture would be:

```text
DTCG-compatible token source
         │
         ├──→ Figma variables/modes
         │
         └──→ token build
                  │
                  ▼
           CSS custom properties
                  │
       ┌──────────┴───────────┐
       ▼                      ▼
accessible primitives     foundations
(Radix/React Aria         typography/layout/etc.
 or internal)
       │                      │
       └──────────┬───────────┘
                  ▼
          React components
                  │
                  ▼
          product patterns
                  │
                  ▼
          application UI

Storybook ───── docs + state catalog
Vitest/browser ─ interaction tests
axe ─────────── automated a11y
visual tests ── regression detection
SemVer ──────── package lifecycle
```

That gives you a system that can change visual identity without rewriting components, change implementation details without changing product APIs, and improve accessibility once for all consuming applications.

The design-system team should optimize for **consistency of decisions, accessibility, safe evolution, and product-development velocity**. Pixel consistency by itself is a weak success metric. A system that looks perfectly consistent but is difficult to extend or constantly bypassed by product teams has failed.

[1]: https://www.designtokens.org/technical-reports/?utm_source=chatgpt.com "Technical Reports | Design Tokens Community Group"
[2]: https://atlassian.design/foundations/tokens/design-tokens/?utm_source=chatgpt.com "Overview - Design tokens - Atlassian Design"
[3]: https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma?utm_source=chatgpt.com "Guide to variables in Figma – Figma Learn - Help Center"
[4]: https://www.designtokens.org/TR/2025.10/format/ "Design Tokens Format Module 2025.10"
[5]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables?utm_source=chatgpt.com "CSS custom properties for cascading variables - CSS | MDN"
[6]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark?utm_source=chatgpt.com "light-dark() CSS function - CSS | MDN"
[7]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/forced-colors?utm_source=chatgpt.com "forced-colors CSS media feature - CSS | MDN"
[8]: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/?utm_source=chatgpt.com "Developing a Keyboard Interface | APG | WAI | W3C"
[9]: https://www.radix-ui.com/primitives/docs/overview/introduction?utm_source=chatgpt.com "Introduction – Radix Primitives"
[10]: https://www.w3.org/TR/wcag/?utm_source=chatgpt.com "Web Content Accessibility Guidelines (WCAG) 2.2"
[11]: https://storybook.js.org/docs/writing-tests/accessibility-testing?utm_source=chatgpt.com "Accessibility tests | Storybook docs"
[12]: https://storybook.js.org/docs/writing-stories/index?utm_source=chatgpt.com "How to write stories | Storybook docs"
[13]: https://storybook.js.org/docs/writing-tests?utm_source=chatgpt.com "How to test UIs with Storybook | Storybook docs"
[14]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction?utm_source=chatgpt.com "Introduction to the CSS cascade - CSS | MDN"
[15]: https://semver.org/?utm_source=chatgpt.com "Semantic Versioning 2.0.0 | Semantic Versioning"
[16]: https://help.figma.com/hc/en-us/articles/14552901442839-Overview-Introduction-to-design-systems?utm_source=chatgpt.com "Overview: Introduction to design systems – Figma Learn - Help Center"
