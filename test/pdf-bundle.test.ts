import assert from "node:assert/strict";
import test from "node:test";
import { crc32, createPdfZip } from "../src/lib/pdf-bundle.ts";

test("standard ZIP CRC32 and separate PDF entries", () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.equal(crc32(bytes), 0xcbf43926);
  const zip = createPdfZip([
    { name: "GR-123.pdf", bytes: new TextEncoder().encode("%PDF-1.4\nGR") },
    { name: "Additional-Details-123.pdf", bytes: new TextEncoder().encode("%PDF-1.4\nDETAILS") },
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 22 + 10, true), 2);
  assert.ok(new TextDecoder().decode(zip).includes("Additional-Details-123.pdf"));
});
