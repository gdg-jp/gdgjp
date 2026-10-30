import { Heading, Item, ItemContent, ItemGroup, ItemTitle, Stack } from "@gdgjp/design-system";
import { rankLabel } from "~/features/prizes/odds";

export type PrizeListItem = { name: string; rank: number };

/** What can be won. Names and ranks only — stock is never shown to visitors. */
export function PrizeList({ prizes }: { prizes: PrizeListItem[] }) {
  if (!prizes.length) return null;
  return (
    <section aria-labelledby="prize-list-heading">
      <Stack className="gap-2">
        <Heading level={2} id="prize-list-heading" className="text-base">
          景品
        </Heading>
        <ItemGroup>
          {prizes.map((prize) => (
            <Item key={prize.rank} size="sm" variant="outline">
              <ItemContent>
                <ItemTitle>
                  {rankLabel(prize.rank)} · {prize.name}
                </ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </Stack>
    </section>
  );
}
