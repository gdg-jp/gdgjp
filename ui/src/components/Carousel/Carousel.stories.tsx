import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./Carousel";

const meta = {
  title: "Components/Carousel",
  component: Carousel,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Carousel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Slides: Story = {
  render: () => (
    <Carousel style={{ width: 360 }}>
      <CarouselContent aria-label="イベント画像">
        {["学ぶ", "つながる", "共有する"].map((label, index) => (
          <CarouselItem key={label} aria-label={`スライド ${index + 1}`}>
            <div
              className="gdg-story-surface"
              style={{
                display: "grid",
                minHeight: 150,
                placeItems: "center",
                borderRadius: 20,
                background: "var(--gdg-selected)",
                color: "var(--gdg-link)",
                fontSize: 24,
              }}
            >
              {label}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <div className="gdg-inline" style={{ justifyContent: "space-between" }}>
        <CarouselPrevious />
        <CarouselNext />
      </div>
    </Carousel>
  ),
};
