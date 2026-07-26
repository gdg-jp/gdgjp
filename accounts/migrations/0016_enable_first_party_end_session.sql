-- First-party RPs predate the provider's `sid` ID-token claim. Enabling the
-- end-session capability ensures all subsequently issued tokens can revoke the
-- central Accounts session through RP-Initiated Logout.
UPDATE oauthClient
SET enableEndSession = 1
WHERE clientId IN ('tinyurl', 'wiki', 'img', 'scheduler');
