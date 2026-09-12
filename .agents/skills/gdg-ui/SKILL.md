---
name: gdg-ui
description: Implement and refactor GDG Apps React Router screens according to @gdgjp/ui. Use for app-side layouts, forms, icons, navigation, state displays, and responsive behavior; do not use for maintaining the shared ui/ library itself.
---

# GDG Apps UI implementation

Implement GDG Apps screens with the official `@gdgjp/ui` design language and public contracts while preserving each product's requirements.

## Check first

1. Read the target app's `package.json`, `app/root.tsx`, `app/app.css`, and nearby routes, components, and tests.
2. Read [design-principles.md](references/design-principles.md), [app-integration.md](references/app-integration.md), and [patterns.md](references/patterns.md).
3. From the [component index](references/components/index.md), read only the references for the families used in this task.
4. Use the references to guide selection and implementation, then verify the current `ui/src/components/<Family>/`, `ui/src/index.ts`, and Storybook at the start of the work. If a reference and the source disagree, prefer the source and report the discrepancy.

## Implementation decisions

- Prefer existing `@gdgjp/ui` components and compose screens with `Stack`, `Inline`, `Card`, `PageHeader`, and similar primitives. Do not introduce a local primitive merely because it looks similar.
- Keep routing, authentication, loader/action logic, validation, submission, URL matching, data fetching, and domain state in the app. Do not put product-specific logic in shared components.
- `ui/` is not changed as part of ordinary skill work. If the library is incorrect, lacks a needed capability, or its own examples demonstrate the wrong pattern, stop and report it as a library defect. Do not silently work around the library constraint in an app: a local workaround becomes the template for every later app.
- Replace existing screens incrementally and only within the requested scope. When the scope explicitly requests a full migration, follow [migration.md](references/migration.md). Otherwise, do not expand a local change into a full migration, custom theme overhaul, or information-architecture change.
- Use semantic tokens and public props. Do not make internal DOM, private classes, or Storybook-only classes part of the app contract. If an override is needed, use the public `className` and consumer utilities sparingly.
- As a rule, have one primary action per screen. Convey information, warning, success, and danger with labels, icons, and context in addition to color.

## Completion criteria

- Verify Light/Dark themes, keyboard behavior, focus, narrow widths, long Japanese text, and loading/empty/error/success states as relevant to the change.
- Run the target app's focused tests and typecheck first, and run Playwright for user-facing changes. If shared-package imports, exports, or CSS usage change, also verify the `@gdgjp/ui` consumer contract.
- When updating snapshots, inspect the images and confirm that only intended differences are present. Do not treat axe or passing tests alone as a substitute for visual and interaction review.
- At handoff, explicitly list changed files, validations run, unverified items, and any library-defect report.

## Library defect report

For every library defect, report the `ui/` file and line, expected behavior, the app-side
work that would otherwise have been required, and whether that workaround would remain valid
after the library fix. An empty list is a valid report, but for a migration spanning roughly
50 files it means the work likely missed a defect.
