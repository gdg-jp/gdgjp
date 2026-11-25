export type AccessScope = {
  readonly domain: string | null;
  readonly localOrigins: readonly string[];
};

export function isLoopbackOrigin(value: string): boolean;

export function accessScope(options: {
  readonly domain?: string | null;
  readonly localOrigins?: readonly string[];
}): AccessScope;

export function inAccessScope(scope: AccessScope, value: string): boolean;

export function isTestDomain(domain: string): boolean;
