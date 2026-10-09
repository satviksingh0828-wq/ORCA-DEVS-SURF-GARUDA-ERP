# ERP WMS: Render API to Supabase Cutover

## Target

Run the ERP-embedded WMS module against the existing Supabase project, without the separate Render Flask API, while preserving sign-in, permissions, warehouse scope, stock rules, audit behavior, and transactional integrity.

## Verified current state

- The connected Supabase project already contains the WMS `public.wms_*` schema and the ERP↔WMS user-link table.
- The Flask WMS API exposes **211 route handlers across 32 route files**. Its behavior includes authentication, warehouse scoping, permissions, receiving, putaway, inventory, cycle counts, picking, packing, shipping, refunds/returns, transfers, audit, idempotency, tokens, webhooks, connectors, and background work.
- The ERP's existing username/password authentication is handled in its server-side login flow. The WMS user records store bcrypt password hashes. The browser must not read credential hashes or receive a service-role key.
- Existing WMS tables have RLS disabled. Direct anonymous table access would not preserve the current WMS authorization boundary.

## Implemented and applied

- Added `public.wms_validate_erp_session(text)` in Supabase. It checks the token's expiry, exact active-token match in `user_sessions`, active/unpaused ERP user, current ERP role, active ERP↔WMS link, and active WMS user. It returns only the non-secret WMS profile; it does not return password hashes.
- The function is `SECURITY DEFINER`, owned by the Supabase `postgres` role, and executable by `anon`/`authenticated` only through its guarded validation logic. A fake-token call was tested and returned `{"ok":false,"error":"invalid_session"}`. The function is not executable by `PUBLIC`.
- Embedded WMS bootstrap/refresh/logout now uses this Supabase RPC rather than exchanging an ERP session for a Render WMS cookie.

## Still not cut over

- WMS operational requests in `src/wms/api.js` still use the existing HTTP API path for the rest of the endpoints.
- The Render base URL cannot yet be removed: order/receiving/picking/adjustment/warehouse workflows need their own direct Supabase queries or guarded atomic RPC functions first.
- The included `wms_rls_staging_baseline.sql` remains **unapplied**. It would enable RLS without permissive browser policies; applying it before moving all operations would intentionally deny direct browser access and may disrupt existing clients.
- No Render deployment was disabled and no WMS data was changed.

## Required continuation

1. Port read-only WMS queries and admin/master-data CRUD to direct Supabase access guarded by validated ERP/WMS identity and warehouse/page permissions.
2. Implement transactional SQL RPCs for receiving, putaway, stock adjustment/count, pick/pack/ship, returns/refunds, and transfers. Preserve locking, idempotency, audit-chain writes, and event/outbox behavior.
3. Migrate external connectors, webhooks, scheduled cleanup, and mobile-facing routes or document which of those remain outside the ERP module.
4. Add request/response parity tests for each migrated route family; test RLS, role/warehouse boundaries, duplicates, concurrent stock updates, and rollback.
5. Only after all required routes pass, remove `VITE_WMS_API_URL`, switch the ERP WMS API adapter to direct Supabase, and retire Render.

## Validation performed

- `npm test`: **44 passed, 0 failed**.
- `npm run build`: **passed** after installing locked dependencies.
- Supabase invalid-session RPC check: **passed**.
