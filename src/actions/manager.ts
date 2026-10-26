import { LocalDBAdapter } from '../adapters/local/index.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { generateUUID } from '../utils/uuid.js';
import { ActionStore, DEFAULT_ACTIONS_TABLE } from './store.js';
import {
  ActionFilterOptions,
  ActionHandler,
  ActionHandlerContext,
  ActionManagerOptions,
  ActionPruneOptions,
  ActionRecord,
  EmailHandler,
  EmailPayload,
  EnqueueActionOptions,
  FlushActionsResult,
  SendEmailOptions,
} from './types.js';

export class ActionManager {
  private db: LocalDBAdapter;
  private events: EventEmitter;
  private isOnlineFn: () => Promise<boolean>;
  private options: ActionManagerOptions;
  private tableName: string;
  private handlers = new Map<string, ActionHandler<any, any>>();
  private isFlushing = false;
  private flushRerunRequested = false;
  private networkUnsubscribe?: () => void;

  constructor(
    db: LocalDBAdapter,
    events: EventEmitter,
    isOnline: () => Promise<boolean>,
    options: ActionManagerOptions = {}
  ) {
    this.db = db;
    this.events = events;
    this.isOnlineFn = isOnline;
    this.options = {
      defaultMaxRetries: 3,
      autoFlushOnOnline: true,
      autoFlushOnEnqueue: false,
      ...options,
    };
    this.tableName = options.tableName || DEFAULT_ACTIONS_TABLE;

    if (this.options.network && this.options.autoFlushOnOnline) {
      let lastOnline: boolean | undefined = undefined;
      this.networkUnsubscribe = this.options.network.subscribe((online) => {
        if (online && lastOnline === false) {
          this.flush().catch(() => {});
        }
        lastOnline = online;
      });
    }
  }

  /**
   * Stops active network listeners.
   */
  stop(): void {
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = undefined;
    }
  }

  /**
   * Initializes the action store: creates tables/indexes and resets stale executing states.
   */
  async initialize(): Promise<void> {
    await ActionStore.ensureSchema(this.db, this.tableName);
    await ActionStore.resetStaleExecuting(this.db, this.tableName);
  }

  /**
   * Enqueues an asynchronous action with offline durability and idempotency checks.
   */
  async enqueue<TPayload = any, TResult = any>(
    opts: EnqueueActionOptions<TPayload>
  ): Promise<ActionRecord<TPayload, TResult>> {
    if (!opts.action || typeof opts.action !== 'string') {
      throw new Error('Action name is required and must be a string');
    }

    // 1. Idempotency check: if key already exists, return existing record
    if (opts.idempotencyKey) {
      const existing = await ActionStore.findByIdempotencyKey(this.db, this.tableName, opts.idempotencyKey);
      if (existing) {
        return existing as ActionRecord<TPayload, TResult>;
      }
    }

    const now = Date.now();
    const expiresAt =
      opts.expiresAt !== undefined
        ? opts.expiresAt
        : opts.ttlMs !== undefined
          ? now + opts.ttlMs
          : this.options.defaultTtlMs !== undefined
            ? now + this.options.defaultTtlMs
            : null;

    const record: ActionRecord<TPayload, TResult> = {
      id: generateUUID(),
      action: opts.action,
      payload: opts.payload,
      idempotencyKey: opts.idempotencyKey ?? null,
      status: 'PENDING',
      createdAt: now,
      expiresAt,
      executedAt: null,
      retryCount: 0,
      maxRetries: opts.maxRetries ?? this.options.defaultMaxRetries ?? 3,
      lastError: null,
      result: null,
    };

    await ActionStore.insertRecord(this.db, this.tableName, record);
    this.events.emit('action:enqueued', record);

    // Auto-flush if configured
    if (this.options.autoFlushOnEnqueue) {
      this.flush().catch(() => {});
    }

    return record;
  }

  /**
   * Convenience helper to enqueue a transactional email with offline resilience.
   */
  async sendEmail(options: SendEmailOptions): Promise<ActionRecord<EmailPayload, any>> {
    const { idempotencyKey, ttlMs, expiresAt, maxRetries, ...emailPayload } = options;

    if (!emailPayload.to) {
      throw new Error("Email 'to' recipient is required");
    }
    if (!emailPayload.subject) {
      throw new Error("Email 'subject' is required");
    }

    return this.enqueue<EmailPayload>({
      action: 'send_email',
      payload: emailPayload,
      idempotencyKey,
      ttlMs,
      expiresAt,
      maxRetries,
    });
  }

  /**
   * Registers a local executor for a specific action name.
   * Returns an unregister function.
   */
  registerHandler<TPayload = any, TResult = any>(
    action: string,
    handler: ActionHandler<TPayload, TResult>
  ): () => void {
    this.handlers.set(action, handler);
    return () => {
      if (this.handlers.get(action) === handler) {
        this.handlers.delete(action);
      }
    };
  }

  /**
   * Registers a dedicated handler for 'send_email' actions.
   */
  registerEmailHandler(handler: EmailHandler): () => void {
    return this.registerHandler<EmailPayload>('send_email', (record, context) =>
      handler(record.payload, record, context)
    );
  }

  /**
   * Flushes all pending actions whose handlers are registered locally.
   * Actions without a registered handler remain in the queue (e.g. to be synced to cloud functions).
   */
  private flushPromise?: Promise<FlushActionsResult>;

  /**
   * Flushes all pending actions whose handlers are registered locally.
   * Actions without a registered handler remain in the queue (e.g. to be synced to cloud functions).
   */
  async flush(): Promise<FlushActionsResult> {
    if (this.flushPromise) {
      this.flushRerunRequested = true;
      return this.flushPromise;
    }
    this.flushPromise = this.performFlush().finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  private async performFlush(): Promise<FlushActionsResult> {
    const result: FlushActionsResult = {
      processed: 0,
      completed: 0,
      failed: 0,
      expired: 0,
      skipped: 0,
    };

    try {
      do {
        this.flushRerunRequested = false;

        const online = await this.isOnline();
        if (!online) {
          break;
        }

        const pending = await ActionStore.getPending(this.db, this.tableName, 50);
        if (pending.length === 0) {
          break;
        }

        const context: ActionHandlerContext = {
          db: this.db,
          isOnline: this.isOnlineFn,
        };

        for (const action of pending) {
          result.processed++;
          const now = Date.now();

          // 1. Check TTL expiration
          if (action.expiresAt && action.expiresAt <= now) {
            await ActionStore.updateStatus(this.db, this.tableName, action.id, 'EXPIRED');
            const expiredRecord = { ...action, status: 'EXPIRED' as const };
            result.expired++;
            this.events.emit('action:expired', expiredRecord);
            continue;
          }

          // 2. Lookup handler
          const handler = this.handlers.get(action.action);
          if (!handler) {
            // No local handler; leave as PENDING for remote sync replication
            result.skipped++;
            continue;
          }

          // 3. Mark EXECUTING
          await ActionStore.updateStatus(this.db, this.tableName, action.id, 'EXECUTING');
          this.events.emit('action:executing', { ...action, status: 'EXECUTING' as const });

          // 4. Execute handler
          try {
            const res = await handler(action, context);
            const executedAt = Date.now();
            await ActionStore.updateStatus(this.db, this.tableName, action.id, 'COMPLETED', {
              executedAt,
              result: res ?? null,
            });
            result.completed++;
            this.events.emit('action:completed', {
              ...action,
              status: 'COMPLETED' as const,
              executedAt,
              result: res ?? null,
            });
          } catch (err: any) {
            const nextRetry = action.retryCount + 1;
            const isFinalFailure = nextRetry >= action.maxRetries;
            const newStatus = isFinalFailure ? 'FAILED' : 'PENDING';
            const errorMsg = err instanceof Error ? err.message : String(err);

            await ActionStore.updateStatus(this.db, this.tableName, action.id, newStatus, {
              retryCount: nextRetry,
              lastError: errorMsg,
            });

            if (isFinalFailure) {
              result.failed++;
              this.events.emit('action:failed', {
                ...action,
                status: 'FAILED' as const,
                retryCount: nextRetry,
                lastError: errorMsg,
              });
            } else {
              this.events.emit('action:retry', {
                ...action,
                status: 'PENDING' as const,
                retryCount: nextRetry,
                lastError: errorMsg,
              });
            }
          }
        }
      } while (this.flushRerunRequested);
    } finally {}

    return result;
  }

  /**
   * Retrieves an action record by ID.
   */
  async get(id: string): Promise<ActionRecord | null> {
    return ActionStore.findById(this.db, this.tableName, id);
  }

  /**
   * Lists action records with optional filtering.
   */
  async list(filter?: ActionFilterOptions): Promise<ActionRecord[]> {
    return ActionStore.list(this.db, this.tableName, filter);
  }

  /**
   * Cancels a pending action before it has been executed.
   */
  async cancel(id: string): Promise<boolean> {
    const cancelled = await ActionStore.cancel(this.db, this.tableName, id);
    if (cancelled) {
      this.events.emit('action:cancelled', { id });
    }
    return cancelled;
  }

  /**
   * Prunes completed, failed, expired, or cancelled actions from local storage.
   */
  async prune(options?: ActionPruneOptions): Promise<number> {
    return ActionStore.prune(this.db, this.tableName, options);
  }

  /**
   * Checks network connectivity via the configured provider.
   */
  async isOnline(): Promise<boolean> {
    try {
      return await this.isOnlineFn();
    } catch {
      return true;
    }
  }
}
