import {
  Card,
  FormField,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { RowTable } from "~/components/RowTable";
import type { Brief } from "../brief";
import {
  SCALAR_SECTIONS,
  TABLES,
  cellName,
  fieldName,
  scalarValue,
  tableRows,
} from "../brief-form";

/** Every field of the brief. Posts as f.<path> and t.<table>.<row>.<column> (brief-form.ts). */
export function BriefForm({ brief, disabled }: { brief: Brief | null; disabled: boolean }) {
  return (
    <Stack>
      {SCALAR_SECTIONS.map((section) => (
        <Card key={section.title}>
          <Stack>
            <Heading level={2} className="text-lg">
              {section.title}
            </Heading>
            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map((field) => {
                const value = scalarValue(field, brief);
                const name = fieldName(field.path);
                return (
                  <FormField key={field.path} label={field.label} description={field.description}>
                    {field.type === "select" ? (
                      <Select
                        name={name}
                        defaultValue={value || field.options?.[0]?.value}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.type === "lines" || field.type === "textarea" ? (
                      <Textarea name={name} defaultValue={value} rows={3} disabled={disabled} />
                    ) : (
                      <Input
                        name={name}
                        defaultValue={value}
                        disabled={disabled}
                        type={field.type === "datetime" ? "datetime-local" : "text"}
                        inputMode={field.type === "int" ? "numeric" : undefined}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>
          </Stack>
        </Card>
      ))}
      {TABLES.map((table) => (
        <Card key={table.id}>
          <Stack>
            <Heading level={2} className="text-lg">
              {table.title}
            </Heading>
            {table.description ? <Text tone="muted">{table.description}</Text> : null}
            <RowTable
              label={table.title}
              disabled={disabled}
              columns={table.columns.map((c) => ({
                key: c.path,
                label: c.label,
                type: c.type,
                options: c.options,
                width: c.width,
              }))}
              initialRows={tableRows(table, brief)}
              name={(row, column) => cellName(table.id, row, column)}
            />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
