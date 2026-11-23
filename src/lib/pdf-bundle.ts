/** Build a portable, uncompressed ZIP with separate PDF files.
 * This avoids browsers blocking the second of two automatic downloads.
 * ZIP entry names must be simple ASCII filenames.
 */
export type BundledPdf = { name: string; bytes: Uint8Array };

const encoder = new TextEncoder();
const u16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
const u32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, true);

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createPdfZip(files: BundledPdf[]): Uint8Array {
  if (!files.length) throw new Error("PDF bundle is empty");
  if (files.length > 65535) throw new Error("Too many PDF files");
  const entries = files.map(({ name, bytes }) => {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!safe.toLowerCase().endsWith(".pdf")) throw new Error("Only PDF files can be bundled");
    const filename = encoder.encode(safe);
    if (filename.length > 65535 || bytes.length > 0xffffffff)
      throw new Error("PDF is too large for a ZIP");
    return { filename, bytes, crc: crc32(bytes) };
  });
  const localSize = entries.reduce((sum, item) => sum + 30 + item.filename.length + item.bytes.length, 0);
  const centralSize = entries.reduce((sum, item) => sum + 46 + item.filename.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  const offsets: number[] = [];
  let offset = 0;
  for (const item of entries) {
    offsets.push(offset);
    u32(view, offset, 0x04034b50);
    u16(view, offset + 4, 20);
    u16(view, offset + 6, 0);
    u16(view, offset + 8, 0); // STORE; PDFs are already compressed.
    u32(view, offset + 14, item.crc);
    u32(view, offset + 18, item.bytes.length);
    u32(view, offset + 22, item.bytes.length);
    u16(view, offset + 26, item.filename.length);
    u16(view, offset + 28, 0);
    offset += 30;
    output.set(item.filename, offset);
    offset += item.filename.length;
    output.set(item.bytes, offset);
    offset += item.bytes.length;
  }
  const centralStart = offset;
  entries.forEach((item, i) => {
    u32(view, offset, 0x02014b50);
    u16(view, offset + 4, 20);
    u16(view, offset + 6, 20);
    u16(view, offset + 8, 0);
    u16(view, offset + 10, 0);
    u32(view, offset + 16, item.crc);
    u32(view, offset + 20, item.bytes.length);
    u32(view, offset + 24, item.bytes.length);
    u16(view, offset + 28, item.filename.length);
    u32(view, offset + 42, offsets[i]);
    offset += 46;
    output.set(item.filename, offset);
    offset += item.filename.length;
  });
  u32(view, offset, 0x06054b50);
  u16(view, offset + 8, entries.length);
  u16(view, offset + 10, entries.length);
  u32(view, offset + 12, offset - centralStart);
  u32(view, offset + 16, centralStart);
  return output;
}
