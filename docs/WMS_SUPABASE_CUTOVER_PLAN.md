# ERP WMS: Render API to Supabase Cutover Plan

## Goal

Run the ERP's WMS module without depending on the separate Render-hosted Flask WMS API, while preserving its authentication, permissions, stock rules, and transactional behavior.

## What was verified

- The ERP WMS module currently calls the HTTP API through `src/wms/api.js`; it uses cookie credentials and CSRF protection.
- Embedded ERP sign-in calls the Render API's `/api/auth/erp-session` endpoint (`src/wms/auth.jsx` and `src/lib/wms-auto-login.ts`). This is a server-side trust boundary, not merely a database connection setting.
- The connected Supabase project already contains the WMS `public.wms_*` schema, including the WMS user-link table. The live schema reports the core WMS tables and the latest schema-migration version; many operational tables are empty.
- RLS is disabled on the existing WMS tables. The WMS app has extensive route and service behavior (auth, receiving, putaway, inventory, picking, packing, shipping, returns, transfers, audit, webhooks, tokens, integrations, and more).
- The ERP already has a server-side Supabase admin client. It must remain server-side; the service-role key must never be sent to the browser.

## Important conclusion

**Supabase already has the WMS tables, but that does not make it a replacement for the Render API.** The app must move its API and authorization behavior into trusted server-side handlers and/or carefully designed database RPCs. Direct browser access to `wms_*` tables is not an acceptable shortcut: the existing WMS authentication is not the same as Supabase Auth, RLS is currently off, and direct writes could bypass stock/business rules.

## Safe staged implementation

### Stage 0 — Preserve and secure the current state

1. Make a database backup and verify the live WMS schema/migrations against the WMS repository.
2. Verify the PostgreSQL role used by the current WMS API before enabling RLS, so the existing API is not accidentally locked out.
3. Review `supabase/wms_rls_staging_baseline.sql` in a non-production project. It enables RLS on existing `wms_*` tables and denies direct browser-role table access; it intentionally creates no permissive policies.
4. Inventory any `SECURITY DEFINER` functions and ensure they cannot provide an unintended browser bypass.

### Stage 1 — Establish the trusted ERP-side replacement boundary

1. Add same-origin server handlers in the ERP deployment that use the existing server-only Supabase admin client.
2. Validate the current ERP session, active account, WMS user link, WMS role, warehouse scope, and page/operation permission on every request.
3. Keep service-role access entirely in server code. Do not make the WMS tables directly writable from React/browser code.
4. Keep the Render API as the active backend during this stage.

### Stage 2 — Migrate and parity-test operations

Migrate endpoint behavior in dependency order, with explicit request/response compatibility and tests:

1. Read-only: warehouses, zones/bins/items, inventory lookup, settings, and dashboard reads.
2. Master data: warehouses, bins, zones, items, vendors, and users/permissions.
3. Transactional receiving and putaway.
4. Inventory adjustments and cycle counts.
5. Orders, allocation, picking, packing, shipping, refunds/returns, and transfer workflows.
6. Integrations: inbound ingestion, tokens, webhooks, connector sync, audit chain, background/cleanup jobs, and idempotency.

Critical inventory writes should be atomic database functions with row locking, validated parameters, idempotency, and audit/event writes in the same transaction. Do not recreate these rules in client-side code.

For each operation, test old/new response parity, role/warehouse access, duplicate retries, concurrent writes, rollback behavior, and audit history.

### Stage 3 — Controlled cutover

1. Add an explicit backend switch/feature flag and route only a small, low-risk operation to the new implementation.
2. Compare behavior and error rates against the existing API; expand by workflow only after tests pass.
3. Keep a rollback path to Render during validation.
4. Remove the Render URL/configuration only after all used endpoints, mobile clients, integrations, scheduled tasks, webhooks, and operational runbooks are accounted for and regression-tested.

## Current safety status

- No SQL in this plan has been applied to Supabase.
- No ERP WMS API calls have been redirected.
- No Render deployment or data has been changed.
- The included SQL is a reviewable security baseline, **not** a complete API replacement and not yet approved for production application.
