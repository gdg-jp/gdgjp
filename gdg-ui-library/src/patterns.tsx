import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  Menu,
  TriangleAlert,
} from "lucide-react";
import { Accordion as RAccordion, Tabs as RTabs } from "radix-ui";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { Button, Heading, IconButton, type Tone } from "./foundations";
import { useMotionRef } from "./motion";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./overlays";
import { useTheme } from "./theme";
import { cn } from "./utils";
export { toast };
export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { tone?: Tone; title: ReactNode }) {
  const Icon =
    tone === "danger"
      ? CircleAlert
      : tone === "warning"
        ? TriangleAlert
        : tone === "success"
          ? CircleCheck
          : Info;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      {...props}
      className={cn("gdg-alert", `gdg-tone-${tone}`, className)}
    >
      <Icon size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
export function Toaster(props: ComponentProps<typeof Sonner>) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      closeButton
      {...props}
      className={cn("gdg-toaster", props.className)}
      style={{
        zIndex: "var(--gdg-layer-toast)",
        fontFamily: "var(--gdg-font-sans)",
        ...props.style,
      }}
      toastOptions={{
        ...props.toastOptions,
        className: cn("gdg-toast", props.toastOptions?.className),
        style: {
          background: "var(--gdg-surface)",
          color: "var(--gdg-text)",
          borderColor: "var(--gdg-border)",
          borderRadius: "var(--gdg-radius-md)",
          boxShadow: "none",
          fontFamily: "var(--gdg-font-sans)",
          transition: "var(--gdg-toast-transition)",
          ...props.toastOptions?.style,
        },
      }}
    />
  );
}
export function Spinner({
  label = "読み込み中",
  className,
  ...props
}: ComponentProps<"output"> & { label?: string }) {
  return (
    <output {...props} className={cn("gdg-inline", className)}>
      <LoaderCircle className="gdg-spinner" aria-hidden="true" />
      <span className="gdg-sr-only">{label}</span>
    </output>
  );
}
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden="true" {...props} className={cn("gdg-skeleton", className)} />;
}
export function EmptyState({
  title,
  description,
  action,
}: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="gdg-empty">
      <Heading level={2}>{title}</Heading>
      {description && <p className="gdg-muted">{description}</p>}
      {action}
    </div>
  );
}
export function Table({
  className,
  scrollLabel = "表を横にスクロール",
  ...props
}: ComponentProps<"table"> & { scrollLabel?: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: overflow region must support keyboard scrolling.
    <section aria-label={scrollLabel} tabIndex={0} className="gdg-table-scroll">
      <table {...props} className={cn("gdg-table", className)} />
    </section>
  );
}
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "ページ切替",
}: { page: number; pageCount: number; onPageChange: (page: number) => void; label?: string }) {
  return (
    <nav className="gdg-inline" aria-label={label}>
      <Button variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        前へ
      </Button>
      <span aria-live="polite">
        {pageCount === 0 ? 0 : page} / {pageCount}
      </span>
      <Button variant="outline" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        次へ
      </Button>
    </nav>
  );
}
export const Tabs = RTabs.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return <RTabs.List {...props} className={cn("gdg-tabs-list", className)} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return <RTabs.Trigger {...props} className={cn("gdg-tabs-trigger", className)} />;
}
export function TabsContent({ className, ...props }: ComponentProps<typeof RTabs.Content>) {
  return <RTabs.Content {...props} className={cn("gdg-tabs-content", className)} />;
}
export const Accordion = RAccordion.Root;
export function AccordionItem({ className, ...props }: ComponentProps<typeof RAccordion.Item>) {
  return <RAccordion.Item {...props} className={cn("gdg-accordion-item", className)} />;
}
export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RAccordion.Trigger>) {
  return (
    <RAccordion.Header className="gdg-accordion-heading">
      <RAccordion.Trigger {...props} className={cn("gdg-accordion-trigger", className)}>
        {children}
        <ChevronDown size={16} />
      </RAccordion.Trigger>
    </RAccordion.Header>
  );
}
export function AccordionContent({
  ref,
  className,
  children,
  ...props
}: ComponentProps<typeof RAccordion.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RAccordion.Content
      ref={motionRef}
      {...props}
      className={cn("gdg-accordion-content", className)}
    >
      <div className="gdg-accordion-inner">{children}</div>
    </RAccordion.Content>
  );
}
export function Breadcrumb({ children, ...props }: ComponentProps<"nav">) {
  return (
    <nav aria-label="パンくず" {...props}>
      <ol className="gdg-breadcrumb">{children}</ol>
    </nav>
  );
}
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-toolbar", className)} />;
}
export function PageHeader({
  title,
  description,
  actions,
}: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="gdg-page-header">
      <div>
        <Heading level={1}>{title}</Heading>
        {description && <p className="gdg-muted">{description}</p>}
      </div>
      {actions && <div className="gdg-inline">{actions}</div>}
    </header>
  );
}
export function SidebarNav({ children, className, ...props }: ComponentProps<"nav">) {
  return (
    <nav {...props} className={cn("gdg-sidebar-nav", className)}>
      {children}
    </nav>
  );
}
export function AppShell({
  navigation,
  header,
  children,
  brand,
  navigationLabel = "ナビゲーション",
}: {
  navigation: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  brand: ReactNode;
  navigationLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gdg-shell">
      <a className="gdg-skip-link" href="#gdg-main">
        本文へ移動
      </a>
      <aside className="gdg-sidebar">
        <div className="gdg-brand">{brand}</div>
        {navigation}
      </aside>
      <div className="gdg-shell-body">
        <header className="gdg-shell-header">
          <div className="gdg-mobile-only">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <IconButton variant="ghost" aria-label={navigationLabel}>
                  <Menu size={20} />
                </IconButton>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>{navigationLabel}</SheetTitle>
                <SheetDescription>移動先を選択してください。</SheetDescription>
                <div
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a")) setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.target as HTMLElement).closest("a")) setOpen(false);
                  }}
                >
                  {navigation}
                </div>
                <SheetClose asChild>
                  <Button variant="outline">閉じる</Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          </div>
          {header}
        </header>
        <main id="gdg-main" tabIndex={-1} className="gdg-main">
          {children}
        </main>
      </div>
    </div>
  );
}
