import { RemoteDBAdapter } from './index.js';
import { DeltaChanges, PushResult, SyncOperation } from '../../core/types.js';

export interface SelfHostedRemoteAdapterOptions {
  /**
   * Endpoint base URL for the sync API (e.g. 'https://api.mycompany.com/api/sync').
   */
  url: string;

  /**
   * Optional secret or JWT auth token sent in `Authorization: Bearer <token>`.
   */
  token?: string;

  /**
   * List of tables to sync.
   */
  tables?: string[];

  /**
   * Custom HTTP request headers.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation (defaults to globalThis.fetch).
   */
  fetch?: typeof fetch;

  /**
   * Primary key field name (default: 'id').
   */
  primaryKey?: string;

  /**
   * Polling interval in milliseconds for live change detection. Default: 5000.
   */
  pollIntervalMs?: number;
}

/**
 * Universal client remote adapter for self-hosted local-lite sync backends.
 * Connects directly to server endpoints created via `createSyncEndpoint()` with zero vendor lock-in.
 */
export class SelfHostedRemoteAdapter implements RemoteDBAdapter {
  private url: string;
  private token?: string;
  private tables: string[];
  private customHeaders: Record<string, string>;
  private fetchFn: typeof fetch;
  private pollIntervalMs: number;
  private syncScope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
  private activeSubscribers = new Set<(changes: DeltaChanges) => void>();
  private pollTimer?: any;
  private lastPollCursor = 0;

  constructor(options: SelfHostedRemoteAdapterOptions) {
    if (!options.url) {
      throw new Error("A valid 'url' is required for SelfHostedRemoteAdapter.");
    }
    this.url = options.url.replace(/\/$/, '');
    this.token = options.token;
    this.tables = options.tables ?? [];
    this.customHeaders = options.headers ?? {};
    this.fetchFn = options.fetch || globalThis.fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;

    if (!this.fetchFn) {
      throw new Error('A global or configured fetch function is required for SelfHostedRemoteAdapter.');
    }
  }

  private getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Pushes client mutations to the self-hosted sync backend.
   */
  async pushChanges(operations: SyncOperation[]): Promise<PushResult> {
    if (operations.length === 0) {
      return { success: true, successfulIds: [] };
    }

    const response = await this.fetchFn(this.url, {
      method: 'POST',
      headers: this.getRequestHeaders(),
      body: JSON.stringify({ operations }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Self-hosted sync push failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      success: true,
      successfulIds: data.successfulIds ?? operations.map((op) => op.id),
    };
  }

  /**
   * Pulls delta changes from the self-hosted sync backend since a given timestamp or cursor.
   */
  async fetchChanges(sinceTimestamp: number, _scope?: Record<string, any>): Promise<DeltaChanges> {
    const tablesParam = encodeURIComponent(this.tables.join(','));
    const url = `${this.url}?tables=${tablesParam}&since=${encodeURIComponent(String(sinceTimestamp))}`;

    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: this.getRequestHeaders(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Self-hosted sync pull failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    this.lastPollCursor = Math.max(this.lastPollCursor, data.cursor ?? sinceTimestamp);
    return data.changes ?? { timestamp: Date.now(), changes: [] };
  }

  /**
   * Subscribes to live server changes via periodic polling.
   */
  subscribeToLiveChanges(
    callback: (changes: DeltaChanges) => void,
    scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>)
  ): () => void {
    if (scope) {
      this.syncScope = scope;
    }
    this.activeSubscribers.add(callback);

    if (!this.pollTimer) {
      this.startPolling();
    }

    return () => {
      this.activeSubscribers.delete(callback);
      if (this.activeSubscribers.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    };
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      if (this.activeSubscribers.size === 0) return;
      try {
        const changes = await this.fetchChanges(this.lastPollCursor);
        const hasChanges = Object.values(changes).some((rows) => Array.isArray(rows) && rows.length > 0);
        if (hasChanges) {
          for (const subscriber of this.activeSubscribers) {
            try {
              subscriber(changes);
            } catch {}
          }
        }
      } catch {}
    }, this.pollIntervalMs);
  }

  setSyncScope(scope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>)): void {
    this.syncScope = scope;
  }

  /**
   * Executes a remote function call or RPC across self-hosted endpoints.
   */
  async call<T = any>(functionName: string, args: Record<string, any> = {}): Promise<T> {
    const actionEndpoints: Record<string, string> = {
      'payments/stk': '/payments/stk',
      'contracts/renewal': '/contracts/renewal',
      'contracts/termination': '/contracts/termination',
      'tenant-self-service': '/tenant-self-service',
      'email': '/email',
    };
    const normalized = functionName
      .replace(/^functions\//, '')
      .replace('contracts:sendRenewalReminder', 'contracts/renewal')
      .replace('contracts:sendTerminationNotice', 'contracts/termination')
      .replace('payments:initiateDaraja', 'payments/stk')
      .replace('tenantSelfService:createSelfServiceLink', 'tenant-self-service')
      .replace('email:send', 'email')
      .replace(':', '/');
    const endpoint = actionEndpoints[normalized] || `/${normalized}`;
    const fullUrl = `${this.url}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const response = await this.fetchFn(fullUrl, {
      method: 'POST',
      headers: this.getRequestHeaders(),
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Self-hosted function call "${functionName}" failed (${response.status}): ${errText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }
}
