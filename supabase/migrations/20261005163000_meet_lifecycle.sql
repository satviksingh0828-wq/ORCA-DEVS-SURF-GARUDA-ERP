-- Make participant join/leave atomic with meeting-row locking. Deleting the
-- parent meeting cascades its invitations and transient WebRTC signaling rows.
ALTER TABLE public.meeting_participants
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.meet_join_participant(
  p_meeting_id uuid,
  p_user_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_joined_at timestamptz := clock_timestamp();
BEGIN
  SELECT m.status INTO v_status
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'live' THEN
    RAISE EXCEPTION 'Meeting not found or no longer live';
  END IF;

  UPDATE public.meeting_participants
  SET status = 'joined', joined_at = v_joined_at, left_at = NULL, last_seen_at = v_joined_at
  WHERE meeting_id = p_meeting_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not invited to this meeting';
  END IF;

  RETURN v_joined_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.meet_touch_participant(
  p_meeting_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT m.status INTO v_status
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;

  IF NOT FOUND OR v_status NOT IN ('live', 'ended') THEN
    RETURN false;
  END IF;

  UPDATE public.meeting_participants
  SET last_seen_at = clock_timestamp()
  WHERE meeting_id = p_meeting_id AND user_id = p_user_id AND status = 'joined';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.meet_leave_and_delete_if_empty(
  p_meeting_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meeting_id uuid;
BEGIN
  SELECT m.id INTO v_meeting_id
  FROM public.meetings AS m
  WHERE m.id = p_meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  UPDATE public.meeting_participants
  SET status = 'left', left_at = clock_timestamp()
  WHERE meeting_id = p_meeting_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not a participant in this meeting';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_participants AS p
    WHERE p.meeting_id = p_meeting_id AND p.status = 'joined'
  ) THEN
    DELETE FROM public.meetings WHERE id = p_meeting_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Clean up rooms abandoned by a tab/browser that disappeared without leaving.
-- The age guard avoids racing the two-step meeting creation insert.
CREATE OR REPLACE FUNCTION public.meet_cleanup_abandoned_empty_live()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate record;
  deleted_count integer := 0;
BEGIN
  FOR candidate IN
    SELECT m.id
    FROM public.meetings AS m
    WHERE m.status IN ('live', 'ended')
      AND m.created_at < clock_timestamp() - interval '2 minutes'
    ORDER BY m.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.meeting_participants
    SET status = 'left', left_at = clock_timestamp()
    WHERE meeting_id = candidate.id
      AND status = 'joined'
      AND COALESCE(last_seen_at, joined_at, created_at)
        < clock_timestamp() - interval '2 minutes';

    IF NOT EXISTS (
      SELECT 1 FROM public.meeting_participants AS p
      WHERE p.meeting_id = candidate.id AND p.status = 'joined'
    ) THEN
      DELETE FROM public.meetings WHERE id = candidate.id;
      deleted_count := deleted_count + 1;
    END IF;
  END LOOP;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.meet_join_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meet_touch_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meet_leave_and_delete_if_empty(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meet_cleanup_abandoned_empty_live() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meet_join_participant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.meet_touch_participant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.meet_leave_and_delete_if_empty(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.meet_cleanup_abandoned_empty_live() TO service_role;
