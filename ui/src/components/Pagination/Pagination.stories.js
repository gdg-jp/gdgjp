import { useState } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { Pagination } from "./Pagination";
const meta = {
  title: "Components/Pagination",
  component: Pagination,
  parameters: { layout: "centered" },
};
export default meta;
function InteractivePagination() {
  const [page, setPage] = useState(2);
  return _jsx(Pagination, { page: page, pageCount: 5, onPageChange: setPage });
}
export const Interactive = { render: () => _jsx(InteractivePagination, {}) };
export const FirstPage = {
  args: { page: 1, pageCount: 3, onPageChange: () => {} },
};
