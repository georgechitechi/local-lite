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

export interface PushResult {
  success?: boolean;
  successfulIds?: string[];
  failedIds?: string[];
  errors?: Record<string, string>;
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

export interface RetryConfig {
  /** Maximum retry attempts before marking outbox record as permanently FAILED. Set to `Infinity` or `-1` for infinite retries. Default: 5 */
  maxRetries?: number;
  /** Initial delay before retrying failed operations in milliseconds. Default: 1000 */
  initialDelayMs?: number;
  /** Backoff multiplier applied on consecutive failures (e.g. 2 for exponential). Default: 1.5 */
  backoffMultiplier?: number;
  /** Maximum capped delay between retries in milliseconds. Default: 30000 */
  maxDelayMs?: number;
  /** Whether to apply randomized jitter (±20%) to backoff delays to prevent thundering herd. Default: true */
  jitter?: boolean;
  /** Custom predicate deciding whether an error is retryable. Return false for non-retryable errors like permanent RLS violations. */
  shouldRetry?: (error: any, operation: SyncOperation) => boolean;
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

/**
 * Filter operator comparison options for query predicates.
 */
export interface ComparisonOperator<T = any> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
  $null?: boolean;
}

export type FieldFilter<T = any> =
  | T
  | ComparisonOperator<T>
  | ((value: T) => boolean);

export type WhereFilter =
  | Record<string, FieldFilter>
  | ((row: Record<string, any>) => boolean)
  | {
      $or?: (Record<string, FieldFilter> | ((row: Record<string, any>) => boolean))[];
      $and?: (Record<string, FieldFilter> | ((row: Record<string, any>) => boolean))[];
      [key: string]: any;
    };

export interface QueryOptions {
  select?: string[];
  where?: WhereFilter;
  orderBy?: string;
  order?: 'asc' | 'desc' | 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

/**
 * Individual mutation descriptor for atomic batch execution.
 */
export interface BatchMutation {
  tableName: string;
  rowId?: string;
  operation: SyncOp;
  payload?: Record<string, any> | null;
  primaryKey?: string;
  skipOutbox?: boolean;
  customTimestamp?: number;
}

/**
 * Real-time operational telemetry metrics captured by the sync engine.
 */
export interface SyncMetrics {
  outboxPendingCount: number;
  outboxFailedCount: number;
  outboxProcessingCount: number;
  totalPushedOperations: number;
  totalPulledDeltas: number;
  totalPushCycles: number;
  totalPullCycles: number;
  lastPushDurationMs: number;
  lastPullDurationMs: number;
  lastPushTimestamp: number;
  lastPullTimestamp: number;
  lastPushError?: string | null;
  lastPullError?: string | null;
  isOnline: boolean;
  isPushing: boolean;
  isPulling: boolean;
}

export interface SyncStatusEvent {
  isOnline: boolean;
  isPushing: boolean;
  isPulling: boolean;
  pendingCount: number;
}

export interface PushEvent {
  success: boolean;
  count: number;
  durationMs: number;
  error?: string | null;
}

export interface PullEvent {
  success: boolean;
  changesCount: number;
  durationMs: number;
  timestamp: number;
  error?: string | null;
}

export interface ConflictEvent {
  tableName: string;
  rowId: string;
  resolution: string;
  timestamp: number;
}