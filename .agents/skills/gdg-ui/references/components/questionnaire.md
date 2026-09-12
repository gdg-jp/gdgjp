# Questionnaire

## Use case

Use for a staged question flow. Compose items, current position, answers, validation, and previous/next/skip/submit using the public contract. Preserve form semantics and focus for choices, and communicate progress and errors in text as well.

Avoid: forcing a single-field form or an entire domain workflow state machine into it.

## Public API

`Questionnaire`, `QuestionnaireProgress`, `QuestionnaireItem`, `QuestionnaireTitle`, `QuestionnaireDescription`, `QuestionnaireChoices`, `QuestionnaireChoice`, `QuestionnaireInput`, `QuestionnaireError`, `QuestionnaireActions`, `QuestionnairePrevious`, `QuestionnaireNext`, `QuestionnaireSkip`, `QuestionnaireSubmit`, `QuestionnaireNew`, `QuestionnaireChoiceDefinition`, `QuestionnaireItemDefinition`.

## Minimal example

```tsx
<Questionnaire items={[{ name: "format" }]}><QuestionnaireItem name="format"><QuestionnaireTitle>Event format</QuestionnaireTitle><QuestionnaireChoice value="online">Online</QuestionnaireChoice></QuestionnaireItem></Questionnaire>
```

See `ui/src/components/Questionnaire/Questionnaire.stories.tsx` for states and compositions.
