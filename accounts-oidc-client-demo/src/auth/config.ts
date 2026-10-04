export type Env = {
  IDP_ISSUER: string;
  IDP_CLIENT_ID?: string;
  IDP_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

export function isConfigured(
  env: Env,
): env is Env & Required<Pick<Env, "IDP_CLIENT_ID" | "IDP_CLIENT_SECRET" | "SESSION_SECRET">> {
  return Boolean(
    env.IDP_ISSUER && env.IDP_CLIENT_ID && env.IDP_CLIENT_SECRET && env.SESSION_SECRET,
  );
}
