import { LocalDBAdapter } from '../adapters/local/index.js';
import { CustomLogger } from '../utils/logger.js';
import { NetworkStatusProvider } from '../core/types.js';

export type ActionSchemaValidator<T = any> =
  | ((payload: unknown) => T | boolean | Promise<T | boolean>)
  | {
      parse: (val: unknown) => T;
    }
  | {
      safeParse: (val: unknown) => { success: boolean; data?: T; error?: any };
    };

export interface ActionDefinition<TPayload = any, TResult = any> {
  name: string;
  schema?: ActionSchemaValidator<TPayload>;
  handler?: ActionHandler<TPayload, TResult>;
  maxRetries?: number;
  defaultTtlMs?: number;
}

export type ActionStatus =
  'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface ActionRecord<TPayload = any, TResult = any> {
  id: string;
  action: string;
  payload: TPayload;
  idempotencyKey?: string | null;
  status: ActionStatus;
  createdAt: number;
  expiresAt?: number | null;
  executedAt?: number | null;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  result?: TResult | null;
}

export interface EnqueueActionOptions<TPayload = any> {
  action: string;
  payload: TPayload;
  idempotencyKey?: string | null;
  ttlMs?: number;
  expiresAt?: number | null;
  maxRetries?: number;
}

export interface ActionHandlerContext {
  db: LocalDBAdapter;
  isOnline: () => Promise<boolean>;
}

export type ActionHandler<TPayload = any, TResult = any> = (
  action: ActionRecord<TPayload, TResult>,
  context: ActionHandlerContext,
) => Promise<TResult | void> | TResult | void;

export interface ActionFilterOptions {
  status?: ActionStatus | ActionStatus[];
  action?: string | string[];
  limit?: number;
  offset?: number;
}

export interface ActionPruneOptions {
  completedOlderThanMs?: number;
  failedOlderThanMs?: number;
  expiredOlderThanMs?: number;
  cancelledOlderThanMs?: number;
}

export interface FlushActionsResult {
  processed: number;
  completed: number;
  failed: number;
  expired: number;
  skipped: number;
}

export interface ActionRateLimitConfig {
  /** Maximum number of actions allowed per time window */
  max: number;
  /** Window duration in milliseconds (e.g. 1000 for 1 second) */
  windowMs: number;
}

export interface ActionManagerOptions {
  tableName?: string;
  defaultMaxRetries?: number;
  defaultTtlMs?: number;
  autoFlushOnOnline?: boolean;
  autoFlushOnEnqueue?: boolean;
  network?: NetworkStatusProvider;
  logger?: boolean | CustomLogger;
  /**
   * Maximum concurrent action executions during flush.
   * Default: 1 (strictly sequential). Set higher (e.g. 3 or 5) for parallel dispatch.
   */
  concurrency?: number;
  /**
   * Rate limiting throttle across action dispatches (e.g. { max: 10, windowMs: 1000 }).
   */
  rateLimit?: ActionRateLimitConfig;
}

export interface EmailAttachment {
  filename: string;
  content?: string;
  url?: string;
  contentType?: string;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  template?: string;
  templateData?: Record<string, any>;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  /** React Email component or JSX element to render automatically */
  react?: any;
  metadata?: Record<string, any>;
}

export interface SendEmailOptions extends EmailPayload {
  idempotencyKey?: string;
  ttlMs?: number;
  expiresAt?: number;
  maxRetries?: number;
}

export type EmailHandlerResult = {
  messageId?: string;
  [key: string]: any;
} | void;

export type EmailHandler = (
  email: EmailPayload,
  action: ActionRecord<EmailPayload, any>,
  context: ActionHandlerContext,
) => Promise<EmailHandlerResult> | EmailHandlerResult;
