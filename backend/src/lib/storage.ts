import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";

/**
 * Storage is behind an interface so swapping the local-disk implementation
 * for an S3-compatible client (AWS S3, Cloudflare R2, MinIO) is a matter of
 * writing one new class — nothing in the files module or its callers
 * changes. `put` returns an opaque storageKey; `url` turns that key back
 * into something a client can fetch (a signed URL for cloud storage, a
 * static route for local disk).
 */
export interface StorageAdapter {
  put(buffer: Buffer, originalFilename: string): Promise<string>;
  url(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
}

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

class LocalStorageAdapter implements StorageAdapter {
  async put(buffer: Buffer, originalFilename: string): Promise<string> {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(originalFilename);
    const key = `${nanoid()}${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, key), buffer);
    return key;
  }

  url(storageKey: string): string {
    return `/uploads/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    await fs.unlink(path.join(UPLOAD_DIR, storageKey)).catch(() => undefined);
  }
}

// Swap point: in production, `STORAGE_DRIVER=s3` would select an
// S3StorageAdapter here instead. Everything downstream is unaffected.
export const storage: StorageAdapter = new LocalStorageAdapter();
