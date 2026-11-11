import { SyncOperation, DeltaChanges, PushResult } from '../../core/types.js';

export interface RemoteAutomationJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  locked?: boolean;
}

export interface RemoteBackupArchive {
  createdAt: number;
  status: string;
  fileName?: string;
  sizeBytes?: number;
  recordCount?: number;
  error?: string;
  downloadUrl: string | null;
}

export interface RemoteDBAdapter {
  pushChanges(operations: SyncOperation[]): Promise<boolean | PushResult>;
  /** Return a complete batch through timestamp; reject on partial failure. Supports optional scope for data filtering. */
  fetchChanges(sinceTimestamp: number, scope?: Record<string, any>): Promise<DeltaChanges>;
  /** Live events do not advance the durable pull checkpoint; return a cleanup function. */
  subscribeToLiveChanges(
    callback: (changes: DeltaChanges) => void,
    scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>),
  ): () => void;
  setSyncScope?(scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>)): void;

  /** Call a remote cloud action/function/RPC */
  call?<T = any>(functionName: string, args?: any): Promise<T>;
  /** Query a remote function or view */
  queryRemote?<T = any>(queryName: string, args?: any): Promise<T>;
  /** List cloud automated cron jobs */
  listAutomations?(): Promise<RemoteAutomationJob[]>;
  /** Enable or disable a cloud automated cron job */
  setAutomationEnabled?(jobId: string, enabled: boolean): Promise<void>;
  /** List remote cloud backup archive files */
  listBackups?(): Promise<RemoteBackupArchive[]>;
  /** Get a public or signed download URL for a cloud file/backup */
  getDownloadUrl?(fileIdOrKey: string): Promise<string | null>;
}

export * from './supabase.js';
export * from './demo.js';
export * from './convex.js';
export * from './firestore.js';
export * from './self-hosted.js';
