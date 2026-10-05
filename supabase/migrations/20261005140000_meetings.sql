-- Team Meet: meetings, invitations, attendance, and private signaling.
-- All application access is mediated by server functions using service_role.
-- Browser roles receive no direct grants or RLS policies for these tables.

CREATE TABLE IF NOT EXISTS public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Team meeting' CHECK (char_length(title) <= 100),
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  created_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS meetings_status_created_at_idx
  ON public.meetings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS meetings_created_by_status_idx
  ON public.meetings (created_by, status);

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined', 'left')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS meeting_participants_user_status_idx
  ON public.meeting_participants (user_id, status);
CREATE INDEX IF NOT EXISTS meeting_participants_meeting_status_idx
  ON public.meeting_participants (meeting_id, status);

CREATE TABLE IF NOT EXISTS public.meeting_signals (
  id bigserial PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('offer', 'answer', 'ice', 'media')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_signals_receive_idx
  ON public.meeting_signals (meeting_id, receiver_id, id);
CREATE INDEX IF NOT EXISTS meeting_signals_created_at_idx
  ON public.meeting_signals (created_at);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.meetings FROM anon, authenticated;
REVOKE ALL ON public.meeting_participants FROM anon, authenticated;
REVOKE ALL ON public.meeting_signals FROM anon, authenticated;
GRANT ALL ON public.meetings TO service_role;
GRANT ALL ON public.meeting_participants TO service_role;
GRANT ALL ON public.meeting_signals TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.meeting_signals_id_seq TO service_role;
