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
  getUri?(key: string): Promise<string> | string;
  copyFrom?(sourceUri: string, key: string): Promise<string>;
  downloadFrom?(remoteUrl: string, key: string): Promise<string>;
  getSize?(key: string): Promise<number>;
}

export interface RemoteStorageUploadResult {
  remoteUrl: string;
  storageId?: string;
  metadata?: Record<string, any>;
}

export interface RemoteStorageUploader {
  upload(blob: BlobRecord, data: Uint8Array): Promise<RemoteStorageUploadResult>;
  getDownloadUrl?(keyOrPath: string): Promise<string> | string;
  delete?(keyOrPath: string): Promise<void>;
}

export type StorageProviderType = 'supabase' | 'convex' | 'firebase';

export interface BlobStorageManagerOptions {
  driver?: FileDriver;
  uploader?: RemoteStorageUploader;
  network?: { isOnline(): boolean | Promise<boolean> };
  tableName?: string;
  /**
   * If true, calling delete(key) on BlobStorageManager will also attempt to delete
   * the asset from the remote storage uploader if supported. Default: false
   */
  deleteRemoteOnDelete?: boolean;
  /**
   * If true, automatically attempts to infer the storage uploader from the client's
   * remote database adapter (Supabase, Convex, or Firebase) if bucket/mutation options are provided.
   */
  autoRemote?: boolean;
  /** Optional bucket name for Supabase or Firebase Storage */
  bucket?: string;
  /** Optional mutation reference for Convex Storage */
  uploadMutation?: any;
  /** Additional provider-specific configuration */
  [key: string]: any;
}
