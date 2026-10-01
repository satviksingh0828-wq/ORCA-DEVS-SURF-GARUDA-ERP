import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import QRCode from "qrcode";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(here, "assets");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4200);
const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
const demoUser = process.env.DEMO_USER ?? "demo";
const demoPassword = process.env.DEMO_PASSWORD ?? "orca-demo-2026";
const maxUploadBytes = 20 * 1024 * 1024;
const startedAt = new Date().toISOString();
const files = new Map();
let uploadCount = 0;

function seedFile(id, filename, mimeType) {
  files.set(id, {
    filename,
    mimeType,
    buffer: readFileSync(path.join(assetDir, filename)),
    seeded: true,
  });
}
seedFile("seed-invoice", "sample-invoice.pdf", "application/pdf");
seedFile("seed-photo", "sample-id.png", "image/png");
seedFile(
  "seed-letter",
  "sample-letter.docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);

const records = new Map([
  [
    "01-invoice",
    {
      recordId: "DEMO-TRIP-0042",
      title: "Trip 0042 · Vendor invoice",
      fields: [
        {
          id: "invoice",
          label: "Vendor invoice",
          mimeType: "application/pdf",
          fileId: "seed-invoice",
          allowView: true,
          allowAdd: false,
          allowReplace: true,
        },
      ],
    },
  ],
  [
    "02-id-photo",
    {
      recordId: "DEMO-EMP-0007",
      title: "Employee 0007 · ID photo and attachment",
      fields: [
        {
          id: "identity-photo",
          label: "ID photo",
          mimeType: "image/png",
          fileId: "seed-photo",
          allowView: true,
          allowAdd: false,
          allowReplace: false,
        },
        {
          id: "supporting-document",
          label: "Supporting PDF",
          mimeType: "application/pdf",
          fileId: null,
          allowView: false,
          allowAdd: true,
          allowReplace: false,
        },
      ],
    },
  ],
  [
    "03-word-document",
    {
      recordId: "DEMO-PO-0108",
      title: "Purchase 0108 · supporting letter",
      fields: [
        {
          id: "supporting-letter",
          label: "Supporting letter",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileId: "seed-letter",
          allowView: true,
          allowAdd: false,
          allowReplace: false,
        },
      ],
    },
  ],
]);

function baseFor(req) {
  if (publicBase) return publicBase;
  const forwardedHost = req.headers["x-forwarded-host"];
  const reqHost = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : (forwardedHost ?? req.headers.host);
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : (forwardedProto ?? "https");
  return `${proto}://${reqHost}`;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sameText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticated(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return (
    sameText(decoded.slice(0, separator), demoUser) &&
    sameText(decoded.slice(separator + 1), demoPassword)
  );
}

function requireAuth(req, res) {
  if (authenticated(req)) return true;
  res.setHeader("WWW-Authenticate", 'Basic realm="ORCA Documents demo"');
  sendJson(res, 401, {
    ok: false,
    valid: false,
    authenticated: false,
    message: "Demo credentials were rejected.",
  });
  return false;
}

async function readJson(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function fileUrl(base, fileId, filename) {
  return `${base}/api/mock/files/${encodeURIComponent(fileId)}/${encodeURIComponent(filename)}`;
}

function manifestFor(slug, base) {
  const record = records.get(slug);
  if (!record) return undefined;
  const uploads = record.fields.map((field) => {
    const currentFile = field.fileId ? files.get(field.fileId) : undefined;
    const valueUrl = currentFile ? fileUrl(base, field.fileId, currentFile.filename) : undefined;
    return {
      id: field.id,
      label: field.label,
      mimeType: field.mimeType,
      valueUrl: valueUrl ?? null,
      viewUrl: field.allowView && currentFile ? valueUrl : null,
      uploadUrl: `${base}/api/mock/uploads`,
      addUrl: `${base}/api/mock/uploads`,
      replaceUrl: `${base}/api/mock/uploads`,
      allowView: field.allowView,
      allowAdd: field.allowAdd && !currentFile,
      allowReplace: field.allowReplace && Boolean(currentFile),
    };
  });
  return {
    schema: "orca.document.v1",
    recordId: record.recordId,
    title: record.title,
    uploads,
  };
}

function htmlEscape(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function actionSummary(field) {
  const actions = [];
  if (field.allowView && field.fileId) actions.push("View");
  if (field.allowAdd) actions.push("Add");
  if (field.allowReplace) actions.push("Replace");
  return actions.join(" · ") || "No document action";
}

async function landingPage(req, res) {
  const base = baseFor(req);
  const verifyUrl = `${base}/api/mobile/verify`;
  const items = await Promise.all(
    [...records.entries()].map(async ([slug, record], index) => {
      const qrUrl = `${base}/api/mock/qr/${slug}`;
      const image = await QRCode.toDataURL(qrUrl, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#111111", light: "#FFFFFF" },
      });
      const fileTypes = [
        ...new Set(
          record.fields.map((field) => {
            if (field.mimeType === "application/pdf") return "PDF";
            if (field.mimeType.startsWith("image/")) return "IMAGE";
            if (field.mimeType.includes("wordprocessingml")) return "WORD";
            return "FILE";
          }),
        ),
      ].join(" + ");
      const fields = record.fields
        .map((field) => {
          const file = field.fileId ? files.get(field.fileId) : undefined;
          const value = file
            ? `Sample file · ${htmlEscape(file.filename)}`
            : "No file yet · ready to add";
          return `<div class="file"><strong>${htmlEscape(field.label)}</strong><span>${value}</span><span>${htmlEscape(actionSummary(field))}</span></div>`;
        })
        .join("");
      return `<article class="card">
      <div class="card-top"><span class="number">0${index + 1}</span><span class="tag">${htmlEscape(fileTypes)}</span></div>
      <img class="qr" src="${image}" alt="QR code ${index + 1} for ${htmlEscape(record.title)}" />
      <h2>${htmlEscape(record.title)}</h2>
      <p class="record">Record ${htmlEscape(record.recordId)}</p>
      <div class="field-list" style="display:grid;gap:8px">${fields}</div>
      <a class="button" href="/api/mock/qr/${htmlEscape(slug)}" target="_blank" rel="noreferrer">OPEN MANIFEST</a>
      <button class="copy" type="button" data-copy="${htmlEscape(qrUrl)}">COPY QR ENDPOINT</button>
    </article>`;
    }),
  );
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="theme-color" content="#F4F4F4"/><title>ORCA DEVS SURF · Mock Documents</title>
<style>
:root{color-scheme:light dark;--bg:#F4F4F4;--surface:#fff;--text:#101010;--muted:#5A5A5A;--line:#D7D7D7;--ink:#202020;--well:#F0F0F0}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:0 auto;padding:32px 16px 48px}.brand{display:flex;align-items:center;gap:12px}.dot{width:40px;height:40px;border-radius:12px;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:800;letter-spacing:1px}.brand small,.eyebrow{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.65px}.brand h1{font-size:18px;margin:0}.intro{margin:30px 0 20px}.intro h2{font-size:28px;margin:5px 0 8px;letter-spacing:-.6px}.intro p{max-width:700px;color:var(--muted);line-height:1.6;margin:0}.notice{padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);line-height:1.55;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px}.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}.card-top{display:flex;align-items:center;justify-content:space-between}.number{font-size:12px;font-weight:700;color:var(--muted)}.tag{border:1px solid var(--line);border-radius:99px;padding:5px 9px;font-size:10px;font-weight:700}.qr{width:190px;height:190px;display:block;margin:14px auto 10px;background:#fff;border-radius:6px}.card h2{font-size:17px;margin:8px 0 4px}.record{color:var(--muted);font-size:12px;margin:0 0 12px}.file{display:grid;gap:4px;background:var(--well);border-radius:9px;padding:11px;font-size:12px}.file span{color:var(--muted)}.actions{font-size:12px;font-weight:650;margin:12px 0}.button,.copy{min-height:42px;width:100%;border:1px solid var(--ink);border-radius:8px;display:flex;align-items:center;justify-content:center;text-decoration:none;font:700 11px inherit;letter-spacing:.35px;cursor:pointer}.button{background:var(--ink);color:white}.copy{margin-top:8px;background:var(--surface);color:var(--text)}.credentials{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}.cred{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:13px}.cred label{display:block;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.5px;margin-bottom:7px}.cred code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;color:var(--text)}.footer{color:var(--muted);font-size:11px;margin-top:24px;text-align:center}.footer a{color:var(--text);font-weight:700;text-decoration:none}@media(prefers-color-scheme:dark){:root{--bg:#000;--surface:#2D2D2D;--text:#F5F5F5;--muted:#B5B5B5;--line:#555;--ink:#fff;--well:#202020}.dot{color:#111}.button{color:#111}}
</style></head><body><main>
<header class="brand"><div class="dot">O</div><div><small>POWERED BY ORCA DEVS SURF</small><h1>Secure Documents · Mock server</h1></div></header>
<section class="intro"><span class="eyebrow">LIVE EXPO GO DEMO</span><h2>Scan. View. Upload.</h2><p>Use ORCA DEVS SURF on your phone, sign in with the demo account below, then scan one of these three QR codes. Each code carries its own allowed document actions.</p></section>
<div class="notice"><strong>Demo only.</strong> These public sample credentials and uploads are not production-secure. Uploaded files live in temporary server memory and are cleared when the demo server stops. Do not upload real or sensitive documents.</div>
<section class="credentials">
<div class="cred"><label>LOGIN ENDPOINT</label><code>${htmlEscape(verifyUrl)}</code></div>
<div class="cred"><label>USER ID</label><code>${htmlEscape(demoUser)}</code></div>
<div class="cred"><label>DEMO PASSWORD</label><code>${htmlEscape(demoPassword)}</code></div>
</section>
<section class="grid" style="margin-top:18px">${items.join("\n")}</section>
<p class="footer">Powered by <a href="https://orca.devs.surf" target="_blank" rel="noreferrer">ORCA DEVS SURF</a> · <a href="${htmlEscape(base)}/health">health check</a></p>
</main><script>document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='COPIED'}catch{b.textContent=b.dataset.copy}setTimeout(()=>b.textContent='COPY QR ENDPOINT',1800)}));</script></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function sendFile(req, res, pathname) {
  if (!requireAuth(req, res)) return;
  const match = pathname.match(/^\/api\/mock\/files\/([^/]+)\/(.+)$/);
  if (!match) return sendJson(res, 404, { ok: false, message: "File not found." });
  const fileId = decodeURIComponent(match[1]);
  const file = files.get(fileId);
  if (!file) return sendJson(res, 404, { ok: false, message: "File not found." });
  res.writeHead(200, {
    "Content-Type": file.mimeType,
    "Content-Length": file.buffer.length,
    "Content-Disposition": `inline; filename="${file.filename.replace(/["\\\r\n]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(file.buffer);
}

function receiveUpload(req, res) {
  if (!requireAuth(req, res)) return;
  const form = {};
  let uploadedFile;
  let tooLarge = false;
  let completed = false;
  let parser;
  try {
    parser = Busboy({
      headers: req.headers,
      limits: { fileSize: maxUploadBytes, files: 1, fields: 8, fieldSize: 8 * 1024 },
    });
  } catch {
    return sendJson(res, 400, { ok: false, message: "Expected a multipart file upload." });
  }

  parser.on("field", (name, value) => {
    form[name] = value;
  });
  parser.on("file", (name, stream, info) => {
    if (name !== "file") {
      stream.resume();
      return;
    }
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("limit", () => {
      tooLarge = true;
    });
    stream.on("end", () => {
      uploadedFile = {
        filename:
          path
            .basename(info.filename || "upload.bin")
            .replace(/[\r\n]/g, "_")
            .slice(0, 120) || "upload.bin",
        mimeType: info.mimeType || "application/octet-stream",
        buffer: Buffer.concat(chunks),
        seeded: false,
      };
    });
  });
  parser.on("error", () => {
    if (!completed) {
      completed = true;
      sendJson(res, 400, { ok: false, message: "The multipart upload could not be parsed." });
    }
  });
  parser.on("finish", () => {
    if (completed) return;
    completed = true;
    if (tooLarge) return sendJson(res, 413, { ok: false, message: "Demo upload limit is 20 MB." });
    if (!uploadedFile?.buffer.length)
      return sendJson(res, 400, { ok: false, message: "Choose a non-empty file first." });

    const match = [...records.values()]
      .map((record) => ({
        record,
        field: record.fields.find((field) => field.id === form.uploadId),
      }))
      .find(({ record, field }) => record.recordId === form.recordId && field);
    if (!match)
      return sendJson(res, 404, {
        ok: false,
        message: "That record or upload field was not found.",
      });
    const { record, field } = match;
    if (form.id !== demoUser)
      return sendJson(res, 401, {
        ok: false,
        valid: false,
        message: "User ID does not match the demo account.",
      });
    if (form.action !== "add" && form.action !== "replace")
      return sendJson(res, 400, { ok: false, message: "Action must be add or replace." });
    if (form.action === "add" && (!field.allowAdd || field.fileId))
      return sendJson(res, 403, { ok: false, message: "This QR does not allow adding a file." });
    if (form.action === "replace" && (!field.allowReplace || !field.fileId))
      return sendJson(res, 403, { ok: false, message: "This QR does not allow replacing a file." });

    const id = `upload-${Date.now()}-${randomBytes(4).toString("hex")}`;
    files.set(id, uploadedFile);
    field.fileId = id;
    uploadCount += 1;
    const url = fileUrl(baseFor(req), id, uploadedFile.filename);
    return sendJson(res, 200, {
      ok: true,
      url,
      fileUrl: url,
      message: `${form.action === "add" ? "Added" : "Replaced"} ${uploadedFile.filename}. Demo upload is held temporarily in server memory.`,
    });
  });
  req.pipe(parser);
}

async function handle(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/") return landingPage(req, res);
  if (req.method === "GET" && url.pathname === "/health")
    return sendJson(res, 200, { ok: true, service: "orca-documents-mock", startedAt });

  const qrImage = url.pathname.match(/^\/qr\/(01-invoice|02-id-photo|03-word-document)\.png$/);
  if (req.method === "GET" && qrImage) {
    const image = await QRCode.toBuffer(`${baseFor(req)}/api/mock/qr/${qrImage[1]}`, {
      type: "png",
      width: 560,
      margin: 3,
      errorCorrectionLevel: "M",
    });
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.end(image);
  }

  if (req.method === "POST" && url.pathname === "/api/mobile/verify") {
    if (!requireAuth(req, res)) return;
    try {
      const body = await readJson(req);
      if (body.action !== "verify" || body.id !== demoUser)
        return sendJson(res, 401, {
          ok: false,
          valid: false,
          authenticated: false,
          message: "The demo ID or password is incorrect.",
        });
      return sendJson(res, 200, {
        ok: true,
        valid: true,
        exists: true,
        authenticated: true,
        userId: demoUser,
        message: "Demo credentials verified.",
      });
    } catch {
      return sendJson(res, 400, {
        ok: false,
        valid: false,
        message: "Expected a JSON verification request.",
      });
    }
  }

  const qrManifest = url.pathname.match(
    /^\/api\/mock\/qr\/(01-invoice|02-id-photo|03-word-document)$/,
  );
  if (req.method === "GET" && qrManifest) {
    if (!requireAuth(req, res)) return;
    const manifest = manifestFor(qrManifest[1], baseFor(req));
    return sendJson(
      res,
      manifest ? 200 : 404,
      manifest ?? { ok: false, message: "QR manifest not found." },
    );
  }

  if (req.method === "GET" && url.pathname === "/api/mock/state") {
    return sendJson(res, 200, {
      service: "ORCA DEVS SURF mock documents",
      startedAt,
      uploadCount,
      records: [...records.entries()].map(([qrId, record]) => ({
        qrId,
        recordId: record.recordId,
        title: record.title,
        fields: record.fields.map((field) => ({
          id: field.id,
          label: field.label,
          fileName: field.fileId ? (files.get(field.fileId)?.filename ?? null) : null,
          permissions: {
            view: field.allowView,
            add: field.allowAdd,
            replace: field.allowReplace,
          },
        })),
      })),
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/mock/files/"))
    return sendFile(req, res, url.pathname);
  if (req.method === "POST" && url.pathname === "/api/mock/uploads") return receiveUpload(req, res);

  return sendJson(res, 404, { ok: false, message: "Route not found." });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("mock server request failed", error);
    if (!res.headersSent)
      sendJson(res, 500, { ok: false, message: "Unexpected demo server error." });
    else res.end();
  });
});

server.listen(port, host, () => {
  const advertised = publicBase ?? `http://localhost:${port}`;
  console.log(`ORCA Documents mock server listening on ${host}:${port}`);
  console.log(`Demo portal: ${advertised}/`);
  console.log(`Login endpoint: ${advertised}/api/mobile/verify`);
  console.log(`Demo user: ${demoUser}`);
  console.log("Temporary in-memory demo only. Do not upload real documents.");
});
