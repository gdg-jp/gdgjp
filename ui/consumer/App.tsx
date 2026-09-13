import {
  Button,
  Card,
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  FormField,
  type IconName,
  Icons,
  Input,
  ThemeProvider,
  ThemeToggle,
} from "@gdgjp/ui";

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

export function App() {
  return (
    <ThemeProvider nonce="consumer-test">
      <main className="gdg-preview" style={{ padding: 24 }}>
        <Card>
          <h1>配布物の検証</h1>
          <ThemeToggle />
          <div aria-label="Wiki icon inventory">
            {wikiIconNames.map((name) => (
              <Icons key={name} name={name} aria-hidden="true" size={16} />
            ))}
          </div>
          <Icons name="Heart" aria-label="お気に入り" />
          <FormField label="名前">
            <Input />
          </FormField>
          <Combobox
            query=""
            defaultQuery="ignored in controlled mode"
            activeValue={null}
            defaultActiveValue="venue"
            shouldFilter={false}
            closeOnSelect={false}
            onQueryChange={() => {}}
            onActiveValueChange={() => {}}
          >
            <ComboboxContent aria-label="会場">
              <ComboboxInput placeholder="会場を検索" />
              <ComboboxList>
                <ComboboxItem value="venue">会場</ComboboxItem>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button>保存</Button>
        </Card>
      </main>
    </ThemeProvider>
  );
}
