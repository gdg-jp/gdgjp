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
    redirectUris: parseEntries(form.getAll("redirectUris")),
    postLogoutRedirectUris: parseEntries(form.getAll("postLogoutRedirectUris")),
    scopes: form
      .getAll("scopes")
      .map(String)
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

function parseEntries(values: FormDataEntryValue[]): string[] {
  return values
    .flatMap((value) => String(value).split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
}
