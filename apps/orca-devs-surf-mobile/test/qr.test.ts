import assert from "node:assert/strict";
import test from "node:test";
import { actionUrl, fileKind, normalizeManifest } from "../src/lib/qr.ts";

test("normalizes a permitted image/pdf/Word manifest and keeps action URLs explicit", () => {
  const manifest = normalizeManifest({
    recordId: "TRIP-42",
    title: "Trip documents",
    uploads: [
      {
        id: "invoice",
        label: "Invoice",
        mimeType: "application/pdf",
        value: "https://docs.example.test/files/invoice.pdf",
        allowView: true,
        allowAdd: true,
        allowReplace: false,
        addUrl: "https://docs.example.test/api/invoice",
      },
      {
        id: "photo",
        type: "image",
        valueUrl: "https://docs.example.test/files/photo.jpg",
        permissions: { view: true },
      },
      {
        id: "letter",
        type: "docx",
        value: "https://docs.example.test/files/letter.docx",
        allowView: "true",
      },
    ],
  });

  assert.equal(manifest.recordId, "TRIP-42");
  assert.equal(manifest.uploads.length, 3);
  assert.equal(fileKind(manifest.uploads[0].mimeType, manifest.uploads[0].valueUrl), "pdf");
  assert.equal(fileKind(manifest.uploads[1].mimeType, manifest.uploads[1].valueUrl), "image");
  assert.equal(fileKind(manifest.uploads[2].mimeType, manifest.uploads[2].valueUrl), "word");
  assert.equal(actionUrl(manifest.uploads[0], "add"), "https://docs.example.test/api/invoice");
  assert.equal(actionUrl(manifest.uploads[0], "replace"), undefined);
  assert.equal(manifest.uploads[1].allowView, true);
});

test("does not expose add, replace, or view if the permission or action URL is missing", () => {
  const manifest = normalizeManifest({
    id: "R-1",
    fields: [
      { id: "no-permission", allowAdd: false, uploadUrl: "https://docs.example.test/upload" },
      { id: "no-url", allowAdd: true },
      { id: "no-view-url", allowView: true, value: "not-a-url" },
    ],
  });

  assert.equal(actionUrl(manifest.uploads[0], "add"), undefined);
  assert.equal(actionUrl(manifest.uploads[1], "add"), undefined);
  assert.equal(manifest.uploads[2].viewUrl, undefined);
});

test("resolves relative file/action URLs against the QR manifest endpoint", () => {
  const manifest = normalizeManifest(
    {
      recordId: "R-2",
      uploadUrl: "./files/upload",
      uploads: [{ id: "identity", fileUrl: "../stored/id-card.jpg", viewAllowed: true, addAllowed: true }],
    },
    "https://docs.example.test/api/manifest/R-2",
  );

  assert.equal(manifest.uploads[0].valueUrl, "https://docs.example.test/api/stored/id-card.jpg");
  assert.equal(manifest.uploads[0].addUrl, "https://docs.example.test/api/manifest/files/upload");
  assert.equal(manifest.uploads[0].allowView, true);
});
