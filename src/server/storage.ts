import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type {
  StorageBucketRecord,
  StorageBucketVisibility,
} from '../storage/types.js';

export interface StorageAuthContext {
  userId: string;
  isAdmin?: boolean;
}

export interface StoredFileMeta {
  id: string;
  storageKey: string;
  bucket: string;
  userId?: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export interface StorageMetadataAdapter {
  getBucket(name: string): Promise<StorageBucketRecord | null>;
  listBuckets(): Promise<StorageBucketRecord[]>;
  createBucket(bucket: StorageBucketRecord): Promise<void>;
  deleteBucket(name: string): Promise<void>;
  countFilesInBucket(bucket: string): Promise<number>;
  upsertFile(file: StoredFileMeta): Promise<void>;
  getFile(storageKey: string, bucket?: string): Promise<StoredFileMeta | null>;
  updateFileBucket(storageKey: string, toBucket: string): Promise<void>;
  deleteFile(storageKey: string): Promise<void>;
}

export interface StorageEndpointOptions {
  /** Directory on disk where bucket subdirectories are stored. */
  uploadDir: string;
  /** Secret used to sign private read tokens (HMAC-SHA256). */
  signingSecret: string;
  /** Metadata persistence adapter for buckets and files. */
  metadata: StorageMetadataAdapter;
  /** Authenticates incoming requests for upload, sign, delete, move, and bucket management. */
  authenticate: (request: Request) => Promise<StorageAuthContext | null>;
  /** Optional base path prefix stripped before routing (default `'/storage'`). */
  basePath?: string;
  /** Max allowed upload size in bytes (default 10 MB). */
  maxUploadBytes?: number;
  /** Optional allowed MIME-to-extension map. */
  allowedMimeToExt?: Record<string, string>;
}

const DEFAULT_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const BUCKET_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function jsonErr(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

function normalizeBucket(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  return cleaned && BUCKET_RE.test(cleaned) ? cleaned : null;
}

function sanitizeKey(rawKey: string, fallbackExt: string): string {
  const cleaned = rawKey
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
  if (!cleaned) return `${crypto.randomUUID()}${fallbackExt}`;
  return path.extname(cleaned) ? cleaned : `${cleaned}${fallbackExt}`;
}

function safeResolve(uploadDir: string, relPath: string): string | null {
  if (!relPath || relPath.includes('..')) return null;
  const root = path.resolve(uploadDir);
  const resolved = path.resolve(root, relPath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : null;
}

function signToken(secret: string, payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const sig = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(
  secret: string,
  token: string,
): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Creates a self-hosted bucketed storage HTTP handler for `local-lite/server`.
 * Supports `/upload`, `/sign`, `/files/*`, `/move`, and `/buckets`.
 */
export function createStorageEndpoint(
  options: StorageEndpointOptions,
): (request: Request) => Promise<Response> {
  const uploadDir = path.resolve(options.uploadDir);
  const basePath = (options.basePath || '/storage').replace(/\/+$/, '');
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
  const allowedMimeToExt = options.allowedMimeToExt ?? DEFAULT_MIME_TO_EXT;
  const allowedExts = new Set(Object.values(allowedMimeToExt));

  async function resolveOrCreateBucket(raw: unknown): Promise<StorageBucketRecord> {
    const name = normalizeBucket(raw) || 'public';
    const existing = await options.metadata.getBucket(name);
    if (existing) return existing;
    const visibility: StorageBucketVisibility =
      name === 'private' || name === 'documents' ? 'private' : 'public';
    const created: StorageBucketRecord = {
      id: `bucket-${crypto.randomUUID().slice(0, 12)}`,
      name,
      visibility,
      createdAt: Date.now(),
    };
    await options.metadata.createBucket(created);
    return created;
  }

  async function findFile(relKey: string): Promise<StoredFileMeta | null> {
    const direct = await options.metadata.getFile(relKey);
    if (direct) return direct;
    const slashIdx = relKey.indexOf('/');
    if (slashIdx > 0) {
      const maybeBucket = normalizeBucket(relKey.slice(0, slashIdx));
      const subKey = relKey.slice(slashIdx + 1);
      if (maybeBucket && subKey) {
        return await options.metadata.getFile(subKey, maybeBucket);
      }
    }
    return null;
  }

  function resolveDiskPath(bucket: string, storageKey: string): string | null {
    const bucketed = safeResolve(uploadDir, `${bucket}/${storageKey}`);
    if (bucketed && fs.existsSync(bucketed)) return bucketed;
    const legacy = safeResolve(uploadDir, storageKey);
    if (legacy && fs.existsSync(legacy)) return legacy;
    return bucketed;
  }

  return async function handleStorageRequest(
    request: Request,
  ): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const subPath = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname;

    // 1. POST /upload
    if (subPath === '/upload' && method === 'POST') {
      const auth = await options.authenticate(request);
      if (!auth?.userId) return jsonErr('Unauthorized', 401);

      const contentType = (request.headers.get('content-type') || '').toLowerCase();
      let buffer: Buffer;
      let fileName = '';
      let mime = '';
      let rawKey = '';
      let rawBucket: unknown;

      if (contentType.includes('application/json')) {
        const body = (await request.json().catch(() => ({}))) as Record<string, any>;
        const b64 = typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : '';
        if (!b64) return jsonErr('File data is required.', 400);
        buffer = Buffer.from(b64, 'base64');
        fileName = typeof body.name === 'string' ? body.name.trim() : '';
        mime = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
        rawKey = String(body.key || '').trim();
        rawBucket = body.bucket;
      } else {
        const form = (await request.formData()) as any;
        const file = form.get('file');
        if (!file || typeof file.arrayBuffer !== 'function') {
          return jsonErr('File is required.', 400);
        }
        buffer = Buffer.from(await file.arrayBuffer());
        fileName = String(file.name || '').trim();
        mime = String(file.type || '').toLowerCase();
        rawKey = String(form.get('key') || '').trim();
        rawBucket = form.get('bucket');
      }

      if (buffer.length <= 0 || buffer.length > maxUploadBytes) {
        return jsonErr(`File size exceeds limit (${maxUploadBytes} bytes).`, 400);
      }

      const extFromMime = allowedMimeToExt[mime];
      const extFromName = path.extname(fileName || rawKey || '').toLowerCase();
      const ext =
        extFromMime ||
        (allowedExts.has(extFromName) || extFromName === '.jpeg'
          ? extFromName
          : undefined);
      if (!ext) {
        return jsonErr('Unsupported file type.', 400);
      }

      const bucketRec = await resolveOrCreateBucket(rawBucket);
      const trimmedKey = rawKey.startsWith(`${bucketRec.name}/`)
        ? rawKey.slice(bucketRec.name.length + 1)
        : rawKey;
      const storageKey = trimmedKey
        ? sanitizeKey(trimmedKey, ext)
        : `${auth.userId.replace(/[^a-zA-Z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext}`;

      const targetPath = safeResolve(uploadDir, `${bucketRec.name}/${storageKey}`);
      if (!targetPath) return jsonErr('Invalid storage key.', 400);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer);

      await options.metadata.upsertFile({
        id: crypto.randomUUID(),
        storageKey,
        bucket: bucketRec.name,
        userId: auth.userId,
        name: fileName || path.basename(storageKey),
        mimeType: EXT_TO_MIME[ext] || mime || 'application/octet-stream',
        sizeBytes: buffer.length,
        createdAt: Date.now(),
      });

      return Response.json(
        {
          key: storageKey,
          bucket: bucketRec.name,
          visibility: bucketRec.visibility,
          remoteUrl: `${basePath}/files/${bucketRec.name}/${storageKey}`,
          size: buffer.length,
        },
        { headers: JSON_HEADERS },
      );
    }

    // 2. POST /sign
    if (subPath === '/sign' && method === 'POST') {
      const auth = await options.authenticate(request);
      if (!auth?.userId) return jsonErr('Unauthorized', 401);
      const body = (await request.json().catch(() => ({}))) as Record<string, any>;
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (!key || !safeResolve(uploadDir, key)) {
        return jsonErr('Valid storage key is required.', 400);
      }
      const file = await findFile(key);
      const bucketRec = file
        ? await options.metadata.getBucket(file.bucket)
        : null;
      if (
        bucketRec?.visibility === 'private' &&
        file?.userId &&
        file.userId !== auth.userId &&
        !auth.isAdmin
      ) {
        return jsonErr('Forbidden', 403);
      }
      const ttlSec = Math.min(Math.max(Number(body.expiresInSeconds || 300), 30), 3600);
      const expiresAt = Date.now() + ttlSec * 1000;
      const token = signToken(options.signingSecret, { kind: 'read', key, exp: expiresAt });
      return Response.json(
        {
          url: `${basePath}/files/${encodeURIComponent(key).replace(/%2F/g, '/')}?token=${encodeURIComponent(token)}`,
          expiresAt,
        },
        { headers: JSON_HEADERS },
      );
    }

    // 3. POST /move
    if (subPath === '/move' && method === 'POST') {
      const auth = await options.authenticate(request);
      if (!auth?.userId) return jsonErr('Unauthorized', 401);
      const body = (await request.json().catch(() => ({}))) as Record<string, any>;
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      const toBucket = normalizeBucket(body.toBucket);
      if (!key || !toBucket) {
        return jsonErr('Valid key and toBucket are required.', 400);
      }
      const file = await findFile(key);
      if (!file) return jsonErr('Not Found', 404);
      if (file.userId && file.userId !== auth.userId && !auth.isAdmin) {
        return jsonErr('Forbidden', 403);
      }
      await resolveOrCreateBucket(toBucket);
      const srcPath = resolveDiskPath(file.bucket, file.storageKey);
      const dstPath = safeResolve(uploadDir, `${toBucket}/${file.storageKey}`);
      if (!srcPath || !dstPath || !fs.existsSync(srcPath)) {
        return jsonErr('File not found on disk.', 404);
      }
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.renameSync(srcPath, dstPath);
      await options.metadata.updateFileBucket(file.storageKey, toBucket);
      return Response.json(
        {
          ok: true,
          key: file.storageKey,
          bucket: toBucket,
          remoteUrl: `${basePath}/files/${toBucket}/${file.storageKey}`,
        },
        { headers: JSON_HEADERS },
      );
    }

    // 4. /buckets CRUD
    if (subPath === '/buckets') {
      const auth = await options.authenticate(request);
      if (!auth?.userId) return jsonErr('Unauthorized', 401);
      if (method === 'GET') {
        const buckets = await options.metadata.listBuckets();
        return Response.json({ buckets }, { headers: JSON_HEADERS });
      }
      if (method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Record<string, any>;
        const name = normalizeBucket(body.name);
        if (!name) return jsonErr('Invalid bucket name.', 400);
        const existing = await options.metadata.getBucket(name);
        if (existing) return jsonErr(`Bucket "${name}" already exists.`, 409);
        const visibility: StorageBucketVisibility =
          body.visibility === 'private' ? 'private' : 'public';
        const bucket: StorageBucketRecord = {
          id: `bucket-${crypto.randomUUID().slice(0, 12)}`,
          name,
          visibility,
          createdAt: Date.now(),
          fileCount: 0,
          totalBytes: 0,
        };
        await options.metadata.createBucket(bucket);
        fs.mkdirSync(path.join(uploadDir, name), { recursive: true });
        return Response.json({ ok: true, bucket }, { status: 201, headers: JSON_HEADERS });
      }
      if (method === 'DELETE') {
        const name = normalizeBucket(url.searchParams.get('name'));
        if (!name) return jsonErr('Valid bucket name is required.', 400);
        if (name === 'public' || name === 'private') {
          return jsonErr('Default buckets cannot be deleted.', 400);
        }
        const count = await options.metadata.countFilesInBucket(name);
        if (count > 0) return jsonErr(`Bucket "${name}" is not empty.`, 409);
        await options.metadata.deleteBucket(name);
        const dir = path.join(uploadDir, name);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        return Response.json({ deleted: true, bucket: name }, { headers: JSON_HEADERS });
      }
      return jsonErr('Method Not Allowed', 405);
    }

    // 5. /files/* (GET / HEAD / DELETE)
    if (subPath.startsWith('/files/')) {
      const relKey = decodeURIComponent(subPath.slice('/files/'.length));
      if (!relKey || relKey.includes('..')) return jsonErr('Not Found', 404);

      if (method === 'DELETE') {
        const auth = await options.authenticate(request);
        if (!auth?.userId) return jsonErr('Unauthorized', 401);
        const file = await findFile(relKey);
        if (file && file.userId && file.userId !== auth.userId && !auth.isAdmin) {
          return jsonErr('Forbidden', 403);
        }
        const disk = file
          ? resolveDiskPath(file.bucket, file.storageKey)
          : safeResolve(uploadDir, relKey);
        if (disk && fs.existsSync(disk)) fs.unlinkSync(disk);
        await options.metadata.deleteFile(file?.storageKey || relKey);
        return Response.json(
          { deleted: true, key: file?.storageKey || relKey },
          { headers: JSON_HEADERS },
        );
      }

      if (method === 'GET' || method === 'HEAD') {
        const file = await findFile(relKey);
        const bucketRec = file
          ? await options.metadata.getBucket(file.bucket)
          : null;
        const isPrivate =
          bucketRec?.visibility === 'private' || file?.bucket === 'private';

        const resolved = file
          ? resolveDiskPath(file.bucket, file.storageKey)
          : safeResolve(uploadDir, relKey);
        if (!resolved || !fs.existsSync(resolved)) {
          return jsonErr('Not Found', 404);
        }

        if (isPrivate) {
          const token = url.searchParams.get('token')?.trim() || '';
          const parsed = token ? verifyToken(options.signingSecret, token) : null;
          const ok =
            parsed?.kind === 'read' &&
            (parsed.key === relKey ||
              (file && parsed.key === file.storageKey) ||
              (file && parsed.key === `${file.bucket}/${file.storageKey}`));
          if (!ok) return jsonErr('Unauthorized', 401);
        }

        const stat = fs.statSync(resolved);
        const ext = path.extname(resolved).toLowerCase();
        const contentType = EXT_TO_MIME[ext] || 'application/octet-stream';
        const etag = `"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
        const cacheControl = isPrivate
          ? 'private, max-age=300'
          : 'public, max-age=31536000, immutable';
        if (request.headers.get('if-none-match') === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': cacheControl },
          });
        }
        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          ETag: etag,
          'Cache-Control': cacheControl,
          'X-Content-Type-Options': 'nosniff',
        };
        if (method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { ...headers, 'Content-Length': String(stat.size) },
          });
        }
        const stream = Readable.toWeb(
          fs.createReadStream(resolved),
        ) as ReadableStream;
        return new Response(stream, {
          status: 200,
          headers: { ...headers, 'Content-Length': String(stat.size) },
        });
      }
    }

    return jsonErr('Not Found', 404);
  };
}
