import { jsx as _jsx } from "react/jsx-runtime";
import { Input } from "../Input";
import { Textarea } from "../Textarea";
import { FormField } from "./FormField";
const meta = {
  title: "Components/FormField",
  component: FormField,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(FormField, {
      label: "\u8868\u793A\u540D",
      description:
        "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u3067\u4F7F\u3046\u540D\u524D\u3067\u3059\u3002",
      required: true,
      children: _jsx(Input, { placeholder: "\u4F8B\uFF1AGDG Japan" }),
    }),
};
export const Invalid = {
  render: () =>
    _jsx(FormField, {
      id: "email",
      label: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9",
      description: "\u767B\u9332\u60C5\u5831\u306E\u66F4\u65B0\u306B\u4F7F\u3044\u307E\u3059\u3002",
      error:
        "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      children: _jsx(Input, { type: "email", defaultValue: "invalid" }),
    }),
};
export const TextareaField = {
  render: () =>
    _jsx(FormField, {
      label: "\u8AAC\u660E",
      children: _jsx(Textarea, {
        placeholder: "\u30A4\u30D9\u30F3\u30C8\u306E\u8AAC\u660E\u3092\u5165\u529B",
      }),
    }),
};
