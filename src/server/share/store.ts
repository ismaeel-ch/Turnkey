/**
 * Where short links are kept. On Vercel: a private Vercel Blob store. Connecting a store to the project sets
 * BLOB_STORE_ID, and the SDK signs in with the deployment's own OIDC token (VERCEL_OIDC_TOKEN), so no key is stored
 * anywhere; older connections set BLOB_READ_WRITE_TOKEN instead, which still works. On a computer: a folder (SHARE_STORE_DIR), used by `npm run dev` and the browser
 * checks. With neither, short links are off and the workspace shares the long "#app=" link as before.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { get, put } from '@vercel/blob';
import { shareRecordSchema, type ShareRecord } from './records';

export interface ShareStore {
  readonly kind: 'blob' | 'folder';
  read(slug: string): Promise<ShareRecord | null>;
  /** Writes the record. With `create`, refuses (returns false) when the name is already taken. */
  write(record: ShareRecord, opts: { create: boolean }): Promise<boolean>;
}

type Env = Record<string, string | undefined>;

const parse = (text: string): ShareRecord | null => {
  try {
    const r = shareRecordSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
};

/** How the Blob SDK signs in: a read-write token, or the deployment's OIDC token with the store id. */
export type BlobAuth = { token: string } | { storeId: string };

export function blobStore(auth: BlobAuth): ShareStore {
  // With a store id and no token, the SDK reads the OIDC token from the Vercel request (or VERCEL_OIDC_TOKEN).
  const creds = 'token' in auth ? { token: auth.token } : { storeId: auth.storeId };
  const key = (slug: string) => 'share/' + slug + '.json';
  return {
    kind: 'blob',
    async read(slug) {
      const res = await get(key(slug), { access: 'private', ...creds, useCache: false });
      if (!res || !res.stream) return null;
      return parse(await new Response(res.stream).text());
    },
    async write(record, { create }) {
      try {
        await put(key(record.slug), JSON.stringify(record), {
          access: 'private',
          ...creds,
          addRandomSuffix: false,
          allowOverwrite: !create,
          contentType: 'application/json',
        });
        return true;
      } catch (e) {
        // the name was taken between the check and the write
        if (create && /exist/i.test(String((e as Error)?.message))) return false;
        throw e;
      }
    },
  };
}

export function folderStore(dir: string): ShareStore {
  const file = (slug: string) => path.join(dir, slug + '.json');
  return {
    kind: 'folder',
    async read(slug) {
      try {
        return parse(await fs.readFile(file(slug), 'utf8'));
      } catch {
        return null;
      }
    },
    async write(record, { create }) {
      await fs.mkdir(dir, { recursive: true });
      try {
        await fs.writeFile(file(record.slug), JSON.stringify(record), { flag: create ? 'wx' : 'w' });
        return true;
      } catch (e) {
        if (create && (e as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw e;
      }
    },
  };
}

/** The store this deployment uses, or null when short links are off. Never throws on missing settings. */
export function resolveShareStore(env: Env = process.env): ShareStore | null {
  if (env.BLOB_READ_WRITE_TOKEN) return blobStore({ token: env.BLOB_READ_WRITE_TOKEN });
  if (env.BLOB_STORE_ID) return blobStore({ storeId: env.BLOB_STORE_ID });
  if (env.SHARE_STORE_DIR) return folderStore(path.resolve(env.SHARE_STORE_DIR));
  return null;
}
