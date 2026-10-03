BEGIN;

-- Screen-control metadata and WebRTC signaling are only accessible through
-- server functions authenticated with the app's HMAC-signed custom sessions.
-- No screen pixels, audio, or user input are stored in these tables.
CREATE TABLE IF NOT EXISTS public.screen_control_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'declined', 'ended', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  end_reason TEXT,
  CONSTRAINT screen_control_sessions_distinct_users CHECK (requester_id <> target_id)
);

-- A user may participate in only one pending/active remote session at a time.
CREATE UNIQUE INDEX IF NOT EXISTS screen_control_one_live_requester_idx
  ON public.screen_control_sessions (requester_id)
  WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS screen_control_one_live_target_idx
  ON public.screen_control_sessions (target_id)
  WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS screen_control_sessions_target_inbox_idx
  ON public.screen_control_sessions (target_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS screen_control_sessions_requester_idx
  ON public.screen_control_sessions (requester_id, created_at DESC);

-- The partial indexes above cover each role separately; this trigger protects
-- the cross-role case (a user being a target in one session and requester in another).
CREATE OR REPLACE FUNCTION public.enforce_single_live_screen_control_session()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_user TEXT := least(NEW.requester_id::TEXT, NEW.target_id::TEXT);
  v_second_user TEXT := greatest(NEW.requester_id::TEXT, NEW.target_id::TEXT);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_first_user, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_second_user, 0));

  IF EXISTS (
    SELECT 1
    FROM public.screen_control_sessions s
    WHERE s.status IN ('pending', 'active')
      AND (s.requester_id IN (NEW.requester_id, NEW.target_id)
        OR s.target_id IN (NEW.requester_id, NEW.target_id))
  ) THEN
    RAISE EXCEPTION 'One of these users is already in another screen-control session';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER screen_control_one_live_session
  BEFORE INSERT ON public.screen_control_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_live_screen_control_session();

CREATE TABLE IF NOT EXISTS public.screen_control_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.screen_control_sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT screen_control_signals_distinct_users CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS screen_control_signals_recipient_cursor_idx
  ON public.screen_control_signals (session_id, recipient_id, id);

ALTER TABLE public.screen_control_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_control_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.screen_control_sessions, public.screen_control_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.screen_control_sessions, public.screen_control_signals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.screen_control_signals_id_seq TO service_role;

COMMIT;
