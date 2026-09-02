import type * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockActionData = vi.fn();
const mockNavigation = vi.fn();

vi.mock("react-router", () => ({
  useActionData: () => mockActionData(),
  useNavigation: () => mockNavigation(),
  Form: ({ children, ...props }: React.ComponentProps<"form">) => (
    <form {...props}>{children}</form>
  ),
}));

vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-slot="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { TagDialog } from "./TagDialog";

describe("TagDialog", () => {
  it("does not render stale action error from prior action on initial open", () => {
    mockActionData.mockReturnValue({
      errorKey: "admin.tags.error_slug_taken",
      errorParams: { slug: "old-tag" },
    });
    mockNavigation.mockReturnValue({ state: "idle" });

    const html = renderToString(<TagDialog mode="create" open={true} onOpenChange={vi.fn()} />);

    expect(html).toContain('name="slug"');
    expect(html).not.toContain("admin.tags.error_slug_taken");
  });

  it("renders read-only slug and hidden input in edit mode", () => {
    mockActionData.mockReturnValue(undefined);
    mockNavigation.mockReturnValue({ state: "idle" });

    const tag = {
      slug: "react",
      labelJa: "リアクト",
      labelEn: "React",
      color: "#61dafb",
      pageCount: 10,
    };

    const html = renderToString(
      <TagDialog mode="edit" tag={tag} open={true} onOpenChange={vi.fn()} />,
    );

    expect(html).toContain('value="updateTag"');
    expect(html).toContain('value="react"');
    expect(html).toContain("react");
    expect(html).toContain('value="#61dafb"');
  });
});
