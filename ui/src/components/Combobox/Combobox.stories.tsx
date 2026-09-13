import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../Button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./Combobox";

const meta = {
  title: "Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Combobox>;
export default meta;
type Story = StoryObj<typeof meta>;

const venues = [
  { value: "tokyo", label: "Tokyo" },
  { value: "osaka", label: "Osaka", keywords: ["関西"] },
  { value: "sapporo", label: "Sapporo" },
];

function VenueItems() {
  return (
    <>
      {venues.map((venue) => (
        <ComboboxItem key={venue.value} value={venue.value} keywords={venue.keywords}>
          {venue.label}
        </ComboboxItem>
      ))}
      <ComboboxEmpty />
    </>
  );
}

export const Searchable: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxTrigger asChild>
        <Button variant="outline">チャプターを選択</Button>
      </ComboboxTrigger>
      <ComboboxContent aria-label="チャプター候補">
        <ComboboxInput placeholder="検索" />
        <ComboboxList>
          <VenueItems />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};

function ControlledQueryStory() {
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  return (
    <div style={{ width: 280 }}>
      <Combobox
        defaultOpen
        query={query}
        onQueryChange={setQuery}
        activeValue={activeValue}
        onActiveValueChange={setActiveValue}
      >
        <ComboboxContent aria-label="Controlled venue search">
          <ComboboxInput placeholder="Search venues" />
          <ComboboxList>
            <VenueItems />
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <output data-testid="combobox-query">{query || "(empty)"}</output>
    </div>
  );
}

export const ControlledQuery: Story = { render: () => <ControlledQueryStory /> };

function RemoteStory() {
  const [query, setQuery] = useState("");
  const results = venues.filter((venue) =>
    `${venue.label} ${venue.keywords?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Combobox defaultOpen query={query} onQueryChange={setQuery} shouldFilter={false}>
      <ComboboxContent aria-label="Remote venue search">
        <ComboboxInput placeholder="Search remote results" />
        <ComboboxList>
          {results.map((venue) => (
            <ComboboxItem key={venue.value} value={venue.value}>
              {venue.label}
            </ComboboxItem>
          ))}
          <ComboboxEmpty>サーバーから候補が返りません。</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export const Remote: Story = { render: () => <RemoteStory /> };

function MultipleStory() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div style={{ width: 300 }}>
      <Combobox
        defaultOpen
        query={query}
        onQueryChange={setQuery}
        closeOnSelect={false}
        shouldFilter={false}
      >
        <ComboboxTrigger asChild>
          <Button variant="outline">メンバーを選択</Button>
        </ComboboxTrigger>
        <ComboboxContent aria-label="複数選択">
          <ComboboxInput placeholder="メンバーを検索" />
          <ComboboxList>
            {venues.map((venue) => (
              <ComboboxItem
                key={venue.value}
                value={venue.value}
                onSelect={(value) =>
                  setSelected((current) =>
                    current.includes(value)
                      ? current.filter((item) => item !== value)
                      : [...current, value],
                  )
                }
              >
                {venue.label}
              </ComboboxItem>
            ))}
            <ComboboxEmpty />
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <output data-testid="combobox-selected">{selected.join(", ") || "(none)"}</output>
    </div>
  );
}

export const Multiple: Story = { render: () => <MultipleStory /> };

export const Disabled: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxContent aria-label="Disabled venue search">
        <ComboboxInput placeholder="Search" />
        <ComboboxList>
          <ComboboxItem value="disabled" disabled>
            Disabled venue
          </ComboboxItem>
          <ComboboxItem value="available">Available venue</ComboboxItem>
          <ComboboxEmpty />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};

function ReorderedStory() {
  const [reversed, setReversed] = useState(false);
  const orderedVenues = reversed ? [...venues].reverse() : venues;
  return (
    <div>
      <Button
        variant="outline"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setReversed((current) => !current)}
      >
        Reverse results
      </Button>
      <Combobox defaultOpen>
        <ComboboxTrigger asChild>
          <Button variant="ghost">Choose a venue</Button>
        </ComboboxTrigger>
        <ComboboxContent aria-label="Reordered venues">
          <ComboboxInput placeholder="Search" />
          <ComboboxList>
            {orderedVenues.map((venue) => (
              <ComboboxItem key={venue.value} value={venue.value}>
                {venue.label}
              </ComboboxItem>
            ))}
            <ComboboxEmpty />
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

export const Reordered: Story = { render: () => <ReorderedStory /> };

export const Loading: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxContent aria-label="Loading venues">
        <ComboboxInput placeholder="Search" />
        <ComboboxList>
          <ComboboxEmpty aria-live="polite" aria-atomic="true">
            候補を読み込んでいます…
          </ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};

export const ErrorState: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxContent aria-label="Venue search error">
        <ComboboxInput placeholder="Search" />
        <ComboboxList>
          <ComboboxEmpty role="alert">候補を読み込めませんでした。</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};

export const LongJapanese: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxContent aria-label="長い日本語の候補">
        <ComboboxInput placeholder="候補を検索" />
        <ComboboxList>
          <ComboboxItem value="long">
            とても長い日本語のイベント会場候補名でも横方向へ画面を押し広げない
          </ComboboxItem>
          <ComboboxEmpty />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};
