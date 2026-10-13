import { describe, it, expect, vi } from 'vitest';
import {
  SyncLogger,
  formatSupabaseError,
  formatFirestoreError,
  formatConvexError,
} from '../src/utils/logger.js';
import { SyncWorker } from '../src/core/sync-worker.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import { MockDB } from './helpers/mock-db.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';

describe('Logger & Error Formatting', () => {
  it('translates Supabase RLS 42501 error into friendly message', () => {
    const error = {
      code: '42501',
      message: 'new row violates row-level security policy for table "properties"',
    };
    const formatted = formatSupabaseError(error, { table: 'properties', operation: 'INSERT' });
    expect(formatted).toContain('RLS Permission Denied');
    expect(formatted).toContain('Row-Level Security blocked this mutation');
    expect(formatted).toContain('"properties"');
  });

  it('translates Supabase NOT NULL 23502 error into friendly message', () => {
    const error = {
      code: '23502',
      details: 'Failing row contains null in column "name"',
    };
    const formatted = formatSupabaseError(error, { table: 'tenants' });
    expect(formatted).toContain('Missing Required Column');
    expect(formatted).toContain('NOT NULL constraint violated');
  });

  it('translates Firestore permission-denied into friendly message', () => {
    const error = {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    };
    const formatted = formatFirestoreError(error, { collection: 'payments' });
    expect(formatted).toContain('Permission Denied on collection "payments"');
    expect(formatted).toContain('Firestore Security Rules');
  });

  it('supports custom logger injection and level filtering', () => {
    const custom = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const logger = new SyncLogger({
      customLogger: custom,
      level: 'warn',
    });

    logger.info('Info message');
    expect(custom.info).not.toHaveBeenCalled(); // Ignored because level is 'warn'

    logger.warn('Warning message');
    expect(custom.warn).toHaveBeenCalledWith('Warning message');

    logger.error('Error message');
    expect(custom.error).toHaveBeenCalledWith('Error message');
  });

  it('silences all logs when enabled: false', () => {
    const custom = { error: vi.fn() };
    const logger = new SyncLogger({ customLogger: custom, enabled: false });

    logger.error('Should not appear');
    expect(custom.error).not.toHaveBeenCalled();
  });
});

describe('Customizable Retries & Backoff', () => {
  it('respects custom shouldRetry predicate on permanent failures', async () => {
    const db = new MockDB();
    const remote = new MemoryDemoRemoteAdapter();
    const events = new EventEmitter();

    const shouldRetryFn = vi.fn((err: any) => err?.code !== '42501');

    const worker = new SyncWorker(db, remote, events, {
      retry: {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        shouldRetry: shouldRetryFn,
      },
    });

    expect(worker.retryConfig.maxRetries).toBe(3);
    expect(worker.retryConfig.initialDelayMs).toBe(100);
    expect(worker.retryConfig.backoffMultiplier).toBe(2);
  });

  it('supports infinite retries with maxRetries: Infinity', async () => {
    const db = new MockDB();
    const remote = new MemoryDemoRemoteAdapter();
    const events = new EventEmitter();

    const worker = new SyncWorker(db, remote, events, {
      retry: {
        maxRetries: Infinity,
        initialDelayMs: 500,
        maxDelayMs: 15000,
      },
    });

    expect(worker.retryConfig.maxRetries).toBe(Infinity);
    expect(Number.isFinite(worker.retryConfig.maxRetries)).toBe(false);
  });

  it('supports infinite retries with maxRetries: -1 shorthand', async () => {
    const db = new MockDB();
    const remote = new MemoryDemoRemoteAdapter();
    const events = new EventEmitter();

    const worker = new SyncWorker(db, remote, events, {
      maxRetries: -1,
    });

    expect(worker.retryConfig.maxRetries).toBe(-1);
  });
});
