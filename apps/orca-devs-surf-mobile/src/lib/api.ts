import { fromByteArray } from "base64-js";
import * as FileSystem from "expo-file-system/legacy";
import type { Credentials, FileAction, PickedFile, QrManifest } from "../types";

export interface UploadedFileResponse {
  url?: string;
  fileUrl?: string;
  value?: string;
  message?: string;
  manifest?: unknown;
}

function utf8Bytes(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; ) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 3;
    } else {
      bytes.push(encoded.charCodeAt(index));
      index += 1;
    }
  }
  return Uint8Array.from(bytes);
}

export function basicAuthorization(credentials: Credentials): string {
  return `Basic ${fromByteArray(utf8Bytes(`${credentials.userId}:${credentials.password}`))}`;
}

export function validateHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Enter a complete endpoint URL beginning with https://.");
  }
  if (parsed.protocol !== "https:")
    throw new Error("HTTPS is required for every endpoint, QR manifest, and file URL.");
  if (parsed.username || parsed.password)
    throw new Error("Do not put credentials in a URL. Enter them in the ID and password fields.");
  if (!parsed.hostname) throw new Error("The URL must include a server host.");
  parsed.hash = "";
  return parsed.toString();
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

function authHeaders(credentials: Credentials): Record<string, string> {
  return {
    Authorization: basicAuthorization(credentials),
    Accept: "application/json, application/pdf, image/*, application/octet-stream, */*",
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function explicitRejection(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const data = body as Record<string, unknown>;
  if (
    data.valid === false ||
    data.ok === false ||
    data.exists === false ||
    data.authenticated === false
  ) {
    return typeof data.message === "string"
      ? data.message
      : "The endpoint rejected this ID and password.";
  }
  return undefined;
}

export async function verifyCredentials(credentials: Credentials): Promise<void> {
  const endpointUrl = validateHttpUrl(credentials.endpointUrl);
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: { ...authHeaders(credentials), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", id: credentials.userId }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Sign-in failed (${response.status}). Check the endpoint, ID, and password.`);
  }
  const rejected = explicitRejection(body);
  if (rejected) throw new Error(rejected);
}

export async function fetchManifest(url: string, credentials: Credentials): Promise<unknown> {
  const safeUrl = validateHttpUrl(url);
  const response = await fetch(safeUrl, { method: "GET", headers: authHeaders(credentials) });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`Could not load the QR manifest (${response.status}).`);
  const rejected = explicitRejection(body);
  if (rejected) throw new Error(rejected);
  if (!body || typeof body !== "object")
    throw new Error("The manifest endpoint did not return JSON.");
  return body;
}

export async function uploadFile(
  url: string,
  credentials: Credentials,
  manifest: QrManifest,
  uploadId: string,
  action: FileAction,
  file: PickedFile,
  metadataValues?: Record<string, string>,
): Promise<UploadedFileResponse> {
  const safeUrl = validateHttpUrl(url);
  const parameters: Record<string, string> = {
    action,
    recordId: manifest.recordId,
    uploadId,
    id: credentials.userId,
  };
  if (metadataValues) {
    for (const [fieldId, value] of Object.entries(metadataValues)) {
      parameters[fieldId] = value;
    }
  }

  const response = await FileSystem.uploadAsync(safeUrl, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType,
    headers: authHeaders(credentials),
    parameters,
  });
  let result: unknown;
  try {
    result = JSON.parse(response.body) as unknown;
  } catch {
    result = response.body;
  }
  if (response.status < 200 || response.status >= 300) {
    const serverMessage =
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      typeof (result as Record<string, unknown>).message === "string"
        ? ((result as Record<string, unknown>).message as string)
        : undefined;
    throw new Error(serverMessage ?? `Upload failed (${response.status}).`);
  }
  const rejected = explicitRejection(result);
  if (rejected) throw new Error(rejected);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as UploadedFileResponse;
  }
  return {};
}

export async function syncMetadata(
  url: string,
  credentials: Credentials,
  recordId: string,
  fields: Record<string, string>,
): Promise<UploadedFileResponse> {
  const safeUrl = validateHttpUrl(url);
  const response = await fetch(safeUrl, {
    method: "POST",
    headers: { ...authHeaders(credentials), "Content-Type": "application/json" },
    body: JSON.stringify({ recordId, fields }),
  });
  const result = await responseJson(response);
  if (!response.ok) {
    const serverMessage =
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      typeof (result as Record<string, unknown>).message === "string"
        ? ((result as Record<string, unknown>).message as string)
        : undefined;
    throw new Error(serverMessage ?? `POD detail sync failed (${response.status}).`);
  }
  const rejected = explicitRejection(result);
  if (rejected) throw new Error(rejected);
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as UploadedFileResponse)
    : {};
}

export async function downloadForPreview(
  url: string,
  credentials: Credentials,
  preferredName: string,
): Promise<{ uri: string; status: number }> {
  const safeUrl = validateHttpUrl(url);
  if (!FileSystem.cacheDirectory) throw new Error("The local preview cache is unavailable.");
  const safeName = preferredName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "document";
  const destination = `${FileSystem.cacheDirectory}orca-${Date.now()}-${safeName}`;
  const result = await FileSystem.downloadAsync(safeUrl, destination, {
    headers: authHeaders(credentials),
  });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new Error(`Could not download the file (${result.status}).`);
  }
  return { uri: result.uri, status: result.status };
}
