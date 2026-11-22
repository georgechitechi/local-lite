import { bytesToBase64 } from './expo.js';
import type {
  BlobRecord,
  RemoteStorageUploader,
  RemoteStorageUploadResult,
  StorageBucketRecord,
  StorageBucketVisibility,
} from './types.js';

export interface SelfHostedStorageUploaderOptions {
  /** Base URL of the self-hosted server (or getter returning it dynamically). */
  baseUrl: string | (() => string);
  /** Optional auth token resolver sent as `Authorization: Bearer <token>`. */
  getToken?: () =>
    Promise<string | null | undefined> | string | null | undefined;
  /** Optional custom fetch implementation. */
  fetch?: typeof fetch;
  /** Default bucket name when `blob.bucket` is not specified. Default: `'public'`. */
  defaultBucket?: string;
  /** Upload path relative to `baseUrl`. Default: `'/storage/upload'`. */
  uploadPath?: string;
  /** Files serving/delete prefix relative to `baseUrl`. Default: `'/storage/files'`. */
  filesPath?: string;
  /** Signed read URL path relative to `baseUrl`. Default: `'/storage/sign'`. */
  signPath?: string;
  /** Buckets management path relative to `baseUrl`. Default: `'/storage/buckets'`. */
  bucketsPath?: string;
  /** Move endpoint path relative to `baseUrl`. Default: `'/storage/move'`. */
  movePath?: string;
}

const BUCKET_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export class SelfHostedStorageUploader implements RemoteStorageUploader {
  private readonly defaultBucket: string;
  private readonly uploadPath: string;
  private readonly filesPath: string;
  private readonly signPath: string;
  private readonly bucketsPath: string;
  private readonly movePath: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: SelfHostedStorageUploaderOptions) {
    this.defaultBucket = options.defaultBucket?.trim() || 'public';
    this.uploadPath = options.uploadPath || '/storage/upload';
    this.filesPath = (options.filesPath || '/storage/files').replace(
      /\/+$/,
      '',
    );
    this.signPath = options.signPath || '/storage/sign';
    this.bucketsPath = options.bucketsPath || '/storage/buckets';
    this.movePath = options.movePath || '/storage/move';
    this.fetchFn = options.fetch || globalThis.fetch.bind(globalThis);
  }

  private getBaseUrl(): string {
    const raw =
      typeof this.options.baseUrl === 'function'
        ? this.options.baseUrl()
        : this.options.baseUrl;
    const base = String(raw || '')
      .trim()
      .replace(/\/+$/, '');
    if (!base) {
      throw new Error('Self-hosted storage baseUrl is not configured.');
    }
    return base;
  }

  private async getAuthHeaders(
    extra: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...extra };
    const token = this.options.getToken ? await this.options.getToken() : null;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private resolveBucketAndKey(blob: BlobRecord): {
    bucket: string;
    key: string;
  } {
    if (blob.bucket && BUCKET_SLUG_RE.test(blob.bucket.trim().toLowerCase())) {
      const bucket = blob.bucket.trim().toLowerCase();
      const key = blob.key.startsWith(`${bucket}/`)
        ? blob.key.slice(bucket.length + 1)
        : blob.key;
      return { bucket, key };
    }
    const slashIdx = blob.key.indexOf('/');
    const firstSeg = slashIdx > 0 ? blob.key.slice(0, slashIdx) : '';
    if (BUCKET_SLUG_RE.test(firstSeg)) {
      return { bucket: firstSeg, key: blob.key.slice(slashIdx + 1) };
    }
    return { bucket: this.defaultBucket, key: blob.key };
  }

  private normalizeKey(keyOrPath: string): string {
    let baseUrl = '';
    try {
      baseUrl = this.getBaseUrl();
    } catch {}
    let value = keyOrPath.trim();
    if (baseUrl && value.startsWith(baseUrl)) {
      value = value.slice(baseUrl.length);
    }
    const filesPrefix = `${this.filesPath}/`;
    if (value.startsWith(filesPrefix)) {
      value = value.slice(filesPrefix.length);
    }
    return value.replace(/^\/+/, '');
  }

  async upload(
    blob: BlobRecord,
    data: Uint8Array,
  ): Promise<RemoteStorageUploadResult> {
    const baseUrl = this.getBaseUrl();
    const { bucket, key } = this.resolveBucketAndKey(blob);
    const cleanName = blob.name.split('/').pop() || 'upload.bin';
    const headers = await this.getAuthHeaders({
      'Content-Type': 'application/json',
    });

    const res = await this.fetchFn(`${baseUrl}${this.uploadPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key,
        name: cleanName,
        bucket,
        mimeType: blob.mimeType || 'application/octet-stream',
        dataBase64: bytesToBase64(data),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(json.error || `Storage upload failed (${res.status})`);
    }

    const remotePath = String(
      json.remoteUrl || `${this.filesPath}/${bucket}/${key}`,
    );
    const remoteUrl = remotePath.startsWith('http')
      ? remotePath
      : `${baseUrl}${remotePath.startsWith('/') ? '' : '/'}${remotePath}`;

    return {
      remoteUrl,
      storageId: String(json.key || key),
      bucket: String(json.bucket || bucket),
    };
  }

  getDownloadUrl(keyOrPath: string): string {
    if (/^https?:\/\//i.test(keyOrPath)) return keyOrPath;
    let baseUrl = '';
    try {
      baseUrl = this.getBaseUrl();
    } catch {
      return keyOrPath;
    }
    const key = this.normalizeKey(keyOrPath);
    return `${baseUrl}${this.filesPath}/${key}`;
  }

  async getSignedUrl(
    keyOrPath: string,
    options?: { bucket?: string; expiresInSeconds?: number },
  ): Promise<{ url: string; expiresAt: number }> {
    const baseUrl = this.getBaseUrl();
    const key = this.normalizeKey(keyOrPath);
    const headers = await this.getAuthHeaders({
      'Content-Type': 'application/json',
    });
    const res = await this.fetchFn(`${baseUrl}${this.signPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key,
        bucket: options?.bucket,
        expiresInSeconds: options?.expiresInSeconds,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(json.error || `Sign URL failed (${res.status})`);
    }
    const rawUrl = String(json.url || '');
    const url = rawUrl.startsWith('http')
      ? rawUrl
      : `${baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    return { url, expiresAt: Number(json.expiresAt || 0) };
  }

  async delete(keyOrPath: string): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const key = this.normalizeKey(keyOrPath);
    if (!key) return;
    const headers = await this.getAuthHeaders();
    const res = await this.fetchFn(
      `${baseUrl}${this.filesPath}/${encodeURI(key)}`,
      { method: 'DELETE', headers },
    );
    if (!res.ok && res.status !== 404) {
      const json = (await res.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(json.error || `Storage delete failed (${res.status})`);
    }
  }

  async move(
    keyOrPath: string,
    toBucket: string,
    fromBucket?: string,
  ): Promise<RemoteStorageUploadResult> {
    const baseUrl = this.getBaseUrl();
    const key = this.normalizeKey(keyOrPath);
    const headers = await this.getAuthHeaders({
      'Content-Type': 'application/json',
    });
    const res = await this.fetchFn(`${baseUrl}${this.movePath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key, toBucket, fromBucket }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(json.error || `Storage move failed (${res.status})`);
    }
    const remotePath = String(
      json.remoteUrl || `${this.filesPath}/${toBucket}/${key}`,
    );
    const remoteUrl = remotePath.startsWith('http')
      ? remotePath
      : `${baseUrl}${remotePath.startsWith('/') ? '' : '/'}${remotePath}`;
    return {
      remoteUrl,
      storageId: String(json.key || key),
      bucket: String(json.bucket || toBucket),
    };
  }

  async listBuckets(): Promise<StorageBucketRecord[]> {
    const baseUrl = this.getBaseUrl();
    const headers = await this.getAuthHeaders();
    const res = await this.fetchFn(`${baseUrl}${this.bucketsPath}`, {
      method: 'GET',
      headers,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(json.error || `List buckets failed (${res.status})`);
    }
    return Array.isArray(json.buckets) ? json.buckets : [];
  }

  async createBucket(
    name: string,
    visibility: StorageBucketVisibility = 'public',
  ): Promise<StorageBucketRecord> {
    const baseUrl = this.getBaseUrl();
    const headers = await this.getAuthHeaders({
      'Content-Type': 'application/json',
    });
    const res = await this.fetchFn(`${baseUrl}${this.bucketsPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, visibility }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new Error(json.error || `Create bucket failed (${res.status})`);
    }
    return json.bucket;
  }

  async deleteBucket(name: string): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const headers = await this.getAuthHeaders();
    const res = await this.fetchFn(
      `${baseUrl}${this.bucketsPath}?name=${encodeURIComponent(name)}`,
      { method: 'DELETE', headers },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(json.error || `Delete bucket failed (${res.status})`);
    }
  }
}

export function createSelfHostedStorageUploader(
  options: SelfHostedStorageUploaderOptions,
): SelfHostedStorageUploader {
  return new SelfHostedStorageUploader(options);
}
