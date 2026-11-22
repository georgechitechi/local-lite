import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { DBExecutable } from '../core/schema-manager.js';
import { generateUUID } from '../utils/uuid.js';
import {
  BlobRecord,
  BlobStorageManagerOptions,
  BlobUploadStatus,
  FileDriver,
  ListBlobsOptions,
  RemoteStorageUploader,
  SaveBlobOptions,
  StorageBucketRecord,
  StorageBucketVisibility,
} from './types.js';
import { BlobStore, DEFAULT_BLOBS_TABLE } from './store.js';
import { MemoryFileDriver } from './driver.js';

export class BlobStorageManager {
  private driver: FileDriver;
  private uploader?: RemoteStorageUploader;
  private network?: { isOnline(): boolean | Promise<boolean> };
  private tableName: string;
  private deleteRemoteOnDelete: boolean;
  private defaultBucket: string;

  constructor(
    private db: DBExecutable,
    options: BlobStorageManagerOptions = {},
  ) {
    this.driver = options.driver ?? new MemoryFileDriver();
    this.uploader = options.uploader;
    this.network = options.network;
    this.tableName = options.tableName ?? DEFAULT_BLOBS_TABLE;
    this.deleteRemoteOnDelete = options.deleteRemoteOnDelete ?? false;
    this.defaultBucket = options.bucket?.trim() || 'public';
  }

  async initialize(): Promise<void> {
    await BlobStore.ensureSchema(this.db, this.tableName);
  }

  setDriver(driver: FileDriver): void {
    this.driver = driver;
  }

  setUploader(uploader: RemoteStorageUploader): void {
    this.uploader = uploader;
  }

  /**
   * Saves a binary blob or file locally. Records metadata in SQLite and writes binary to driver.
   * If online and uploader configured, can immediately trigger upload.
   */
  async save(
    key: string,
    data: Uint8Array | string,
    options: SaveBlobOptions = {},
  ): Promise<BlobRecord> {
    const bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
    const hash = bytesToHex(sha256(bytes));
    const now = Date.now();

    const localPath = await this.driver.write(key, bytes);

    const existing = await BlobStore.getByKey(this.db, this.tableName, key);
    const id = existing ? existing.id : generateUUID();

    const record: BlobRecord = {
      id,
      key,
      bucket: options.bucket?.trim() || existing?.bucket || this.defaultBucket,
      name: options.name || key.split('/').pop() || key,
      mimeType: options.mimeType || 'application/octet-stream',
      size: bytes.byteLength,
      localPath,
      remoteUrl: existing?.remoteUrl || null,
      status: 'PENDING',
      sha256: hash,
      metadata: options.metadata || existing?.metadata,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await BlobStore.insertOrUpdate(this.db, this.tableName, record);

    if (options.autoUpload !== false && this.uploader) {
      const isOnline = this.network ? await this.network.isOnline() : true;
      if (isOnline) {
        // Fire and update status
        try {
          await BlobStore.updateStatus(
            this.db,
            this.tableName,
            id,
            'UPLOADING',
          );
          const res = await this.uploader.upload(record, bytes);
          record.status = 'UPLOADED';
          record.remoteUrl = res.remoteUrl;
          await BlobStore.updateStatus(
            this.db,
            this.tableName,
            id,
            'UPLOADED',
            res.remoteUrl,
          );
        } catch {
          record.status = 'FAILED';
          await BlobStore.updateStatus(this.db, this.tableName, id, 'FAILED');
        }
      }
    }

    return record;
  }

  /**
   * Retrieves blob record and raw binary data.
   */
  async get(
    key: string,
  ): Promise<{ record: BlobRecord; data: Uint8Array } | null> {
    const record = await BlobStore.getByKey(this.db, this.tableName, key);
    if (!record) return null;

    const data = await this.driver.read(key);
    if (!data) return null;

    return { record, data };
  }

  /**
   * Reads raw binary data for key.
   */
  async getData(key: string): Promise<Uint8Array | null> {
    return await this.driver.read(key);
  }

  /**
   * Retrieves blob metadata record.
   */
  async getRecord(key: string): Promise<BlobRecord | null> {
    return await BlobStore.getByKey(this.db, this.tableName, key);
  }

  /**
   * Lists blob metadata records, optionally filtered by upload status and/or bucket.
   */
  async list(
    filter?: BlobUploadStatus | ListBlobsOptions,
  ): Promise<BlobRecord[]> {
    return await BlobStore.list(this.db, this.tableName, filter);
  }

  /**
   * Moves a stored blob to another bucket locally and remotely (when supported by the uploader).
   */
  async move(key: string, toBucket: string): Promise<BlobRecord | null> {
    const existing = await BlobStore.getByKey(this.db, this.tableName, key);
    if (!existing) return null;
    const targetBucket = toBucket.trim() || this.defaultBucket;
    let nextRemoteUrl = existing.remoteUrl;
    if (this.uploader && typeof this.uploader.move === 'function') {
      const res = await this.uploader.move(key, targetBucket, existing.bucket);
      nextRemoteUrl = res.remoteUrl;
    }
    await BlobStore.updateBucket(
      this.db,
      this.tableName,
      key,
      targetBucket,
      nextRemoteUrl,
    );
    return await BlobStore.getByKey(this.db, this.tableName, key);
  }

  /**
   * Requests a time-limited signed read URL for private bucket assets when supported by the uploader.
   */
  async getSignedUrl(
    key: string,
    options?: { bucket?: string; expiresInSeconds?: number },
  ): Promise<{ url: string; expiresAt: number } | null> {
    const record = await BlobStore.getByKey(this.db, this.tableName, key);
    const bucket = options?.bucket || record?.bucket || this.defaultBucket;
    if (this.uploader && typeof this.uploader.getSignedUrl === 'function') {
      return await this.uploader.getSignedUrl(key, {
        bucket,
        expiresInSeconds: options?.expiresInSeconds,
      });
    }
    const url = await this.getDownloadUrl(key);
    return url ? { url, expiresAt: 0 } : null;
  }

  /** Lists remote storage buckets when supported by the configured uploader. */
  async listBuckets(): Promise<StorageBucketRecord[]> {
    if (this.uploader && typeof this.uploader.listBuckets === 'function') {
      return await this.uploader.listBuckets();
    }
    return [];
  }

  /** Creates a remote storage bucket when supported by the configured uploader. */
  async createBucket(
    name: string,
    visibility: StorageBucketVisibility = 'public',
  ): Promise<StorageBucketRecord> {
    if (!this.uploader || typeof this.uploader.createBucket !== 'function') {
      throw new Error(
        'Configured storage uploader does not support createBucket.',
      );
    }
    return await this.uploader.createBucket(name, visibility);
  }

  /** Deletes an empty remote storage bucket when supported by the configured uploader. */
  async deleteBucket(name: string): Promise<void> {
    if (!this.uploader || typeof this.uploader.deleteBucket !== 'function') {
      throw new Error(
        'Configured storage uploader does not support deleteBucket.',
      );
    }
    await this.uploader.deleteBucket(name);
  }

  /**
   * Deletes the blob binary and metadata record.
   */
  async delete(key: string): Promise<void> {
    await this.driver.delete(key);
    await BlobStore.deleteByKey(this.db, this.tableName, key);

    if (
      this.deleteRemoteOnDelete &&
      this.uploader &&
      typeof this.uploader.delete === 'function'
    ) {
      try {
        await this.uploader.delete(key);
      } catch {}
    }
  }

  /**
   * Retrieves the remote download/serving URL for a stored blob key.
   */
  async getDownloadUrl(key: string): Promise<string | null> {
    const record = await BlobStore.getByKey(this.db, this.tableName, key);
    if (record?.remoteUrl) return record.remoteUrl;
    if (this.uploader && typeof this.uploader.getDownloadUrl === 'function') {
      try {
        return await this.uploader.getDownloadUrl(key);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Retrieves the local file path or URI (e.g. file:///... on mobile) for a stored blob key.
   * Ideal for React Native <Image source={{ uri }} /> without loading bytes into JS memory.
   */
  async getLocalUri(key: string): Promise<string | null> {
    const record = await BlobStore.getByKey(this.db, this.tableName, key);
    if (!record) return null;
    if (typeof this.driver.getUri === 'function') {
      return await this.driver.getUri(key);
    }
    return record.localPath;
  }

  /**
   * Directly imports a file from a local filesystem URI (e.g. expo-image-picker or expo-document-picker)
   * into local-lite managed storage without having to manually read and encode byte arrays in memory.
   */
  async saveFromUri(
    key: string,
    sourceUri: string,
    options: SaveBlobOptions = {},
  ): Promise<BlobRecord> {
    let localPath: string;
    let size = 0;
    let bytes: Uint8Array | null = null;

    if (typeof this.driver.copyFrom === 'function') {
      localPath = await this.driver.copyFrom(sourceUri, key);
      if (typeof this.driver.getSize === 'function') {
        size = await this.driver.getSize(key);
      }
    } else {
      const res = await fetch(sourceUri);
      const ab = await res.arrayBuffer();
      bytes = new Uint8Array(ab);
      size = bytes.byteLength;
      localPath = await this.driver.write(key, bytes);
    }

    const now = Date.now();
    const existing = await BlobStore.getByKey(this.db, this.tableName, key);
    const id = existing ? existing.id : generateUUID();

    const record: BlobRecord = {
      id,
      key,
      bucket: options.bucket?.trim() || existing?.bucket || this.defaultBucket,
      name: options.name || key.split('/').pop() || key,
      mimeType: options.mimeType || 'application/octet-stream',
      size,
      localPath,
      remoteUrl: existing?.remoteUrl || null,
      status: 'PENDING',
      metadata: options.metadata || existing?.metadata,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await BlobStore.insertOrUpdate(this.db, this.tableName, record);

    if (options.autoUpload !== false && this.uploader) {
      const isOnline = this.network ? await this.network.isOnline() : true;
      if (isOnline) {
        try {
          if (!bytes) {
            bytes = await this.driver.read(key);
          }
          if (bytes) {
            await BlobStore.updateStatus(
              this.db,
              this.tableName,
              id,
              'UPLOADING',
            );
            const res = await this.uploader.upload(record, bytes);
            record.status = 'UPLOADED';
            record.remoteUrl = res.remoteUrl;
            await BlobStore.updateStatus(
              this.db,
              this.tableName,
              id,
              'UPLOADED',
              res.remoteUrl,
            );
          }
        } catch {
          record.status = 'FAILED';
          await BlobStore.updateStatus(this.db, this.tableName, id, 'FAILED');
        }
      }
    }

    return record;
  }

  /**
   * Downloads a remote asset (e.g. from Supabase Storage) and saves it to local disk.
   * Caches metadata with status 'UPLOADED'.
   */
  async download(
    key: string,
    remoteUrl: string,
    options: SaveBlobOptions = {},
  ): Promise<BlobRecord> {
    let localPath: string;
    let size = 0;
    let hash: string | null = null;

    if (typeof this.driver.downloadFrom === 'function') {
      localPath = await this.driver.downloadFrom(remoteUrl, key);
      if (typeof this.driver.getSize === 'function') {
        size = await this.driver.getSize(key);
      }
    } else {
      const res = await fetch(remoteUrl);
      if (!res.ok) {
        throw new Error(
          `Failed to download blob from "${remoteUrl}": ${res.statusText}`,
        );
      }
      const ab = await res.arrayBuffer();
      const bytes = new Uint8Array(ab);
      size = bytes.byteLength;
      hash = bytesToHex(sha256(bytes));
      localPath = await this.driver.write(key, bytes);
    }

    const now = Date.now();
    const existing = await BlobStore.getByKey(this.db, this.tableName, key);
    const id = existing ? existing.id : generateUUID();

    const record: BlobRecord = {
      id,
      key,
      bucket: options.bucket?.trim() || existing?.bucket || this.defaultBucket,
      name: options.name || key.split('/').pop() || key,
      mimeType: options.mimeType || 'application/octet-stream',
      size,
      localPath,
      remoteUrl,
      status: 'UPLOADED',
      sha256: hash,
      metadata: options.metadata || existing?.metadata,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await BlobStore.insertOrUpdate(this.db, this.tableName, record);
    return record;
  }

  /**
   * Flushes and syncs pending or failed uploads to the remote storage uploader.
   */
  async syncPending(): Promise<{ uploaded: number; failed: number }> {
    if (!this.uploader) {
      return { uploaded: 0, failed: 0 };
    }

    const isOnline = this.network ? await this.network.isOnline() : true;
    if (!isOnline) {
      return { uploaded: 0, failed: 0 };
    }

    const pending = await BlobStore.list(this.db, this.tableName, 'PENDING');
    const failedList = await BlobStore.list(this.db, this.tableName, 'FAILED');
    const queue = [...pending, ...failedList];

    let uploaded = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        const data = await this.driver.read(item.key);
        if (!data) {
          failed++;
          continue;
        }

        await BlobStore.updateStatus(
          this.db,
          this.tableName,
          item.id,
          'UPLOADING',
        );
        const res = await this.uploader.upload(item, data);
        await BlobStore.updateStatus(
          this.db,
          this.tableName,
          item.id,
          'UPLOADED',
          res.remoteUrl,
        );
        uploaded++;
      } catch {
        await BlobStore.updateStatus(
          this.db,
          this.tableName,
          item.id,
          'FAILED',
        );
        failed++;
      }
    }

    return { uploaded, failed };
  }
}
