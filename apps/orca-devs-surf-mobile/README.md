# ORCA DEVS SURF — secure documents app

Expo / React Native app branded with the ERP's ORCA logo. It follows the device's light/dark appearance, uses the ORCA DEVS SURF mobile reference styles, and provides **Scan**, **History**, and **About** tabs with the **POWERED BY ORCA DEVS SURF** footer linking to `https://orca.devs.surf`.

## Run in Expo Go

Requirements: Node.js 22 and Expo Go on an Android phone.

```bash
cd apps/orca-devs-surf-mobile
npm ci
npm start
```

Open Expo Go and scan the development QR. Camera scanning and photo capture need a real phone. The endpoint field defaults to `EXPO_PUBLIC_ORCA_LOGIN_URL` if configured; otherwise enter the deployed ERP URL ending in `/api/mobile/verify`. **There is no hosted-demo credential fill button.**

## Android APK

An EAS internal APK profile is included:

```bash
cd apps/orca-devs-surf-mobile
npm run build:apk
```

This requires signing in to an Expo/EAS account when prompted. The command creates an installable **`.apk`** from EAS; Android apps do not use a Windows `.exe` file extension. The production EAS profile outputs an `.aab` for Play Store submission.

## Production ERP setup

Apply this migration after the existing Outward POD migrations:

```text
supabase/migrations/20261001134500_outward_pod_mobile_document_api.sql
```

Use the Supabase SQL editor or the repository's normal Supabase migration workflow. This migration adds POD update metadata, revokes direct client-side POD row writes, removes the old public Storage policies, and grants POD-object access only to the server `service_role`. The ERP server must already have its Supabase service-role configuration; never put that key in the mobile app. Existing POD records and file paths are retained.

Then deploy the ERP web/server build. Its routes are:

| Route                                                                        | Method | Purpose                                                              |
| ---------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `/api/mobile/verify`                                                         | `POST` | Verify an existing `app_users` ID/password; no account is created.   |
| `/api/mobile/outward-pod?operation=manifest&podId=…`                         | `GET`  | Return an existing POD's fields and role-allowed QR actions.         |
| `/api/mobile/outward-pod?operation=manifest&consignmentId=…`                 | `GET`  | Return add-only fields for a new-POD create-form QR.                 |
| `/api/mobile/outward-pod?operation=file&podId=…&kind=front\|back\|signature` | `GET`  | Authenticated file preview/download.                                 |
| `/api/mobile/outward-pod?operation=upload&podId=…&kind=…`                    | `POST` | Add to an empty image/PDF slot or replace an existing one.           |
| `/api/mobile/outward-pod?operation=metadata&podId=…`                         | `POST` | Update or clear schema-defined POD/consignment metadata fields.      |
| `/api/mobile/outward-pod?operation=create-upload&consignmentId=…&kind=…`     | `POST` | Create the POD on its first mobile file; return its normal manifest. |
| `/api/mobile/outward-pod?operation=links&podId=…`                            | `GET`  | Issue short-lived signed previews for the ERP web UI.                |
| `/api/mobile/outward-pod?operation=create`                                   | `POST` | Used by the ERP UI to create a POD record and initial files.         |

Sign in with the **same ERP user ID/password** used in the ERP. The app submits credentials over HTTPS for verification, stores them using Expo SecureStore, and sends HTTP Basic authorization over HTTPS for QR actions. The API checks that the ERP account is active, checks branch assignment for `basic` users, and rechecks each action. Failed mobile verification is rate-limited without changing the ERP's shared failed-login counter or pausing the account.

The login request uses `Authorization: Basic base64(userId:password)` and sends only `{ "action": "verify", "id": "YOUR_USER_ID" }` as JSON; the password is not duplicated in the request body.

The role/action matrix is centralized in `src/lib/outward-pod-document-access.ts`. All four existing roles (`admin`, `semi_admin`, `basic`, `viewer`) can currently view, add, and replace documents, as requested. The API enforces the rule independently of what the QR/UI displays, so later role restrictions can be added in one place. Empty fields receive **add**; fields containing a file receive **view/replace**. Each PDF/image is limited to 20 MB; allowed formats are JPEG, PNG, WEBP, HEIC, HEIF, and PDF.

The Outward POD web page shows a QR in the new-POD create form. Existing-POD view mode is QR-free by default; an explicit **Edit on mobile** action reveals a separate edit-mode QR when an authorized user requests it. The create QR asks for the delivery date and, for third-party consignments, transporter LR number/date. Its first mobile file upload creates the POD; the app then switches to the normal manifest. For existing PODs, the manifest includes server-defined metadata fields: authorized users can edit or clear mapped values and sync changes to both the POD and consignment records with their ERP credentials. Dates use a native calendar picker and are stored in ISO `YYYY-MM-DD` form (shown as `DD-MM-YYYY`).

Metadata input controls are schema-driven (`text`, `number`, `date`, and `select`). Adding more fields of these supported types can be done server-side, including the ERP field mapping and validation, without replacing the Android app. A new control type or new file action would require an app update. The web UI refreshes after mobile uploads or metadata syncs using Supabase Realtime where configured plus a 12-second fallback refresh.

Set a public endpoint URL at build time if you want the field prefilled (URL only; do not put secrets in the app build):

```bash
EXPO_PUBLIC_ORCA_LOGIN_URL=https://your-erp-domain.example/api/mobile/verify
```

## Hosted mock endpoint (test data only)

The isolated `mock-server` package is a separate demo/test service with three QR samples, sample PDF/PNG/DOCX files, and in-memory uploads. It does **not** create or authenticate ERP users. To test it manually, run `npm run mock:install`, then start it with `PORT=4200 PUBLIC_BASE_URL=https://your-public-host.example npm run mock`. Its public demo credentials are documented in `mock-server/README.md`; do not use them for real files. Demo uploads disappear when that process stops. The app never prefills those credentials. **Do not upload real or sensitive documents to the mock service.**

## Local storage and history

After successful verification, endpoint URL, ERP user ID, and password are stored using Expo SecureStore (Android Keystore-backed encryption). Sign-out removes saved credentials. Local history records action status and file names, not passwords or authorization headers. Temporary preview/download files are removed after use.

## Validation commands

```bash
npm run typecheck
npm test
npm run export:android
```

See [`EXPO_SOURCES.md`](./EXPO_SOURCES.md) for official Expo references and [`mock-server/README.md`](./mock-server/README.md) for demo fixture details.
