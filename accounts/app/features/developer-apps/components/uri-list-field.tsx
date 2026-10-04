import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  IconButton,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from "@gdgjp/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { OptionalLabel, RequiredLabel, RequiredMark } from "./field-labels";

export function UriListField({
  id,
  headingId,
  label,
  description,
  required,
  spacious = false,
  values,
}: {
  id: string;
  headingId?: string;
  label: string;
  description: string;
  required?: boolean;
  spacious?: boolean;
  values?: string[];
}) {
  const { t } = useTranslation();
  const nextEntryId = useRef(0);
  const [entries, setEntries] = useState(() =>
    (values && values.length > 0 ? values : required ? [""] : []).map((value, index) => ({
      key: `${id}-initial-${index}`,
      value,
    })),
  );

  function updateEntry(index: number, value: string) {
    setEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, value } : entry)),
    );
  }

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  }

  return (
    <div className={spacious ? "space-y-4" : "space-y-3"}>
      <div>
        {spacious ? (
          <Heading level={2} id={headingId} className="text-xl">
            {label} {required ? <RequiredMark /> : null}
          </Heading>
        ) : (
          <Text size="sm">
            {label} {required ? <RequiredLabel /> : <OptionalLabel />}
          </Text>
        )}
        <Text size={spacious ? "sm" : "xs"} tone="muted" className="mt-1">
          {description}
        </Text>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={entry.key} className="flex gap-2">
            <FormField
              id={`${id}-${index}`}
              label={`${label} ${index + 1}`}
              hideLabel
              required={required}
              className="min-w-0 flex-1 gap-0"
            >
              <Input
                name={id}
                type="url"
                value={entry.value}
                onChange={(event) => updateEntry(index, event.target.value)}
                placeholder="https://example.com/callback"
                className="w-full font-mono text-sm"
              />
            </FormField>
            <IconButton
              variant={spacious ? "outline" : "ghost"}
              disabled={required && entries.length === 1}
              onClick={() => removeEntry(index)}
              aria-label={t("developerApps.form.removeUri", { index: index + 1 })}
            >
              <Icons name="Delete" size={16} aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={entries.length >= 10}
        onClick={() =>
          setEntries((current) => [
            ...current,
            { key: `${id}-added-${nextEntryId.current++}`, value: "" },
          ])
        }
      >
        <Icons name="Plus" size={16} aria-hidden="true" />
        {t("developerApps.form.addUri")}
      </Button>
    </div>
  );
}
