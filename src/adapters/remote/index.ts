import { SyncOperation, DeltaChanges } from '../../core/types.js';

export interface RemoteDBAdapter {
  pushChanges(operations: SyncOperation[]): Promise<boolean>;
  /** Return a complete batch through timestamp; reject on partial failure. */
  fetchChanges(sinceTimestamp: number): Promise<DeltaChanges>;
  /** Live events do not advance the durable pull checkpoint. Return cleanup when supported. */
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void | (() => void);
}

export * from './supabase.js';
export * from './demo.js';
export * from './convex.js';
export * from './firestore.js';