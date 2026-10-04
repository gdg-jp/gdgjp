export type GoogleOAuthTokenRow = {
  user_id: string;
  google_email: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_token_expires_at: number;
  template_granted_at: number | null;
  created_at: number;
  updated_at: number;
};

export type GoogleOAuthToken = {
  userId: string;
  googleEmail: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: number;
  templateGrantedAt: number | null;
};

export type OAuthTransaction = {
  state: string;
  userId: string;
  eventId: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

export type OAuthTransactionRow = {
  state: string;
  user_id: string;
  event_id: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
};
