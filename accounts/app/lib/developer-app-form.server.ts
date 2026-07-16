export type DeveloperClientFormInput = {
  name: string;
  appUrl: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: string[];
};

export function parseDeveloperClientForm(form: FormData): DeveloperClientFormInput {
  return {
    name: String(form.get("name") ?? "").trim(),
    appUrl: String(form.get("appUrl") ?? "").trim(),
    redirectUris: parseLines(form.get("redirectUris")),
    postLogoutRedirectUris: parseLines(form.get("postLogoutRedirectUris")),
    scopes: form
      .getAll("scopes")
      .map(String)
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

function parseLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
