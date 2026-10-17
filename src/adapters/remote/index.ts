import { SyncOperation, DeltaChanges, PushResult } from '../../core/types.js';

export interface RemoteDBAdapter {
  pushChanges(operations: SyncOperation[]): Promise<boolean | PushResult>;
  /** Return a complete batch through timestamp; reject on partial failure. Supports optional scope for data filtering. */
  fetchChanges(sinceTimestamp: number, scope?: Record<string, any>): Promise<DeltaChanges>;
  /** Live events do not advance the durable pull checkpoint. Return cleanup when supported. */
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void | (() => void);
}

export * from './supabase.js';
export * from './demo.js';
export * from './convex.js';
export * from './firestore.js';