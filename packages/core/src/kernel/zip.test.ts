import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from './zip';

// A small reader, so the test holds the writer to the format and not to its own idea of it.
function read(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const checksum = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const rawSize = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    expect(data.length).toBe(rawSize);
    expect(crc32(data)).toBe(checksum);
    files.push({ name, data });
    at += 46 + nameLength;
  }
  return files;
}

describe('createZip', () => {
  it('writes files that read back whole, deflated or stored', () => {
    const xml = `<autorizacion>${'<x>dato</x>'.repeat(200)}</autorizacion>`;
    const zip = createZip(
      [
        { name: 'autorizados/1.xml', data: xml },
        { name: 'anulados/ñandú-2.xml', data: Buffer.from('<a/>') },
        { name: 'vacio.xml', data: '' },
      ],
      new Date('2026-11-10T15:00:00Z'),
    );
    const files = read(zip);
    expect(files.map((file) => file.name)).toEqual([
      'autorizados/1.xml',
      'anulados/ñandú-2.xml',
      'vacio.xml',
    ]);
    expect(files[0]!.data.toString()).toBe(xml);
    expect(files[1]!.data.toString()).toBe('<a/>');
    expect(files[2]!.data.length).toBe(0);
    // The repeated XML is worth deflating.
    expect(zip.length).toBeLessThan(xml.length);
  });

  it('writes an empty archive that is still one', () => {
    expect(read(createZip([]))).toEqual([]);
  });
});
