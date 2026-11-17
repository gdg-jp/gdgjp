# Wiki feature map

Drive these journeys through Orca's built-in browser. Existing specs are recipes, not the browser driver.

| Feature | Existing recipe |
| --- | --- |
| [Viewer permissions](viewer.md) | `page-menu.spec.ts`, read-only viewers |
| [Markdown redaction](redaction.md) | `page-menu.spec.ts`, Markdown copy |
| [Sharing dialog](sharing.md) | `access-control.spec.ts`, Google Docs-style overview |
| [Page display settings](page-menu.md) | `page-menu.spec.ts`, desktop menu |

Specs live in `apps/wiki/tests/e2e/`. Report which mapped journeys you actually drove. This map does not cover editor authoring, ingestion, search, external sync, or administrator workflows.

For Accounts OIDC, Wiki authoring, keyword search, and administrator boundaries,
use the expanded [platform feature map](../../verify-platform/features/README.md).
Its [coverage record](../../verify-platform/coverage.json) lists current-run status
for those journeys and these four existing recipes. A listed recipe does not
establish current execution.
