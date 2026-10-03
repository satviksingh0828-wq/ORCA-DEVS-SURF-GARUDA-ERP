BEGIN;

ALTER TABLE public.screen_control_sessions
  ADD COLUMN IF NOT EXISTS share_scope TEXT NOT NULL DEFAULT 'app'
  CHECK (share_scope IN ('app', 'system'));

COMMENT ON COLUMN public.screen_control_sessions.share_scope IS
  'Requested capture scope: app is the ERP app surface; system is the full desktop.';

COMMIT;
