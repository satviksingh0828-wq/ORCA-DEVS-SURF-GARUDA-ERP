# ORCA DEVS SURF — secure documents app

An Expo / React Native mobile app branded with the existing ORCA dot logo. The app has **Scan**, **History**, and **About** tabs, a matching dark splash screen, and a persistent **POWERED BY ORCA DEVS SURF** footer linking to `https://orca.devs.surf`.

## Run in Expo Go

Requirements: Node.js 22 and the Expo Go app on an Android phone.

```bash
cd apps/orca-devs-surf-mobile
npm ci
npm start
```

Open Expo Go on the phone and scan the development QR shown by Expo. Camera scanning and photo capture need a real phone; camera functions are not available in the standard Android emulator in the same way as a device.

The source is Expo SDK 57. The app shows its own branded splash when it starts in Expo Go. The configured native launcher icon and native splash are applied to an APK build.

## Build an Android APK

An APK profile is included in `eas.json`:

```bash
cd apps/orca-devs-surf-mobile
npm run build:apk
```

This runs an EAS internal-distribution build with `android.buildType: "apk"`. Sign in to an Expo account if prompted, then use the build URL printed by EAS to download and install the APK. Alternatively, generate Android native files with `npx expo prebuild --platform android` and build an APK with Android Studio / Gradle. An APK is the Android installer; it is not a Windows `.exe`.

## Important backend requirement

**The ERP repository did not contain a generic mobile login-verification or QR document-upload API.** This app therefore uses the HTTP/QR contract below. The endpoint you enter and the URLs encoded by the QR must implement this contract, or the API adapter must be adjusted to your actual server routes. The app does not create a backend endpoint or user account for you.

### Login verification

Enter the full HTTPS verification URL plus the user ID and password. On sign-in the app sends:

```http
POST https://your-server.example/api/mobile/verify
Authorization: Basic <base64(userId:password)>
Content-Type: application/json
Accept: application/json, ...
```

```json
{"action":"verify","id":"YOUR_USER_ID","password":"YOUR_PASSWORD"}
```

Return a successful 2xx response only for a valid account; return 401/403 for an invalid ID/password. A JSON response with `valid`, `ok`, `exists`, or `authenticated` set to `false` is also treated as rejection. The app saves credentials only after verification succeeds.

### QR payload

A QR can either contain a JSON manifest or an HTTPS URL that returns the manifest JSON. Example:

```json
{
  "schema": "orca.document.v1",
  "recordId": "TRIP-42",
  "title": "Trip documents",
  "uploads": [
    {
      "id": "invoice",
      "label": "Invoice",
      "mimeType": "application/pdf",
      "value": "https://documents.example.com/files/TRIP-42/invoice.pdf",
      "viewUrl": "https://documents.example.com/files/TRIP-42/invoice.pdf",
      "allowView": true,
      "allowAdd": true,
      "addUrl": "https://documents.example.com/api/TRIP-42/invoice",
      "allowReplace": true,
      "replaceUrl": "https://documents.example.com/api/TRIP-42/invoice/replace"
    }
  ]
}
```

The app also accepts common aliases (`fields`, `files`, `documents`, `valueUrl`, `fileUrl`, `viewAllowed`, and `permissions: { view, add, replace }`). Permissions default to **false**. A file action appears only when its QR permission is true **and** its corresponding URL is present. For add/replace, a shared `uploadUrl` may be used in place of the specific action URL. Current values can be image, PDF, or Word-file URLs.

### Document requests

- **View:** `GET` the QR's `viewUrl` (or current file `value`) with the same `Authorization: Basic ...` header. The endpoint returns the file bytes. Images open in the app preview. PDF and Word files are downloaded to the temporary app cache and opened through Android's compatible-app chooser.
- **Add / replace:** `POST` multipart form data to the specific action URL (or `uploadUrl`) with the same Basic Auth header. Form fields are `file`, `action` (`add` or `replace`), `recordId`, `uploadId`, and `id`. The server should return a 2xx response and may return JSON such as `{"url":"https://.../new-file.pdf","message":"Uploaded"}`.
- The app does not put credentials in URLs. HTTPS is enforced for endpoint, manifest, view, and upload links. If the QR points to a different host from the login endpoint, the app asks before sending credentials there; approval lasts only until the app session ends.

## Local storage and history

The verified endpoint, user ID, and password are stored using Expo SecureStore (Android Keystore-backed encryption). Sign out removes saved credentials. History is stored on-device and records scan/view/add/replace status without storing passwords or authorization headers. The upload size limit is 50 MB.

## Validation

```bash
npm run typecheck
npm test
npm run export:android
```

For Expo module compatibility notes and official documentation links, see [`EXPO_SOURCES.md`](./EXPO_SOURCES.md).
