// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, fileBytes, pickFile, toBlob } from '@/platform/files';

afterEach(() => vi.restoreAllMocks());

describe('files', () => {
  it('turns text, bytes and blobs into a Blob of the given type', async () => {
    expect(await toBlob('hi', 'text/plain').text()).toBe('hi');
    const b = toBlob(new Uint8Array([1, 2, 3]), 'application/vnd.sqlite3');
    expect(b.type).toBe('application/vnd.sqlite3');
    expect([...(await fileBytes(b))]).toEqual([1, 2, 3]);
    const same = new Blob(['x']);
    expect(toBlob(same)).toBe(same);
  });

  it('downloads through a hidden link with the file name', () => {
    const made: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:test') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      made.push(this.download + ' ' + this.href);
    });
    expect(downloadFile('clinic.sqlite', new Uint8Array([1]), 'application/vnd.sqlite3')).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(made).toEqual(['clinic.sqlite blob:test']);
    expect(document.querySelector('a[download]')).toBeNull(); // removed again
  });

  it('says so when the page cannot make a download', () => {
    const keep = URL.createObjectURL;
    // @ts-expect-error simulating a browser without object URLs
    URL.createObjectURL = undefined;
    expect(downloadFile('x.json', '{}')).toBe(false);
    URL.createObjectURL = keep;
  });

  it('resolves with the picked file, or null when the picker is closed', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const picked = pickFile('.json');
    let input = document.querySelector<HTMLInputElement>('input[type=file]');
    expect(input!.accept).toBe('.json');
    const f = new File(['{}'], 'backup.json');
    Object.defineProperty(input!, 'files', { value: [f] });
    input!.dispatchEvent(new Event('change'));
    expect(await picked).toBe(f);

    const closed = pickFile('.sqlite');
    input = document.querySelector<HTMLInputElement>('input[type=file]');
    input!.dispatchEvent(new Event('cancel'));
    expect(await closed).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });
});
