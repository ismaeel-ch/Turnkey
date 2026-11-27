import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_READS_PER_MINUTE, PREVIEW_TTL_MS, createPreviewLookup } from '@/server/share/lookup';

const code = '1.' + deflateRawSync(Buffer.from(JSON.stringify({ f: 'formwork-app', v: 1, name: 'Bid Desk' }))).toString('base64url');

describe('createPreviewLookup', () => {
  it('reads the store once per short name for ten minutes, misses included', async () => {
    let t = 1_000_000;
    const lookup = createPreviewLookup(() => t);
    const read = vi.fn(async (slug: string) => (slug === 'bid-desk' ? { name: 'Bid Desk', code } : null));
    expect((await lookup('bid-desk', read))?.name).toBe('Bid Desk');
    expect((await lookup('bid-desk', read))?.name).toBe('Bid Desk');
    expect(await lookup('wp-admin', read)).toBeNull();
    expect(await lookup('wp-admin', read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    t += PREVIEW_TTL_MS;
    await lookup('bid-desk', read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('never reads for a path that cannot be a short name', async () => {
    const read = vi.fn(async () => null);
    expect(await createPreviewLookup()('../etc/passwd', read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('stops reading the store after the minute budget, then starts again', async () => {
    let t = 5_000_000;
    const lookup = createPreviewLookup(() => t);
    const read = vi.fn(async () => null);
    for (let i = 0; i < PREVIEW_READS_PER_MINUTE + 20; i++) await lookup('path-' + i, read);
    expect(read).toHaveBeenCalledTimes(PREVIEW_READS_PER_MINUTE);
    t += 60_000;
    await lookup('one-more', read);
    expect(read).toHaveBeenCalledTimes(PREVIEW_READS_PER_MINUTE + 1);
  });

  it('does not remember a store failure as "nothing shared here"', async () => {
    const lookup = createPreviewLookup(() => 0);
    const down = vi.fn(async () => {
      throw new Error('down');
    });
    expect(await lookup('bid-desk', down)).toBeNull();
    expect((await lookup('bid-desk', async () => ({ name: 'Bid Desk', code })))?.name).toBe('Bid Desk');
  });
});
