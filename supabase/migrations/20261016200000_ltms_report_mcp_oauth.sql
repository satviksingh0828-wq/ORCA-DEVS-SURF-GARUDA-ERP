-- OAuth 2.1 / authorization-code + PKCE support for the read-only LTMS Reports MCP.
-- This migration is safe to run after the base key migration and also creates
-- the base key table if only this script is being applied manually.

CREATE TABLE IF NOT EXISTS public.ltms_report_mcp_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS ltms_report_mcp_keys_active_hash_idx
  ON public.ltms_report_mcp_keys (token_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE public.ltms_report_mcp_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ltms_report_mcp_keys FROM anon, authenticated;
GRANT ALL ON TABLE public.ltms_report_mcp_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.ltms_report_mcp_oauth_clients (
  client_id text PRIMARY KEY,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  grant_types text[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ltms_report_mcp_oauth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_id text NOT NULL REFERENCES public.ltms_report_mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  oauth_state text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ltms_report_mcp_oauth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text NOT NULL REFERENCES public.ltms_report_mcp_oauth_clients(client_id) ON DELETE CASCADE,
  mcp_key_id uuid NOT NULL REFERENCES public.ltms_report_mcp_keys(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ltms_report_mcp_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES public.ltms_report_mcp_oauth_clients(client_id) ON DELETE CASCADE,
  mcp_key_id uuid NOT NULL REFERENCES public.ltms_report_mcp_keys(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL UNIQUE CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
  refresh_token_hash text UNIQUE CHECK (refresh_token_hash IS NULL OR refresh_token_hash ~ '^[0-9a-f]{64}$'),
  scope text NOT NULL,
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS ltms_report_mcp_oauth_requests_expiry_idx
  ON public.ltms_report_mcp_oauth_requests (expires_at);
CREATE INDEX IF NOT EXISTS ltms_report_mcp_oauth_codes_expiry_idx
  ON public.ltms_report_mcp_oauth_codes (expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS ltms_report_mcp_oauth_tokens_active_key_idx
  ON public.ltms_report_mcp_oauth_tokens (mcp_key_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.ltms_report_mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_report_mcp_oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_report_mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_report_mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ltms_report_mcp_oauth_clients FROM anon, authenticated;
REVOKE ALL ON TABLE public.ltms_report_mcp_oauth_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.ltms_report_mcp_oauth_codes FROM anon, authenticated;
REVOKE ALL ON TABLE public.ltms_report_mcp_oauth_tokens FROM anon, authenticated;

GRANT ALL ON TABLE public.ltms_report_mcp_oauth_clients TO service_role;
GRANT ALL ON TABLE public.ltms_report_mcp_oauth_requests TO service_role;
GRANT ALL ON TABLE public.ltms_report_mcp_oauth_codes TO service_role;
GRANT ALL ON TABLE public.ltms_report_mcp_oauth_tokens TO service_role;
