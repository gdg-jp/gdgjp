import {
  Button,
  Card,
  FormField,
  Icons,
  InputGroup,
  InputGroupButton,
  InputGroupInput,
  Stack,
  Switch,
  Text,
} from "@gdgjp/design-system";
import { Link } from "react-router";

/** Accepting spins, the counters, and the public URL to share. */
export function StatusCard({
  open,
  draws,
  left,
  slug,
  publicUrl,
  pending,
  onToggleOpen,
  onCopy,
}: {
  open: boolean;
  draws: number;
  /** What is left of the finite prizes. */
  left: number;
  slug: string;
  publicUrl: string;
  pending?: boolean;
  onToggleOpen: (open: boolean) => void;
  onCopy: () => void;
}) {
  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] md:items-center md:gap-8">
        <Stack className="gap-1">
          <div className="flex items-center gap-3">
            <Switch
              id="open-switch"
              checked={open}
              disabled={pending}
              onCheckedChange={onToggleOpen}
            />
            <label htmlFor="open-switch" className="text-lg font-semibold">
              抽選を受け付ける
            </label>
          </div>
          <Text size="sm" tone="muted">
            {open ? "受付中です。抽選画面で回せます。" : "停止中です。抽選画面では回せません。"}
          </Text>
        </Stack>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <Text size="xs" tone="muted">
              抽選回数
            </Text>
            <p className="text-2xl font-semibold tabular-nums">{draws} 回</p>
          </div>
          <div>
            <Text size="xs" tone="muted">
              景品の残り
            </Text>
            <p className="text-2xl font-semibold tabular-nums">{left} 個</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <FormField label="抽選画面の URL" className="min-w-0 flex-1">
            <InputGroup>
              <InputGroupInput readOnly value={publicUrl.replace(/^https?:\/\//, "")} />
              <InputGroupButton onClick={onCopy}>
                <Icons name="Copy" size={14} aria-hidden="true" />
                コピー
              </InputGroupButton>
            </InputGroup>
          </FormField>
          <Button variant="outline" asChild>
            <Link to={`/${slug}`} target="_blank" rel="noreferrer">
              <Icons name="ExternalLink" size={16} aria-hidden="true" />
              開く
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
