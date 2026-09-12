import { Button, Card, FormField, Icons, Input, ThemeProvider, ThemeToggle } from "@gdgjp/ui";
export function App() {
  return (
    <ThemeProvider nonce="consumer-test">
      <main className="gdg-preview" style={{ padding: 24 }}>
        <Card>
          <h1>配布物の検証</h1>
          <ThemeToggle />
          <Icons name="Heart" aria-label="お気に入り" />
          <FormField label="名前">
            <Input />
          </FormField>
          <Button>保存</Button>
        </Card>
      </main>
    </ThemeProvider>
  );
}
