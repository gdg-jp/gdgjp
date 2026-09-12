import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Pagination } from "./Pagination";

const meta = {
  title: "Components/Pagination",
  component: Pagination,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Pagination>;
export default meta;
type Story = StoryObj;

function InteractivePagination() {
  const [page, setPage] = useState(2);
  return <Pagination page={page} pageCount={5} onPageChange={setPage} />;
}

export const Interactive: Story = { render: () => <InteractivePagination /> };
export const FirstPage: Story = {
  args: { page: 1, pageCount: 3, onPageChange: () => {} },
};
