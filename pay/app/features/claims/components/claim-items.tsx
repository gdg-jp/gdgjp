import { Form } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatYen } from "../money";

export function ClaimItems({
  canEdit,
  items,
  categories,
}: {
  canEdit: boolean;
  categories: string[];
  items: Array<{
    id: string;
    spentOn: string;
    category: string;
    description: string;
    amountYen: number;
    receiptFilename: string | null;
    receiptKey: string | null;
  }>;
}) {
  return (
    <section className="overflow-hidden rounded-xl border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">明細</h2>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">まだ明細がありません。</p>
      ) : (
        <div className="divide-y">
          {items.map((item) => (
            <div key={item.id} className="space-y-3 p-4">
              {canEdit ? (
                <Form method="post" className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="intent" value="update-item" />
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="space-y-1">
                    <Label>月日</Label>
                    <Input name="spentOn" type="date" defaultValue={item.spentOn} required />
                  </div>
                  <div className="space-y-1">
                    <Label>種別</Label>
                    <Input
                      name="category"
                      list="category-options"
                      defaultValue={item.category}
                      required
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>品目</Label>
                    <Input name="description" defaultValue={item.description} required />
                  </div>
                  <div className="space-y-1">
                    <Label>金額（円）</Label>
                    <Input
                      name="amountYen"
                      inputMode="numeric"
                      defaultValue={String(item.amountYen)}
                      required
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button type="submit" size="sm">
                      保存
                    </Button>
                  </div>
                  {item.receiptFilename ? (
                    <p className="sm:col-span-2 text-xs text-muted-foreground">
                      領収書:{" "}
                      {item.receiptKey ? (
                        <a className="underline" href={`/receipts/${item.receiptKey}`}>
                          {item.receiptFilename}
                        </a>
                      ) : (
                        item.receiptFilename
                      )}
                    </p>
                  ) : null}
                </Form>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>月日</TableHead>
                      <TableHead>種別</TableHead>
                      <TableHead>品目</TableHead>
                      <TableHead>金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{item.spentOn}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{formatYen(item.amountYen)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              {canEdit ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="delete-item" />
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button type="submit" size="sm" variant="destructive">
                    この明細を削除
                  </Button>
                </Form>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <datalist id="category-options">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </section>
  );
}
