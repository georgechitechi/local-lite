import { LocalDBAdapter } from '../adapters/local/index.js';
import { CustomLogger } from '../utils/logger.js';
import { NetworkStatusProvider } from '../core/types.js';

export type ActionStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

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
  context: ActionHandlerContext
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

export interface ActionManagerOptions {
  tableName?: string;
  defaultMaxRetries?: number;
  defaultTtlMs?: number;
  autoFlushOnOnline?: boolean;
  autoFlushOnEnqueue?: boolean;
  network?: NetworkStatusProvider;
  logger?: boolean | CustomLogger;
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
  metadata?: Record<string, any>;
}

export interface SendEmailOptions extends EmailPayload {
  idempotencyKey?: string;
  ttlMs?: number;
  expiresAt?: number;
  maxRetries?: number;
}

export type EmailHandlerResult = { messageId?: string; [key: string]: any } | void;

export type EmailHandler = (
  email: EmailPayload,
  action: ActionRecord<EmailPayload, any>,
  context: ActionHandlerContext
) => Promise<EmailHandlerResult> | EmailHandlerResult;
