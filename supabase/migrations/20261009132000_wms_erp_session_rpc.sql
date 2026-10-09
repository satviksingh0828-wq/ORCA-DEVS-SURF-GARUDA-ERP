-- WMS direct-Supabase session bootstrap.
-- Validates the exact active ERP session token stored by ERP sign-in, resolves
-- its existing ERP↔WMS user link, and returns only the non-secret WMS profile.
-- No password hashes, password values, or service-role credentials are exposed.

BEGIN;

CREATE OR REPLACE FUNCTION public.wms_validate_erp_session(p_erp_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_expires_ms bigint;
  v_user jsonb;
BEGIN
  IF p_erp_session_token IS NULL OR length(p_erp_session_token) < 20 OR length(p_erp_session_token) > 2048 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  BEGIN
    v_uid := split_part(p_erp_session_token, ':', 1)::uuid;
    v_role := split_part(p_erp_session_token, ':', 2);
    v_expires_ms := split_part(p_erp_session_token, ':', 3)::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END;

  IF v_role = '' OR v_expires_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  -- Equality with the currently persisted token is the server-issued-session
  -- check. Role and account state are also checked against the live ERP row.
  SELECT jsonb_build_object(
    'user_id', wu.user_id,
    'username', wu.username,
    'full_name', wu.full_name,
    'role', wu.role,
    'warehouse_id', wu.warehouse_id,
    'warehouse_ids', COALESCE(to_jsonb(wu.warehouse_ids), '[]'::jsonb),
    'allowed_functions', COALESCE(to_jsonb(wu.allowed_functions), '[]'::jsonb),
    'is_active', wu.is_active,
    'must_change_password', wu.must_change_password
  )
  INTO v_user
  FROM public.user_sessions AS us
  JOIN public.app_users AS eu
    ON eu.id = us.user_id
  JOIN public.wms_erp_user_links AS link
    ON link.erp_user_id = eu.id
  JOIN public.wms_users AS wu
    ON wu.user_id = link.wms_user_id
  WHERE us.user_id = v_uid
    AND us.session_token = p_erp_session_token
    AND eu.role = v_role
    AND eu.is_active IS TRUE
    AND COALESCE(eu.is_paused, false) IS FALSE
    AND wu.is_active IS TRUE
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_unlinked_session');
  END IF;

  RETURN jsonb_build_object('ok', true, 'user', v_user);
END;
$function$;

REVOKE ALL ON FUNCTION public.wms_validate_erp_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wms_validate_erp_session(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.wms_validate_erp_session(text) IS
  'Validates the current persisted ERP session and WMS user link for direct Supabase WMS bootstrap; returns no credentials or password hashes.';

COMMIT;
