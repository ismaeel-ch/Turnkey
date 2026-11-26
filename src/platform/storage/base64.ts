/** The same base64 the workspace uses for SQLite files (`b64` in db.js), so stored values stay readable by it. */
export function encodeBase64(u8: Uint8Array): string {
  let s = '';
  const n = 0x8000;
  for (let i = 0; i < u8.length; i += n) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + n)));
  return btoa(s);
}

export function decodeBase64(text: string): Uint8Array {
  const bin = atob(text);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
