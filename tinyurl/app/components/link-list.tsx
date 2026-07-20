import type { DisplayLayout, DisplayProperty } from "~/components/dashboard-display-menu";
import { LinkCard, type LinkCardItem } from "~/components/link-card";

export function LinkList({
  items,
  shortUrlBase,
  shortHost,
  layout = "cards",
  properties,
}: {
  items: LinkCardItem[];
  shortUrlBase: string;
  shortHost: string;
  layout?: DisplayLayout;
  properties?: DisplayProperty[];
}) {
  return (
    <div
      className={
        layout === "cards"
          ? "flex flex-col gap-2"
          : "min-w-0 divide-y overflow-hidden rounded-xl border bg-card"
      }
    >
      {items.map((item) => (
        <LinkCard
          key={item.link.id}
          item={item}
          shortUrlBase={shortUrlBase}
          shortHost={shortHost}
          layout={layout}
          properties={properties}
        />
      ))}
    </div>
  );
}
