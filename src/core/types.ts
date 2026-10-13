export type SyncOp = 'INSERT' | 'UPDATE' | 'DELETE';
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'FAILED';

export interface SyncOperation {
  id: string;
  tableName: string;
  rowId: string;
  operation: SyncOp;
  payload: Record<string, any> | null;
  timestamp: number;
}

export interface OutboxRecord extends SyncOperation {
  status: OutboxStatus;
  retryCount: number;
  lastError?: string | null;
}

export interface DeltaChange {
  tableName: string;
  operation: SyncOp;
  rowId: string;
  payload: Record<string, any> | null;
  timestamp?: number;
}

export interface DeltaChanges {
  timestamp: number;
  changes: DeltaChange[];
}

export type ConflictResolution = 'apply-remote' | 'keep-local' | { mergePayload: Record<string, any> };

export interface ConflictContext {
  tableName: string;
  rowId: string;
  remoteChange: DeltaChange;
  localOutboxRecord?: OutboxRecord;
  localRow?: Record<string, any> | null;
}

export type ConflictResolver = (context: ConflictContext) => ConflictResolution | Promise<ConflictResolution>;
export type ConflictStrategy = 'last-write-wins' | 'server-wins' | 'client-wins';

export interface NetworkStatusProvider {
  isOnline(): boolean | Promise<boolean>;
  subscribe(callback: (isOnline: boolean) => void): () => void;
}

export interface MutateOptions {
  primaryKey?: string;
  tx?: any;
  customTimestamp?: number;
  skipOutbox?: boolean;
}

export interface TableChangeEvent {
  operation: SyncOp;
  rowId: string;
  payload?: Record<string, any> | null;
  source: 'local' | 'remote';
}

export interface QueryOptions {
  where?: Record<string, any>;
  orderBy?: string;
  order?: 'asc' | 'desc' | 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}