# QuestionnaireNew

## Use case

Use as a compatibility alias that re-exports `Questionnaire` from the same source. Prefer `Questionnaire` for new usage and use this name only when existing code depends on it. Its props and behavior are identical to Questionnaire.

Avoid: treating it as a separate implementation or new API, or creating two flows because this alias exists.

## Public API

`QuestionnaireNew`, `QuestionnaireChoiceDefinition`, `QuestionnaireItemDefinition`.

## Minimal example

```tsx
<QuestionnaireNew items={items}>{children}</QuestionnaireNew>
```

See `ui/src/components/QuestionnaireNew/QuestionnaireNew.stories.tsx` for states and compositions.
