import type { FileKind, FileAction, QrManifest, UploadField } from "../types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function firstDefined(source: JsonRecord | undefined, keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const nested = record(value);
  if (nested) return stringValue(firstDefined(nested, ["url", "href", "value"]));
  return undefined;
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function permission(
  item: JsonRecord,
  action: "view" | "add" | "replace",
): boolean {
  const aliases: Record<typeof action, string[]> = {
    view: ["allowView", "allow_view", "viewAllowed", "view_allowed"],
    add: ["allowAdd", "allow_add", "addAllowed", "add_allowed"],
    replace: ["allowReplace", "allow_replace", "replaceAllowed", "replace_allowed"],
  };
  const direct = firstDefined(item, aliases[action]);
  if (direct !== undefined) return boolValue(direct) === true;
  for (const groupName of ["permissions", "actions", "allowed"]) {
    const group = record(item[groupName]);
    const nested = boolValue(group?.[action]);
    if (nested !== undefined) return nested;
  }
  return false;
}

function absoluteUrl(value: unknown, baseUrl?: string): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    return baseUrl ? new URL(raw, baseUrl).toString() : new URL(raw).toString();
  } catch {
    return undefined;
  }
}

function fileUrl(value: unknown, baseUrl?: string): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  // Some QR manifests use a non-URL value for an empty field.
  if (!/^(https?:\/\/|\/|\.\.?\/)/i.test(raw)) return undefined;
  return absoluteUrl(raw, baseUrl);
}

function inferMimeType(fileUrl: string | undefined, hint?: string): string {
  const normalized = (hint ?? "").toLowerCase();
  if (normalized.includes("pdf")) return "application/pdf";
  if (normalized.includes("word") || normalized === "doc" || normalized === "docx") {
    return normalized === "doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (normalized.includes("image")) return "image/*";
  const path = (fileUrl ?? "").toLowerCase().split(/[?#]/)[0];
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".doc")) return "application/msword";
  if (path.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.(png|jpe?g|gif|webp|bmp|heic)$/.test(path)) return path.endsWith(".png") ? "image/png" : "image/jpeg";
  return "application/octet-stream";
}

export function normalizeManifest(input: unknown, baseUrl?: string): QrManifest {
  const root = record(input);
  if (!root) throw new Error("The QR code must contain a JSON object or a manifest URL.");

  const rawUploads = firstDefined(root, ["uploads", "fields", "files", "documents", "items"]);
  if (!Array.isArray(rawUploads)) {
    throw new Error("The QR manifest has no uploads, fields, files, or documents list.");
  }

  const rootUploadUrl = firstDefined(root, ["uploadUrl", "upload_url"]);
  const rootAddUrl = firstDefined(root, ["addUrl", "add_url"]);
  const rootReplaceUrl = firstDefined(root, ["replaceUrl", "replace_url"]);
  const uploads: UploadField[] = rawUploads.map((rawItem, index) => {
    const item = record(rawItem);
    if (!item) throw new Error(`Upload item ${index + 1} must be an object.`);

    const id = stringValue(firstDefined(item, ["id", "key", "code", "name"])) ?? `upload-${index + 1}`;
    const label =
      stringValue(firstDefined(item, ["label", "title", "displayName", "name"])) ?? id;
    const rawValue = firstDefined(item, ["valueUrl", "value_url", "value", "fileUrl", "file_url", "currentUrl", "current_url", "url"]);
    const valueUrl = fileUrl(rawValue, baseUrl);
    const rawMime = stringValue(firstDefined(item, ["mimeType", "mime_type", "contentType", "content_type", "type"]));
    const mimeType = rawMime?.includes("/") ? rawMime : inferMimeType(valueUrl, rawMime);
    const uploadUrl = firstDefined(item, ["uploadUrl", "upload_url"]) ?? rootUploadUrl;
    const addUrl = absoluteUrl(
      firstDefined(item, ["addUrl", "add_url"]) ?? rootAddUrl ?? uploadUrl,
      baseUrl,
    );
    const replaceUrl = absoluteUrl(
      firstDefined(item, ["replaceUrl", "replace_url"]) ?? rootReplaceUrl ?? uploadUrl,
      baseUrl,
    );
    const viewUrl = fileUrl(
      firstDefined(item, ["viewUrl", "view_url", "downloadUrl", "download_url"]) ?? valueUrl,
      baseUrl,
    );

    return {
      id,
      label,
      mimeType,
      valueUrl,
      viewUrl,
      addUrl,
      replaceUrl,
      allowView: permission(item, "view"),
      allowAdd: permission(item, "add"),
      allowReplace: permission(item, "replace"),
    };
  });

  const recordId =
    stringValue(firstDefined(root, ["recordId", "record_id", "reference", "id"])) ??
    new Date().toISOString();
  const title =
    stringValue(firstDefined(root, ["title", "name", "recordName", "record_name"])) ??
    `Record ${recordId}`;

  return { recordId, title, uploads, scannedAt: new Date().toISOString() };
}

export function parseJsonQr(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function qrManifestUrl(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    try {
      const url = new URL(payload.trim());
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }
  const root = record(payload);
  if (!root) return undefined;
  return absoluteUrl(firstDefined(root, ["manifestUrl", "manifest_url", "endpointUrl", "endpoint_url", "manifest"]));
}

export function fileKind(mimeType: string, fileUrlOrName?: string): FileKind {
  const mime = mimeType.toLowerCase();
  const value = (fileUrlOrName ?? "").toLowerCase().split(/[?#]/)[0];
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|tiff?)$/.test(value)) return "image";
  if (mime === "application/pdf" || value.endsWith(".pdf")) return "pdf";
  if (
    mime.includes("wordprocessingml") ||
    mime === "application/msword" ||
    /\.(docx?|dotx?)$/.test(value)
  ) return "word";
  return "other";
}

export function displayFileType(field: UploadField): string {
  const kind = fileKind(field.mimeType, field.valueUrl);
  if (kind === "image") return "IMAGE";
  if (kind === "pdf") return "PDF";
  if (kind === "word") return "WORD";
  const subtype = field.mimeType.split("/")[1];
  return subtype ? subtype.toUpperCase().slice(0, 12) : "FILE";
}

export function actionUrl(field: UploadField, action: FileAction): string | undefined {
  return action === "add" ? (field.allowAdd ? field.addUrl : undefined) : field.allowReplace ? field.replaceUrl : undefined;
}
