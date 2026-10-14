import type { OIDCConfig, OIDCUserConfig } from "next-auth/providers";

// OIDC の UserInfo レスポンスの型定義
interface GDGUserProfile {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export function GDGAccounts(
  options: Partial<OIDCUserConfig<GDGUserProfile>> = {},
): OIDCConfig<GDGUserProfile> {
  return {
    id: "gdg-accounts",
    name: "GDG Accounts",
    type: "oidc",
    issuer: "https://accounts.gdgs.jp",
    wellKnown: "https://accounts.gdgs.jp/.well-known/openid-configuration",
    clientId: process.env.GDG_CLIENT_ID,
    clientSecret: process.env.GDG_CLIENT_SECRET,
    authorization: {
      params: {
        scope: "openid profile email https://gdgs.jp/scopes/chapters",
        code_challenge_method: "S256",
      },
    },
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
      };
    },
    ...options,
  };
}
