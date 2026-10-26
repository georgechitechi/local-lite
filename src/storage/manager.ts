import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { DBExecutable } from '../core/schema-manager.js';
import { generateUUID } from '../utils/uuid.js';
import {
  BlobRecord,
  BlobStorageManagerOptions,
  BlobUploadStatus,
  FileDriver,
  RemoteStorageUploader,
  SaveBlobOptions,
} from './types.js';
import { BlobStore, DEFAULT_BLOBS_TABLE } from './store.js';
import { MemoryFileDriver } from './driver.js';

export class BlobStorageManager {
  private driver: FileDriver;
  private uploader?: RemoteStorageUploader;
  private network?: { isOnline(): boolean | Promise<boolean> };
  private tableName: string;

  constructor(
    private db: DBExecutable,
    options: BlobStorageManagerOptions = {}
  ) {
    this.driver = options.driver ?? new MemoryFileDriver();
    this.uploader = options.uploader;
    this.network = options.network;
    this.tableName = options.tableName ?? DEFAULT_BLOBS_TABLE;
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
    options: SaveBlobOptions = {}
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
          await BlobStore.updateStatus(this.db, this.tableName, id, 'UPLOADING');
          const res = await this.uploader.upload(record, bytes);
          record.status = 'UPLOADED';
          record.remoteUrl = res.remoteUrl;
          await BlobStore.updateStatus(this.db, this.tableName, id, 'UPLOADED', res.remoteUrl);
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
  async get(key: string): Promise<{ record: BlobRecord; data: Uint8Array } | null> {
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
   * Lists blob metadata records, optionally filtered by upload status.
   */
  async list(status?: BlobUploadStatus): Promise<BlobRecord[]> {
    return await BlobStore.list(this.db, this.tableName, status);
  }

  /**
   * Deletes the blob binary and metadata record.
   */
  async delete(key: string): Promise<void> {
    await this.driver.delete(key);
    await BlobStore.deleteByKey(this.db, this.tableName, key);
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

        await BlobStore.updateStatus(this.db, this.tableName, item.id, 'UPLOADING');
        const res = await this.uploader.upload(item, data);
        await BlobStore.updateStatus(this.db, this.tableName, item.id, 'UPLOADED', res.remoteUrl);
        uploaded++;
      } catch {
        await BlobStore.updateStatus(this.db, this.tableName, item.id, 'FAILED');
        failed++;
      }
    }

    return { uploaded, failed };
  }
}
