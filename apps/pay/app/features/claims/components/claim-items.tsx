import { Button, Card, FormField, Input, Table } from "@gdgjp/design-system";
import { Form } from "react-router";
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
    <section aria-label="明細">
      <Card className="p-0">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">明細</h2>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">まだ明細がありません。</p>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <div key={item.id} className="space-y-3 p-4">
                {canEdit ? (
                  <Form method="post" className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="intent" value="update-item" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <FormField id={`item-${item.id}-spentOn`} label="月日" required>
                      <Input name="spentOn" type="date" defaultValue={item.spentOn} required />
                    </FormField>
                    <FormField id={`item-${item.id}-category`} label="種別" required>
                      <Input
                        name="category"
                        list="category-options"
                        defaultValue={item.category}
                        required
                      />
                    </FormField>
                    <FormField
                      id={`item-${item.id}-description`}
                      label="品目"
                      required
                      className="sm:col-span-2"
                    >
                      <Input name="description" defaultValue={item.description} required />
                    </FormField>
                    <FormField id={`item-${item.id}-amountYen`} label="金額（円）" required>
                      <Input
                        name="amountYen"
                        inputMode="numeric"
                        defaultValue={String(item.amountYen)}
                        required
                      />
                    </FormField>
                    <div className="flex items-end gap-2">
                      <Button type="submit" size="sm" variant="secondary">
                        保存
                      </Button>
                    </div>
                    {item.receiptFilename ? (
                      <p className="break-words sm:col-span-2 text-xs text-muted">
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
                    <thead>
                      <tr>
                        <th scope="col">月日</th>
                        <th scope="col">種別</th>
                        <th scope="col">品目</th>
                        <th scope="col">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{item.spentOn}</td>
                        <td>{item.category}</td>
                        <td>{item.description}</td>
                        <td>{formatYen(item.amountYen)}</td>
                      </tr>
                    </tbody>
                  </Table>
                )}
                {canEdit ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete-item" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button type="submit" size="sm" variant="danger">
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
      </Card>
    </section>
  );
}
