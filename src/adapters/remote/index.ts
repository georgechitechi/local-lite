import { SyncOperation, DeltaChanges } from '../../core/types.js';

export interface RemoteDBAdapter {
  pushChanges(operations: SyncOperation[]): Promise<boolean>;
  fetchChanges(sinceTimestamp: number): Promise<DeltaChanges>;
  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void;
}

export * from './supabase.js';
export * from './demo.js';