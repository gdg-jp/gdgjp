export type Finding = { readonly name: string; readonly location: string };

export function needles(secret: string): string[];

export function zipEntries(buffer: Buffer): { name: string; data: Buffer }[];

export function scanForSecrets(
  paths: readonly string[],
  secrets: Readonly<Record<string, string | readonly string[] | undefined>>,
  texts?: readonly (readonly [string, string])[],
): Finding[];

export function valuesFrom(file: string): string[];
