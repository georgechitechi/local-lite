export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface CustomLogger {
  debug?(message: string, ...args: any[]): void;
  info?(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
  error?(message: string, ...args: any[]): void;
}

export interface LoggerConfig {
  level?: LogLevel;
  customLogger?: CustomLogger;
  enabled?: boolean;
}

const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class SyncLogger {
  private level: LogLevel = 'info';
  private customLogger?: CustomLogger;
  private enabled: boolean = true;

  constructor(config?: LoggerConfig | boolean) {
    if (typeof config === 'boolean') {
      this.enabled = config;
    } else if (config) {
      if (config.enabled !== undefined) this.enabled = config.enabled;
      if (config.level) this.level = config.level;
      if (config.customLogger) this.customLogger = config.customLogger;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setCustomLogger(logger?: CustomLogger): void {
    this.customLogger = logger;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled || this.level === 'silent') return false;
    return LOG_LEVEL_WEIGHTS[level] >= LOG_LEVEL_WEIGHTS[this.level];
  }

  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    if (this.customLogger?.debug) {
      this.customLogger.debug(message, ...args);
    } else {
      console.debug(`[local-lite] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    if (this.customLogger?.info) {
      this.customLogger.info(message, ...args);
    } else {
      console.info(`[local-lite] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    if (this.customLogger?.warn) {
      this.customLogger.warn(message, ...args);
    } else {
      console.warn(`[local-lite] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    if (message.includes('Network Offline') || message.includes('Failed to reach')) {
      this.warn(message, ...args);
      return;
    }
    if (this.customLogger?.error) {
      this.customLogger.error(message, ...args);
    } else {
      console.error(`[local-lite] ${message}`, ...args);
    }
  }
}

/**
 * Global default logger instance.
 */
export const defaultLogger = new SyncLogger();

/**
 * Factory to create or resolve a SyncLogger from boolean, config, or existing logger.
 */
export function createSyncLogger(
  logger?: SyncLogger | CustomLogger | boolean,
  logLevel?: LogLevel
): SyncLogger {
  if (logger instanceof SyncLogger) {
    return logger;
  }
  if (typeof logger === 'boolean') {
    return new SyncLogger({ enabled: logger, level: logLevel });
  }
  if (logger && typeof logger === 'object') {
    return new SyncLogger({ customLogger: logger, level: logLevel });
  }
  return logLevel ? new SyncLogger({ level: logLevel }) : defaultLogger;
}

/**
 * Translates PostgreSQL / Supabase PostgREST error codes into actionable, human-readable explanations.
 */
export function formatSupabaseError(
  error: any,
  context: { table?: string; operation?: string } = {}
): string {
  if (!error) return 'Unknown Supabase error';
  const table = context.table ? `"${context.table}"` : 'table';
  const op = context.operation ? ` (${context.operation})` : '';
  const code = String(error.code || error.status || '').trim();
  const rawMsg = error.message || error.details || String(error);

  // PostgreSQL RLS 42501 (insufficient_privilege)
  if (code === '42501' || rawMsg.toLowerCase().includes('row-level security')) {
    return `🔒 RLS Permission Denied on ${table}${op}: Row-Level Security blocked this mutation. Check that the user is authenticated and matching RLS policies exist on Postgres.`;
  }

  // PostgreSQL 23502 (not_null_violation)
  if (code === '23502') {
    const hint = error.details || rawMsg;
    return `⚠️ Missing Required Column on ${table}${op}: NOT NULL constraint violated. (${hint})`;
  }

  // PostgreSQL 23505 (unique_violation)
  if (code === '23505') {
    const hint = error.details || rawMsg;
    return `⚠️ Duplicate Key on ${table}${op}: Unique constraint violated. (${hint})`;
  }

  // PostgreSQL 23503 (foreign_key_violation)
  if (code === '23503') {
    const hint = error.details || rawMsg;
    return `⚠️ Foreign Key Missing on ${table}${op}: Referenced relation does not exist. (${hint})`;
  }

  // Supabase Auth / JWT expired (PGRST301, JWT expired)
  if (code === 'PGRST301' || rawMsg.toLowerCase().includes('jwt')) {
    return `🔑 Session Expired on ${table}${op}: Supabase auth token is invalid or expired.`;
  }

  // Network / Offline errors
  if (
    rawMsg.toLowerCase().includes('fetch failed') ||
    rawMsg.toLowerCase().includes('enotfound') ||
    rawMsg.toLowerCase().includes('network')
  ) {
    return `📡 Network Offline: Failed to reach Supabase backend. Mutations safely preserved in local SQLite outbox.`;
  }

  return `❌ Supabase error on ${table}${op} [code: ${code || 'N/A'}]: ${rawMsg}`;
}

/**
 * Translates Firestore error codes into human-readable explanations.
 */
export function formatFirestoreError(
  error: any,
  context: { collection?: string; operation?: string } = {}
): string {
  if (!error) return 'Unknown Firestore error';
  const collection = context.collection ? `"${context.collection}"` : 'collection';
  const op = context.operation ? ` (${context.operation})` : '';
  const code = String(error.code || '').toLowerCase();
  const rawMsg = error.message || String(error);

  if (code.includes('permission-denied') || rawMsg.toLowerCase().includes('insufficient permissions')) {
    return `🔒 Permission Denied on collection ${collection}${op}: Check your Firestore Security Rules.`;
  }

  if (code.includes('unauthenticated')) {
    return `🔑 Unauthenticated on collection ${collection}${op}: User must be signed into Firebase Auth.`;
  }

  if (code.includes('unavailable') || rawMsg.toLowerCase().includes('network')) {
    return `📡 Firestore Offline: Backend unreachable. Mutations preserved in local SQLite outbox.`;
  }

  return `❌ Firestore error on ${collection}${op}: ${rawMsg}`;
}

/**
 * Translates Convex error codes into human-readable explanations.
 */
export function formatConvexError(
  error: any,
  context: { table?: string; operation?: string } = {}
): string {
  if (!error) return 'Unknown Convex error';
  const table = context.table ? `"${context.table}"` : 'table';
  const op = context.operation ? ` (${context.operation})` : '';
  const rawMsg = error.message || String(error);

  if (rawMsg.toLowerCase().includes('unauthorized') || rawMsg.toLowerCase().includes('unauthenticated')) {
    return `🔒 Convex Permission Denied on ${table}${op}: Request unauthorized.`;
  }

  if (rawMsg.toLowerCase().includes('network') || rawMsg.toLowerCase().includes('failed to fetch')) {
    return `📡 Convex Offline: Server unreachable. Mutations preserved in local SQLite outbox.`;
  }

  return `❌ Convex error on ${table}${op}: ${rawMsg}`;
}
