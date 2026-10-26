export type BlobUploadStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export interface BlobRecord {
  id: string;
  key: string;
  name: string;
  mimeType: string;
  size: number;
  localPath: string;
  remoteUrl?: string | null;
  status: BlobUploadStatus;
  sha256?: string | null;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface SaveBlobOptions {
  name?: string;
  mimeType?: string;
  metadata?: Record<string, any>;
  /**
   * If true and an uploader is configured and online, triggers immediate upload.
   * Default: true
   */
  autoUpload?: boolean;
}

export interface FileDriver {
  write(key: string, data: Uint8Array): Promise<string>;
  read(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface RemoteStorageUploader {
  upload(blob: BlobRecord, data: Uint8Array): Promise<{ remoteUrl: string }>;
}

export interface BlobStorageManagerOptions {
  driver?: FileDriver;
  uploader?: RemoteStorageUploader;
  network?: { isOnline(): boolean | Promise<boolean> };
  tableName?: string;
}
