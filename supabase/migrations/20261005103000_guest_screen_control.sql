BEGIN;

-- Guests are short-lived screen-control participants, never app_users. Their
-- opaque tab token is stored only as a SHA-256 digest. Server functions remove
-- their rows on leave and expire abandoned tabs after the presence TTL.
CREATE TABLE IF NOT EXISTS public.screen_control_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL CHECK (char_length(btrim(username)) BETWEEN 2 AND 32),
  token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screen_control_guests_last_seen_idx
  ON public.screen_control_guests (last_seen_at DESC);

-- This table contains only sessions where at least one side is an ERP user.
-- Guest-to-guest sessions are rejected by a database constraint as well as the
-- application, so the public lobby cannot create an all-guest control path.
CREATE TABLE IF NOT EXISTS public.guest_screen_control_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_ref TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  requester_name TEXT NOT NULL CHECK (char_length(requester_name) BETWEEN 1 AND 64),
  target_name TEXT NOT NULL CHECK (char_length(target_name) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'declined', 'ended', 'expired')),
  share_scope TEXT NOT NULL DEFAULT 'app' CHECK (share_scope IN ('app', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ended_by_ref TEXT,
  end_reason TEXT,
  CONSTRAINT guest_screen_control_distinct_participants CHECK (requester_ref <> target_ref),
  CONSTRAINT guest_screen_control_requires_erp_user
    CHECK (requester_ref LIKE 'user:%' OR target_ref LIKE 'user:%'),
  CONSTRAINT guest_screen_control_valid_requester
    CHECK (requester_ref ~ '^(user|guest):[0-9a-f-]{36}$'),
  CONSTRAINT guest_screen_control_valid_target
    CHECK (target_ref ~ '^(user|guest):[0-9a-f-]{36}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_screen_control_live_requester_idx
  ON public.guest_screen_control_sessions (requester_ref)
  WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS guest_screen_control_live_target_idx
  ON public.guest_screen_control_sessions (target_ref)
  WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS guest_screen_control_requester_history_idx
  ON public.guest_screen_control_sessions (requester_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_screen_control_target_inbox_idx
  ON public.guest_screen_control_sessions (target_ref, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.guest_screen_control_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.guest_screen_control_sessions(id) ON DELETE CASCADE,
  sender_ref TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guest_screen_control_signals_distinct_participants CHECK (sender_ref <> recipient_ref)
);
CREATE INDEX IF NOT EXISTS guest_screen_control_signals_recipient_cursor_idx
  ON public.guest_screen_control_signals (session_id, recipient_ref, id);

-- Lock the same canonical participant keys from both session tables and check
-- both tables, preventing one ERP user from racing into a second live session.
CREATE OR REPLACE FUNCTION public.enforce_single_live_screen_control_session()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_ref TEXT := least('user:' || NEW.requester_id::TEXT, 'user:' || NEW.target_id::TEXT);
  v_second_ref TEXT := greatest('user:' || NEW.requester_id::TEXT, 'user:' || NEW.target_id::TEXT);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_first_ref, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_second_ref, 0));

  IF EXISTS (
    SELECT 1
    FROM public.screen_control_sessions s
    WHERE s.status IN ('pending', 'active')
      AND (s.requester_id IN (NEW.requester_id, NEW.target_id)
        OR s.target_id IN (NEW.requester_id, NEW.target_id))
  ) OR EXISTS (
    SELECT 1
    FROM public.guest_screen_control_sessions g
    WHERE g.status IN ('pending', 'active')
      AND (g.requester_ref IN (v_first_ref, v_second_ref)
        OR g.target_ref IN (v_first_ref, v_second_ref))
  ) THEN
    RAISE EXCEPTION 'One of these users is already in another screen-control session';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_single_live_guest_screen_control_session()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_ref TEXT := least(NEW.requester_ref, NEW.target_ref);
  v_second_ref TEXT := greatest(NEW.requester_ref, NEW.target_ref);
  v_first_user UUID;
  v_second_user UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_first_ref, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_second_ref, 0));

  IF EXISTS (
    SELECT 1
    FROM public.guest_screen_control_sessions g
    WHERE g.status IN ('pending', 'active')
      AND (g.requester_ref IN (NEW.requester_ref, NEW.target_ref)
        OR g.target_ref IN (NEW.requester_ref, NEW.target_ref))
  ) THEN
    RAISE EXCEPTION 'One of these participants is already in another screen-control session';
  END IF;

  IF NEW.requester_ref LIKE 'user:%' THEN
    v_first_user := substring(NEW.requester_ref FROM 6)::UUID;
  END IF;
  IF NEW.target_ref LIKE 'user:%' THEN
    v_second_user := substring(NEW.target_ref FROM 6)::UUID;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.screen_control_sessions s
    WHERE s.status IN ('pending', 'active')
      AND ((v_first_user IS NOT NULL AND (s.requester_id = v_first_user OR s.target_id = v_first_user))
        OR (v_second_user IS NOT NULL AND (s.requester_id = v_second_user OR s.target_id = v_second_user)))
  ) THEN
    RAISE EXCEPTION 'One of these users is already in another screen-control session';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guest_screen_control_one_live_session
  ON public.guest_screen_control_sessions;
CREATE TRIGGER guest_screen_control_one_live_session
  BEFORE INSERT ON public.guest_screen_control_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_live_guest_screen_control_session();

ALTER TABLE public.screen_control_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_screen_control_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_screen_control_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.screen_control_guests, public.guest_screen_control_sessions,
  public.guest_screen_control_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.screen_control_guests, public.guest_screen_control_sessions,
  public.guest_screen_control_signals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.guest_screen_control_signals_id_seq TO service_role;

COMMENT ON TABLE public.screen_control_guests IS
  'Ephemeral public share identities; never inserted into app_users and removed at tab close or after presence expiry.';
COMMENT ON TABLE public.guest_screen_control_sessions IS
  'Mixed ERP/guest sessions; CHECK constraint requires at least one authenticated ERP participant.';

COMMIT;
