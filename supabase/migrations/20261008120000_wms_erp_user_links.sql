-- Link existing ERP users to existing Sentry WMS users for signed ERP SSO.
-- This records an account association only; it never copies WMS credentials.
-- Run after public.app_users and public.wms_users exist in the shared Supabase database.

BEGIN;

CREATE TABLE IF NOT EXISTS public.wms_erp_user_links (
  erp_user_id UUID PRIMARY KEY
    REFERENCES public.app_users(id) ON DELETE CASCADE,
  wms_user_id INTEGER NOT NULL UNIQUE
    REFERENCES public.wms_users(user_id) ON DELETE CASCADE,
  linked_by UUID
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wms_erp_user_links IS
  'One-to-one mapping between an ERP app_users record and an existing WMS wms_users record. Enables signed session exchange without sharing passwords.';

ALTER TABLE public.wms_erp_user_links ENABLE ROW LEVEL SECURITY;

-- The ERP application accesses this table only from its server-side service-role client.
-- No browser/anon/authenticated client policies are created.
REVOKE ALL ON TABLE public.wms_erp_user_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wms_erp_user_links TO service_role;

COMMIT;
