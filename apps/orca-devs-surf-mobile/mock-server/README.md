# ORCA Documents mock endpoint

This separate Node service provides test credentials, three authenticated QR manifests, sample PDF/image/DOCX previews, and temporary in-memory uploads for the Expo Go app.

## Start locally

```bash
cd apps/orca-devs-surf-mobile/mock-server
npm install
PORT=4200 PUBLIC_BASE_URL=https://your-public-host.example npm start
```

`PUBLIC_BASE_URL` must be the HTTPS URL that a phone can reach. If omitted, the server uses forwarded-host/proto headers or `http://localhost:<port>` for the landing page. The mobile app itself requires HTTPS for sign-in and QR requests.

## Demo account

- Login endpoint: `<PUBLIC_BASE_URL>/api/mobile/verify`
- User ID: `demo`
- Password: `orca-demo-2026`

The landing page (`/`) displays the complete login endpoint and three QR codes. Scanning any code fetches its manifest from the same server origin, using the authenticated mobile request.

## QR records

| QR image                   | Sample record                         | Current file                | Allowed actions     |
| -------------------------- | ------------------------------------- | --------------------------- | ------------------- |
| `/qr/01-invoice.png`       | `DEMO-TRIP-0042` vendor invoice       | Sample PDF                  | View and replace    |
| `/qr/02-id-photo.png`      | `DEMO-EMP-0007` ID photo + attachment | Sample PNG + empty PDF slot | View image; add PDF |
| `/qr/03-word-document.png` | `DEMO-PO-0108` supporting letter      | Sample DOCX                 | View only           |

Manifest routes are `/api/mock/qr/01-invoice`, `/api/mock/qr/02-id-photo`, and `/api/mock/qr/03-word-document`.

## API behavior

- `POST /api/mobile/verify`: checks HTTP Basic auth and the JSON `{ "action": "verify", "id": "demo" }` payload. The password is sent only in the Authorization header.
- `GET /api/mock/qr/:qrId`: returns `schema: orca.document.v1`, file value/view URLs, add/replace URLs, and boolean permissions.
- `GET /api/mock/files/:fileId/:filename`: serves one sample or uploaded file with authenticated access.
- `POST /api/mock/uploads`: accepts the app's authenticated multipart request. It checks record, upload field, account ID, and QR action permission before storing a file in memory.
- `GET /api/mock/state`: returns non-secret demo record state and upload count.
- `GET /health`: simple health status.

This is an intentionally public demo: its sample account is not confidential, uploads are held in process memory, and the data disappears when the server stops. It is not a production document-storage service.
