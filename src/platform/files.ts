'use client';
/**
 * Saving a file to the visitor's computer and picking one from it, with nothing but the browser.
 *
 * `downloadFile` makes an object URL and clicks a hidden link with a `download` name, which every current browser
 * honours. `pickFile` opens the browser's file picker and resolves with the chosen file, or null when the visitor
 * closes it without choosing.
 */

export type FileData = string | Uint8Array | ArrayBuffer | Blob;

/** The data as a Blob of the given type. */
export function toBlob(data: FileData, mime = 'application/octet-stream'): Blob {
  if (data instanceof Blob) return data;
  // Uint8Array<ArrayBufferLike> is not a BlobPart under the DOM types, so copy into a plain ArrayBuffer view first
  const part: BlobPart = typeof data === 'string' ? data : data instanceof Uint8Array ? new Uint8Array(data) : data;
  return new Blob([part], { type: mime });
}

/** Saves `data` as `filename` through the browser's downloads. Returns false when the page cannot do that. */
export function downloadFile(filename: string, data: FileData, mime?: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const url = URL.createObjectURL(toBlob(data, mime));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // the click starts the download synchronously; keep the URL a little longer for slow browsers
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the file picker. `accept` is the input's accept list, such as `.json` or `.sqlite,.db`. Resolves null when
 * nothing was chosen. Browsers fire `cancel` on the input when the picker is closed; where they do not, the promise
 * stays pending until the next pick, which is harmless because nothing waits on it.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const finish = (f: File | null) => {
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Reads a picked file as bytes. */
export async function fileBytes(f: Blob): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}
