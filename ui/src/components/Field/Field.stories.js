import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Input } from "../Input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./Field";
const meta = {
  title: "Components/Field",
  component: Field,
  parameters: { layout: "centered" },
};
export default meta;
export const FormSection = {
  render: () =>
    _jsxs(FieldSet, {
      style: { width: 360 },
      children: [
        _jsx(FieldLegend, { children: "\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB" }),
        _jsxs(FieldGroup, {
          children: [
            _jsxs(Field, {
              children: [
                _jsx(FieldLabel, { htmlFor: "field-display-name", children: "\u8868\u793A\u540D" }),
                _jsxs(FieldContent, {
                  children: [
                    _jsx(Input, { id: "field-display-name", defaultValue: "GDG Japan" }),
                    _jsx(FieldDescription, {
                      children:
                        "\u53C2\u52A0\u8005\u306B\u8868\u793A\u3055\u308C\u308B\u540D\u524D\u3067\u3059\u3002",
                    }),
                  ],
                }),
              ],
            }),
            _jsxs(Field, {
              children: [
                _jsx(FieldLabel, {
                  htmlFor: "field-email",
                  children: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9",
                }),
                _jsx(Input, { id: "field-email", "aria-invalid": "true", defaultValue: "invalid" }),
                _jsx(FieldError, {
                  errors: [{ message: "メールアドレスの形式を確認してください。" }],
                }),
              ],
            }),
            _jsx(Button, { type: "button", children: "\u4FDD\u5B58" }),
          ],
        }),
      ],
    }),
};
