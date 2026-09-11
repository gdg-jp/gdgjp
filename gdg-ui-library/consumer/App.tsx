import { Button, Card, FormField, Input, ThemeProvider, ThemeToggle } from "@gdgjp/gdg-ui-library";
export function App() {
  return (
    <ThemeProvider nonce="consumer-test">
      <main className="gdg-preview" style={{ padding: 24 }}>
        <Card>
          <h1>配布物の検証</h1>
          <ThemeToggle />
          <FormField label="名前">
            <Input />
          </FormField>
          <Button>保存</Button>
        </Card>
      </main>
    </ThemeProvider>
  );
}
