-- Revocable, hashed credentials for the read-only LTMS Reports MCP endpoint.
-- No client roles receive access: key lifecycle and lookup run through server-side service_role only.
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
