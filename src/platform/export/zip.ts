/**
 * A small ZIP writer: files are stored as they are (no compression), which every unzip tool and operating system
 * opens. The build pack is a few hundred kilobytes at most, so compression would save little and cost a dependency.
 * Format: PKWARE APPNOTE 6.3, local headers + central directory + end record, UTF-8 names (flag bit 11).
 */

export interface ZipEntry {
  /** path inside the archive, with forward slashes */
  name: string;
  data: string | Uint8Array;
}

let TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (TABLE = t);
}

/** CRC-32 as ZIP uses it. */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The time and date fields of a ZIP header, in local time as the format expects. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Packs the entries into one ZIP file. Names are cleaned so nothing can climb out of the folder it unpacks to. */
export function zip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder(),
    { time, date } = dosTime(when),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const clean =
      e.name
        .replace(/\\/g, '/')
        .split('/')
        .filter((s) => s && s !== '.' && s !== '..')
        .join('/') || 'file';
    const name = enc.encode(clean),
      data = typeof e.data === 'string' ? enc.encode(e.data) : e.data,
      crc = crc32(data);
    const local = new Uint8Array(30 + name.length),
      lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length),
      cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const p of parts.concat(central, [end])) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
