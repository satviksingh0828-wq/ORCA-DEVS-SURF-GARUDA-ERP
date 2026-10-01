import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  canManageOutwardPODDocument,
  outwardPODDocumentActions,
} from "@/lib/outward-pod-document-access";
import { verifyAppToken } from "@/lib/user-auth";

const BUCKET = "outward-pod-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DOCUMENT_COLUMNS = {
  front: "front_copy_path",
  back: "back_copy_path",
  signature: "signature_copy_path",
} as const;
type DocumentKind = keyof typeof DOCUMENT_COLUMNS;
type RequestAction = "view" | "add" | "replace";
type Actor = { userId: string; username: string; role: string; authType: "basic" | "bearer" };
type BasicCredentials = { username: string; password: string };
type PodRecord = {
  id: string;
  consignment_id: string;
  delivery_date: string;
  transporter_lr_number: string | null;
  transporter_lr_date: string | null;
  front_copy_path: string | null;
  back_copy_path: string | null;
  signature_copy_path: string | null;
};
type ConsignmentRecord = {
  id: string;
  consignment_number: string;
  branch_id: string;
  consignment_type: string;
};

// The generated Supabase client types predate outward_pods and the custom user tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any; storage: any };

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: responseHeaders });
}

function jsonError(message: string, status: number) {
  return json({ ok: false, valid: false, message }, status);
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 100);
}

const requestWindows = new Map<string, { startedAt: number; count: number }>();
function rateLimited(request: Request, scope: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    requestWindows.set(key, { startedAt: now, count: 1 });
  } else if (current.count >= limit) {
    return true;
  } else {
    current.count += 1;
  }
  if (requestWindows.size > 10_000) {
    for (const [oldKey, value] of requestWindows) {
      if (now - value.startedAt > windowMs * 2) requestWindows.delete(oldKey);
    }
  }
  return false;
}

function decodeBasicAuthorization(header: string | null): BasicCredentials | null {
  if (!header?.startsWith("Basic ") || header.length > 8192) return null;
  const encoded = header.slice(6).trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  const username = decoded.slice(0, separator).trim().toLowerCase();
  const password = decoded.slice(separator + 1);
  if (!username || !password) return null;
  return { username, password };
}

function passwordsMatch(actual: string, expected: string) {
  const actualHash = createHash("sha256").update(actual, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function getAdmin(): Promise<AdminClient> {
  const module = await import("@/integrations/supabase/client.server");
  return module.supabaseAdmin as unknown as AdminClient;
}

function invalidCredentials() {
  return new ApiError(401, "Invalid login ID or password, or account unavailable.");
}

async function findBasicUser(admin: AdminClient, credentials: BasicCredentials) {
  const { data: user, error } = await admin
    .from("app_users")
    .select("id,username,full_name,role,password,is_active,is_paused")
    .eq("username", credentials.username)
    .maybeSingle();
  if (error) throw new ApiError(503, "The account service is temporarily unavailable.");

  const usable = Boolean(user && user.is_active === true && user.is_paused !== true);
  const matched =
    usable &&
    typeof user.password === "string" &&
    passwordsMatch(credentials.password, user.password);
  if (!matched) throw invalidCredentials();

  return {
    userId: String(user.id),
    username: String(user.username),
    role: String(user.role),
  };
}

async function authenticateBearer(admin: AdminClient, header: string | null): Promise<Actor> {
  if (!header?.startsWith("Bearer ")) throw invalidCredentials();
  const token = header.slice(7).trim();
  const parsed = await verifyAppToken(token);
  if (!parsed) throw invalidCredentials();

  const { data: user, error } = await admin
    .from("app_users")
    .select("id,username,role,is_active,is_paused")
    .eq("id", parsed.uid)
    .maybeSingle();
  if (error) throw new ApiError(503, "The account service is temporarily unavailable.");
  if (!user || user.is_active !== true || user.is_paused === true || user.role !== parsed.role) {
    throw invalidCredentials();
  }

  const { data: activeSession, error: sessionError } = await admin
    .from("user_sessions")
    .select("session_token")
    .eq("user_id", String(user.id))
    .maybeSingle();
  if (sessionError) throw new ApiError(503, "The session service is temporarily unavailable.");
  if (activeSession && activeSession.session_token !== token) throw invalidCredentials();

  return {
    userId: String(user.id),
    username: String(user.username),
    role: String(user.role),
    authType: "bearer",
  };
}

async function authenticateRequest(request: Request, admin: AdminClient): Promise<Actor> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return authenticateBearer(admin, header);
  const credentials = decodeBasicAuthorization(header);
  if (!credentials) throw invalidCredentials();
  const user = await findBasicUser(admin, credentials);
  return { ...user, authType: "basic" };
}

function isDocumentKind(value: string | null): value is DocumentKind {
  return value === "front" || value === "back" || value === "signature";
}

function getPath(pod: PodRecord, kind: DocumentKind): string | null {
  return pod[DOCUMENT_COLUMNS[kind]] ?? null;
}

function mimeFromPath(path: string | null, fallback = "application/pdf") {
  const normalized = (path ?? "").toLowerCase().split(/[?#]/)[0];
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".heic")) return "image/heic";
  if (normalized.endsWith(".heif")) return "image/heif";
  if (/\.(jpe?g)$/.test(normalized)) return "image/jpeg";
  return fallback;
}

function nameFromPath(path: string | null, kind: DocumentKind) {
  if (!path) return `${kind}-copy`;
  const basename = path.split("/").pop() ?? `${kind}-copy`;
  const separator = basename.indexOf("--");
  if (separator >= 0) return basename.slice(separator + 2);
  return basename.replace(/^[0-9a-f]{8}-[0-9a-f-]{27}-/i, "") || basename;
}

function operationUrl(request: Request, operation: string, podId: string, kind?: DocumentKind) {
  const url = new URL("/api/mobile/outward-pod", new URL(request.url).origin);
  url.searchParams.set("operation", operation);
  url.searchParams.set("podId", podId);
  if (kind) url.searchParams.set("kind", kind);
  return url.toString();
}

function createUploadUrl(request: Request, consignmentId: string, kind: DocumentKind) {
  const url = new URL("/api/mobile/outward-pod", new URL(request.url).origin);
  url.searchParams.set("operation", "create-upload");
  url.searchParams.set("consignmentId", consignmentId);
  url.searchParams.set("kind", kind);
  return url.toString();
}

async function loadPodAndConsignment(admin: AdminClient, podId: string) {
  const { data: pod, error: podError } = await admin
    .from("outward_pods")
    .select(
      "id,consignment_id,delivery_date,transporter_lr_number,transporter_lr_date,front_copy_path,back_copy_path,signature_copy_path",
    )
    .eq("id", podId)
    .maybeSingle();
  if (podError) throw new ApiError(503, "The POD service is temporarily unavailable.");
  if (!pod) throw new ApiError(404, "Outward POD not found.");

  const { data: consignment, error: consignmentError } = await admin
    .from("consignments")
    .select("id,consignment_number,branch_id,consignment_type")
    .eq("id", pod.consignment_id)
    .maybeSingle();
  if (consignmentError) throw new ApiError(503, "The POD service is temporarily unavailable.");
  if (!consignment) throw new ApiError(404, "Consignment not found.");
  return { pod: pod as PodRecord, consignment: consignment as ConsignmentRecord };
}

async function ensureBranchAccess(admin: AdminClient, actor: Actor, branchId: string) {
  if (actor.role !== "basic") return;
  const { data, error } = await admin
    .from("user_branch_access")
    .select("branch_id")
    .eq("user_id", actor.userId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (error) throw new ApiError(503, "The branch access service is temporarily unavailable.");
  if (!data) throw new ApiError(403, "This account is not assigned to the POD branch.");
}

async function authorizePodAction(
  admin: AdminClient,
  actor: Actor,
  podId: string,
  action: RequestAction,
) {
  if (!canManageOutwardPODDocument(actor.role, action)) {
    throw new ApiError(403, "This account type is not permitted to perform this document action.");
  }
  const record = await loadPodAndConsignment(admin, podId);
  await ensureBranchAccess(admin, actor, record.consignment.branch_id);
  return record;
}

async function authorizePodManifest(admin: AdminClient, actor: Actor, podId: string) {
  const canUseManifest = (["view", "add", "replace"] as const).some((action) =>
    canManageOutwardPODDocument(actor.role, action),
  );
  if (!canUseManifest) {
    throw new ApiError(403, "This account type is not permitted to manage POD documents.");
  }
  const record = await loadPodAndConsignment(admin, podId);
  await ensureBranchAccess(admin, actor, record.consignment.branch_id);
  return record;
}

function manifestFor(
  request: Request,
  actor: Actor,
  pod: PodRecord,
  consignment: ConsignmentRecord,
) {
  const uploads = (Object.keys(DOCUMENT_COLUMNS) as DocumentKind[]).map((kind) => {
    const path = getPath(pod, kind);
    const permissions = outwardPODDocumentActions(actor.role, Boolean(path));
    const name = nameFromPath(path, kind);
    const fileUrl =
      path && permissions.allowView ? operationUrl(request, "file", pod.id, kind) : undefined;
    const urlWithName = fileUrl ? `${fileUrl}&filename=${encodeURIComponent(name)}` : undefined;
    return {
      id: kind,
      label: kind === "front" ? "Front Copy" : kind === "back" ? "Back Copy" : "Signature Copy",
      mimeType: path && permissions.allowView ? mimeFromPath(path) : "application/octet-stream",
      hasValue: Boolean(path),
      ...(urlWithName ? { valueUrl: urlWithName, viewUrl: urlWithName } : {}),
      ...(permissions.allowAdd ? { addUrl: operationUrl(request, "upload", pod.id, kind) } : {}),
      ...(permissions.allowReplace
        ? { replaceUrl: operationUrl(request, "upload", pod.id, kind) }
        : {}),
      allowView: permissions.allowView,
      allowAdd: permissions.allowAdd,
      allowReplace: permissions.allowReplace,
      fileName: path && permissions.allowView ? name : undefined,
    };
  });
  return {
    schema: "orca.document.v1",
    recordId: pod.id,
    title: `Outward POD · ${consignment.consignment_number}`,
    uploads,
  };
}

async function manifestRequest(request: Request, admin: AdminClient, actor: Actor, podId: string) {
  const { pod, consignment } = await authorizePodManifest(admin, actor, podId);
  return json(manifestFor(request, actor, pod, consignment));
}

async function creationManifestRequest(
  request: Request,
  admin: AdminClient,
  actor: Actor,
  consignmentId: string,
) {
  const { data: consignment, error } = await admin
    .from("consignments")
    .select("id,consignment_number,branch_id,consignment_type")
    .eq("id", consignmentId)
    .maybeSingle();
  if (error) throw new ApiError(503, "The consignment service is temporarily unavailable.");
  if (!consignment) throw new ApiError(404, "Consignment not found.");
  await ensureBranchAccess(admin, actor, String(consignment.branch_id));

  const { data: existing, error: podError } = await admin
    .from("outward_pods")
    .select("id")
    .eq("consignment_id", consignmentId)
    .maybeSingle();
  if (podError) throw new ApiError(503, "The POD service is temporarily unavailable.");
  if (existing) return manifestRequest(request, admin, actor, String(existing.id));
  if (!canManageOutwardPODDocument(actor.role, "add")) {
    throw new ApiError(403, "This account type is not permitted to create POD documents.");
  }

  const uploads = (Object.keys(DOCUMENT_COLUMNS) as DocumentKind[]).map((kind) => ({
    id: kind,
    label: kind === "front" ? "Front Copy" : kind === "back" ? "Back Copy" : "Signature Copy",
    mimeType: "application/octet-stream",
    hasValue: false,
    addUrl: createUploadUrl(request, consignmentId, kind),
    allowView: false,
    allowAdd: true,
    allowReplace: false,
  }));
  return json({
    schema: "orca.document.v1",
    recordId: consignmentId,
    title: `Create Outward POD · ${consignment.consignment_number}`,
    creation: {
      deliveryDateRequired: true,
      transporterLrRequired: consignment.consignment_type === "third_party",
    },
    uploads,
  });
}

async function fileLinksRequest(admin: AdminClient, actor: Actor, podId: string) {
  if (actor.authType !== "bearer") throw new ApiError(401, "Web preview requires an ERP session.");
  const { pod } = await authorizePodAction(admin, actor, podId, "view");
  const urls: Partial<Record<DocumentKind, string>> = {};
  await Promise.all(
    (Object.keys(DOCUMENT_COLUMNS) as DocumentKind[]).map(async (kind) => {
      const path = getPath(pod, kind);
      if (!path) return;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
      if (error || !data?.signedUrl)
        throw new ApiError(503, "Could not prepare a secure POD preview.");
      urls[kind] = data.signedUrl;
    }),
  );
  return json({ ok: true, urls });
}

async function fileRequest(
  request: Request,
  admin: AdminClient,
  actor: Actor,
  podId: string,
  kind: DocumentKind,
) {
  const { pod } = await authorizePodAction(admin, actor, podId, "view");
  const path = getPath(pod, kind);
  if (!path) throw new ApiError(404, "No file is attached to this POD field.");
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new ApiError(404, "POD document could not be found.");
  const mimeType = mimeFromPath(path, data.type || "application/octet-stream");
  const filename = nameFromPath(path, kind).replace(/[\r\n"\\]/g, "_");
  return new Response(data, {
    status: 200,
    headers: {
      ...responseHeaders,
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fileMime(file: File): string {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (mime === "image/jpeg" || mime === "image/jpg" || /\.(jpe?g)$/.test(name)) return "image/jpeg";
  if (mime === "image/png" || name.endsWith(".png")) return "image/png";
  if (mime === "image/webp" || name.endsWith(".webp")) return "image/webp";
  if (mime === "image/heic" || name.endsWith(".heic")) return "image/heic";
  if (mime === "image/heif" || name.endsWith(".heif")) return "image/heif";
  throw new ApiError(415, "Only PDF, JPEG, PNG, WEBP, HEIC, or HEIF documents are allowed.");
}

function getFormFile(form: FormData, key: string): File | null {
  const value = form.get(key);
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<File>;
  return typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
    ? (value as File)
    : null;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateFile(file: File | null): asserts file is File {
  if (!file || file.size <= 0) throw new ApiError(400, "Choose a non-empty image or PDF file.");
  if (file.size > MAX_FILE_BYTES)
    throw new ApiError(413, "Each POD document must be 20 MB or smaller.");
  fileMime(file);
}

function storageName(name: string) {
  const basename = name.replace(/\\/g, "/").split("/").pop() ?? "document";
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "document";
}

async function storeFile(admin: AdminClient, podId: string, kind: DocumentKind, file: File) {
  const contentType = fileMime(file);
  const path = `${podId}/${kind}/${randomUUID()}--${storageName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error)
    throw new ApiError(503, "The document could not be stored. Check the POD storage migration.");
  return { path, contentType };
}

async function removeStoredFiles(admin: AdminClient, paths: string[]) {
  if (!paths.length) return;
  await admin.storage
    .from(BUCKET)
    .remove(paths)
    .catch(() => undefined);
}

async function uploadRequest(
  request: Request,
  admin: AdminClient,
  actor: Actor,
  podId: string,
  kind: DocumentKind,
) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "Send the document as multipart form data.");
  }
  const actionValue = String(form.get("action") ?? "");
  if (actionValue !== "add" && actionValue !== "replace")
    throw new ApiError(400, "Specify add or replace.");
  const action = actionValue as "add" | "replace";
  if (String(form.get("uploadId") ?? kind) !== kind)
    throw new ApiError(400, "POD document field does not match the QR code.");
  if (String(form.get("recordId") ?? podId) !== podId)
    throw new ApiError(400, "POD record does not match the QR code.");
  if (!canManageOutwardPODDocument(actor.role, action))
    throw new ApiError(403, "This account type is not permitted to change POD documents.");

  const file = getFormFile(form, "file");
  validateFile(file);
  const { pod } = await authorizePodAction(admin, actor, podId, action);
  const column = DOCUMENT_COLUMNS[kind];
  const previousPath = getPath(pod, kind);
  if (action === "add" && previousPath)
    throw new ApiError(409, "A file already exists in this field. Use replace instead.");
  if (action === "replace" && !previousPath)
    throw new ApiError(409, "This field is empty. Use add instead.");

  const stored = await storeFile(admin, pod.id, kind, file);
  let update = admin
    .from("outward_pods")
    .update({
      [column]: stored.path,
      updated_at: new Date().toISOString(),
      updated_by: actor.userId,
    })
    .eq("id", pod.id);
  update = previousPath ? update.eq(column, previousPath) : update.is(column, null);
  const { data: updated, error } = await update.select("id").maybeSingle();
  if (error || !updated) {
    await removeStoredFiles(admin, [stored.path]);
    if (error) throw new ApiError(503, "The POD record could not be updated.");
    throw new ApiError(409, "This POD field changed during upload. Reload the POD and try again.");
  }
  if (previousPath) await removeStoredFiles(admin, [previousPath]);

  const fileUrl = `${operationUrl(request, "file", pod.id, kind)}&filename=${encodeURIComponent(file.name)}`;
  return json({
    ok: true,
    url: fileUrl,
    fileUrl,
    fileName: file.name,
    mimeType: stored.contentType,
    message: `${kind === "front" ? "Front" : kind === "back" ? "Back" : "Signature"} POD document ${action === "add" ? "added" : "replaced"}.`,
  });
}

async function createPODRequest(request: Request, admin: AdminClient, actor: Actor) {
  if (actor.authType !== "bearer")
    throw new ApiError(401, "Creating an Outward POD requires an ERP session.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "Send POD details as multipart form data.");
  }
  const consignmentId = String(form.get("consignmentId") ?? "").trim();
  const deliveryDate = String(form.get("deliveryDate") ?? "").trim();
  const lrNumber = String(form.get("transporterLrNumber") ?? "").trim();
  const lrDate = String(form.get("transporterLrDate") ?? "").trim();
  if (!consignmentId || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate))
    throw new ApiError(400, "A valid consignment and delivery date are required.");

  const { data: consignment, error: consignmentError } = await admin
    .from("consignments")
    .select("id,consignment_number,branch_id,consignment_type")
    .eq("id", consignmentId)
    .maybeSingle();
  if (consignmentError)
    throw new ApiError(503, "The consignment service is temporarily unavailable.");
  if (!consignment) throw new ApiError(404, "Consignment not found.");
  await ensureBranchAccess(admin, actor, String(consignment.branch_id));
  if (
    consignment.consignment_type === "third_party" &&
    (!lrNumber || !/^\d{4}-\d{2}-\d{2}$/.test(lrDate))
  ) {
    throw new ApiError(
      400,
      "Transporter LR number and date are required for third-party consignments.",
    );
  }

  const files: Partial<Record<DocumentKind, File>> = {};
  for (const kind of Object.keys(DOCUMENT_COLUMNS) as DocumentKind[]) {
    const file = getFormFile(form, kind);
    if (file) {
      validateFile(file);
      files[kind] = file;
    }
  }
  if (!Object.keys(files).length)
    throw new ApiError(400, "Upload at least one Front, Back, or Signature copy.");
  if (!canManageOutwardPODDocument(actor.role, "add")) {
    throw new ApiError(403, "This account type is not permitted to add POD documents.");
  }

  const { data: existing, error: existingError } = await admin
    .from("outward_pods")
    .select("id")
    .eq("consignment_id", consignmentId)
    .maybeSingle();
  if (existingError) throw new ApiError(503, "The POD service is temporarily unavailable.");
  if (existing)
    throw new ApiError(
      409,
      "An Outward POD already exists for this consignment. Open it to add or replace documents.",
    );

  const podId = randomUUID();
  const uploaded: string[] = [];
  const paths: Record<DocumentKind, string | null> = { front: null, back: null, signature: null };
  try {
    for (const kind of Object.keys(DOCUMENT_COLUMNS) as DocumentKind[]) {
      const file = files[kind];
      if (!file) continue;
      const stored = await storeFile(admin, podId, kind, file);
      uploaded.push(stored.path);
      paths[kind] = stored.path;
    }

    const { data: pod, error: insertError } = await admin
      .from("outward_pods")
      .insert({
        id: podId,
        consignment_id: consignmentId,
        delivery_date: deliveryDate,
        transporter_lr_number: consignment.consignment_type === "third_party" ? lrNumber : null,
        transporter_lr_date: consignment.consignment_type === "third_party" ? lrDate : null,
        front_copy_path: paths.front,
        back_copy_path: paths.back,
        signature_copy_path: paths.signature,
        created_by: actor.userId,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id,consignment_id,delivery_date,transporter_lr_number,transporter_lr_date,front_copy_path,back_copy_path,signature_copy_path,created_at",
      )
      .single();
    if (insertError || !pod) {
      if (insertError?.code === "23505")
        throw new ApiError(409, "An Outward POD already exists for this consignment.");
      throw new ApiError(503, "The Outward POD record could not be created.");
    }

    const { error: updateError } = await admin
      .from("consignments")
      .update({
        delivery_date: deliveryDate,
        transporter_lr_number: consignment.consignment_type === "third_party" ? lrNumber : null,
        transporter_lr_date: consignment.consignment_type === "third_party" ? lrDate : null,
      })
      .eq("id", consignmentId);
    if (updateError) {
      await admin.from("outward_pods").delete().eq("id", pod.id);
      throw new ApiError(503, "The delivery details could not be saved.");
    }

    return json({ ok: true, pod, message: "Outward POD created." });
  } catch (error) {
    await removeStoredFiles(admin, uploaded);
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "The Outward POD could not be created.");
  }
}

async function createPODFromMobileUpload(
  request: Request,
  admin: AdminClient,
  actor: Actor,
  consignmentId: string,
  kind: DocumentKind,
) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "Send the document as multipart form data.");
  }
  if (String(form.get("action") ?? "") !== "add") {
    throw new ApiError(400, "A new Outward POD only accepts an add action.");
  }
  if (String(form.get("recordId") ?? "") !== consignmentId) {
    throw new ApiError(400, "Consignment does not match the create-form QR code.");
  }
  if (String(form.get("uploadId") ?? "") !== kind) {
    throw new ApiError(400, "POD document field does not match the QR code.");
  }
  if (!canManageOutwardPODDocument(actor.role, "add")) {
    throw new ApiError(403, "This account type is not permitted to add POD documents.");
  }

  const file = getFormFile(form, "file");
  validateFile(file);
  const deliveryDate = String(form.get("deliveryDate") ?? "").trim();
  const lrNumber = String(form.get("transporterLrNumber") ?? "").trim();
  const lrDate = String(form.get("transporterLrDate") ?? "").trim();
  if (!isIsoDate(deliveryDate))
    throw new ApiError(400, "Enter a valid delivery date (YYYY-MM-DD).");

  const { data: consignment, error: consignmentError } = await admin
    .from("consignments")
    .select("id,consignment_number,branch_id,consignment_type")
    .eq("id", consignmentId)
    .maybeSingle();
  if (consignmentError)
    throw new ApiError(503, "The consignment service is temporarily unavailable.");
  if (!consignment) throw new ApiError(404, "Consignment not found.");
  await ensureBranchAccess(admin, actor, String(consignment.branch_id));
  if (consignment.consignment_type === "third_party" && (!lrNumber || !isIsoDate(lrDate))) {
    throw new ApiError(
      400,
      "Transporter LR number and a valid LR date (YYYY-MM-DD) are required for third-party consignments.",
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("outward_pods")
    .select("id")
    .eq("consignment_id", consignmentId)
    .maybeSingle();
  if (existingError) throw new ApiError(503, "The POD service is temporarily unavailable.");
  if (existing) {
    throw new ApiError(
      409,
      "This POD was created while you were scanning. Scan its latest QR to continue.",
    );
  }

  const podId = randomUUID();
  const stored = await storeFile(admin, podId, kind, file);
  const paths: Record<DocumentKind, string | null> = { front: null, back: null, signature: null };
  paths[kind] = stored.path;
  try {
    const { data: pod, error: insertError } = await admin
      .from("outward_pods")
      .insert({
        id: podId,
        consignment_id: consignmentId,
        delivery_date: deliveryDate,
        transporter_lr_number: consignment.consignment_type === "third_party" ? lrNumber : null,
        transporter_lr_date: consignment.consignment_type === "third_party" ? lrDate : null,
        front_copy_path: paths.front,
        back_copy_path: paths.back,
        signature_copy_path: paths.signature,
        created_by: actor.userId,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id,consignment_id,delivery_date,transporter_lr_number,transporter_lr_date,front_copy_path,back_copy_path,signature_copy_path",
      )
      .single();
    if (insertError || !pod) {
      if (insertError?.code === "23505") {
        throw new ApiError(
          409,
          "An Outward POD already exists for this consignment. Scan its latest QR.",
        );
      }
      throw new ApiError(503, "The Outward POD record could not be created.");
    }

    const { error: updateError } = await admin
      .from("consignments")
      .update({
        delivery_date: deliveryDate,
        transporter_lr_number: consignment.consignment_type === "third_party" ? lrNumber : null,
        transporter_lr_date: consignment.consignment_type === "third_party" ? lrDate : null,
      })
      .eq("id", consignmentId);
    if (updateError) {
      await admin.from("outward_pods").delete().eq("id", podId);
      throw new ApiError(503, "The delivery details could not be saved.");
    }

    return json({
      ok: true,
      pod,
      message: "Outward POD created and first document uploaded.",
      manifest: manifestFor(request, actor, pod as PodRecord, consignment as ConsignmentRecord),
    });
  } catch (error) {
    await removeStoredFiles(admin, [stored.path]);
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "The Outward POD could not be created from the mobile upload.");
  }
}

export async function verifyMobileCredentials(request: Request): Promise<Response> {
  if (rateLimited(request, "mobile-verify", 12, 10 * 60 * 1000)) {
    return jsonError("Too many sign-in attempts. Wait a few minutes and try again.", 429);
  }
  const credentials = decodeBasicAuthorization(request.headers.get("authorization"));
  if (!credentials) return jsonError("Enter a valid login ID and password.", 401);
  if (Number(request.headers.get("content-length") ?? 0) > 8192)
    return jsonError("Invalid sign-in request.", 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid sign-in request.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return jsonError("Invalid sign-in request.", 400);
  const payload = body as Record<string, unknown>;
  const bodyId = typeof payload.id === "string" ? payload.id.trim().toLowerCase() : "";
  if (payload.action !== "verify" || bodyId !== credentials.username) {
    return jsonError("Invalid sign-in request.", 400);
  }

  try {
    const admin = await getAdmin();
    const user = await findBasicUser(admin, credentials);
    return json({
      ok: true,
      valid: true,
      user: { id: user.userId, username: user.username, role: user.role },
    });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    console.error("[mobile-verify] Account verification failed.");
    return jsonError("The account service is temporarily unavailable.", 503);
  }
}

export async function handleOutwardPODGet(request: Request): Promise<Response> {
  if (rateLimited(request, "outward-pod-read", 600, 5 * 60 * 1000)) {
    return jsonError("Too many requests. Wait a few minutes and try again.", 429);
  }
  try {
    const url = new URL(request.url);
    const operation = url.searchParams.get("operation");
    const podId = url.searchParams.get("podId") ?? "";
    const admin = await getAdmin();
    const actor = await authenticateRequest(request, admin);
    if (operation === "manifest") {
      if (podId) return await manifestRequest(request, admin, actor, podId);
      const consignmentId = url.searchParams.get("consignmentId") ?? "";
      if (consignmentId) {
        return await creationManifestRequest(request, admin, actor, consignmentId);
      }
      throw new ApiError(400, "POD or consignment ID is required.");
    }
    if (!podId) throw new ApiError(400, "POD ID is required.");
    if (operation === "links") return await fileLinksRequest(admin, actor, podId);
    if (operation === "file") {
      const kind = url.searchParams.get("kind");
      if (!isDocumentKind(kind)) throw new ApiError(400, "Unknown POD document field.");
      return await fileRequest(request, admin, actor, podId, kind);
    }
    throw new ApiError(400, "Unknown POD operation.");
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    console.error("[outward-pod-api] Read request failed.");
    return jsonError("The POD document service is temporarily unavailable.", 503);
  }
}

export async function handleOutwardPODPost(request: Request): Promise<Response> {
  if (rateLimited(request, "outward-pod-write", 240, 5 * 60 * 1000)) {
    return jsonError("Too many uploads. Wait a few minutes and try again.", 429);
  }
  try {
    const url = new URL(request.url);
    const operation = url.searchParams.get("operation");
    const admin = await getAdmin();
    const actor = await authenticateRequest(request, admin);
    if (operation === "create") return await createPODRequest(request, admin, actor);
    if (operation === "create-upload") {
      const consignmentId = url.searchParams.get("consignmentId") ?? "";
      const kind = url.searchParams.get("kind");
      if (!consignmentId) throw new ApiError(400, "Consignment ID is required.");
      if (!isDocumentKind(kind)) throw new ApiError(400, "Unknown POD document field.");
      return await createPODFromMobileUpload(request, admin, actor, consignmentId, kind);
    }
    if (operation === "upload") {
      const podId = url.searchParams.get("podId") ?? "";
      const kind = url.searchParams.get("kind");
      if (!podId) throw new ApiError(400, "POD ID is required.");
      if (!isDocumentKind(kind)) throw new ApiError(400, "Unknown POD document field.");
      return await uploadRequest(request, admin, actor, podId, kind);
    }
    throw new ApiError(400, "Unknown POD operation.");
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    console.error("[outward-pod-api] Upload request failed.");
    return jsonError("The POD document service is temporarily unavailable.", 503);
  }
}
