import type { Meta, StoryObj } from "@storybook/react-vite";
import type { IconName } from "./IconName";
import { Icons } from "./Icons";

const meta = {
  title: "Components/Icons",
  component: Icons,
  parameters: { layout: "centered" },
  args: { name: "Heart", size: 24, "aria-label": "お気に入り" },
} satisfies Meta<typeof Icons>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Static: Story = {
  args: {
    name: "AlertCircle",
    animateOnHover: false,
    strokeWidth: 1.5,
    style: { color: "var(--gdg-danger)" },
  },
  render: (args) => <Icons {...args} data-testid="static-icon" />,
};
export const Decorative: Story = { args: { name: "Sparkles", "aria-hidden": true } };

const wikiIconNames = [
  "AlertCircle",
  "AlertTriangle",
  "Archive",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUpRight",
  "Bell",
  "BellDot",
  "BellOff",
  "CalendarDays",
  "ChartPie",
  "Check",
  "CheckCircle2",
  "ChevronDown",
  "ChevronLeft",
  "ChevronRight",
  "Clipboard",
  "Clock",
  "Copy",
  "ExternalLink",
  "FileInput",
  "FileQuestion",
  "FileText",
  "Folder",
  "FolderOpen",
  "Globe",
  "Globe2",
  "Hash",
  "History",
  "Home",
  "LayoutList",
  "Link",
  "Link2",
  "List",
  "ListChecks",
  "ListFilter",
  "ListTodo",
  "Loader2",
  "LoaderCircle",
  "LockKeyhole",
  "MessageSquare",
  "Moon",
  "MoreHorizontal",
  "MoveHorizontal",
  "PanelLeft",
  "PanelLeftClose",
  "Pencil",
  "Plus",
  "RefreshCw",
  "RotateCcw",
  "Send",
  "ServerCrash",
  "Settings",
  "Share2",
  "Smile",
  "Star",
  "Sun",
  "Tag",
  "Trash2",
  "Type",
  "Upload",
  "UserRound",
  "UsersRound",
  "X",
] satisfies readonly IconName[];

export const WikiCatalog: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, maxWidth: 640 }}>
      {wikiIconNames.map((name) => (
        <Icons key={name} name={name} aria-hidden="true" size={20} />
      ))}
    </div>
  ),
};
