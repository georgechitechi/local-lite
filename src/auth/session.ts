import { DBExecutable } from '../core/schema-manager.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { generateUUID } from '../utils/uuid.js';

export const DEFAULT_SESSIONS_TABLE = '_local_sessions';
export const DEFAULT_OFFLINE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export interface SessionRecord<TUser = any> {
  id: string;
  userId: string;
  user: TUser;
  token?: string | null;
  refreshToken?: string | null;
  provider?: string | null;
  createdAt: number;
  lastActiveAt: number;
  expiresAt?: number | null;
  offlineAccessUntil?: number | null;
  metadata?: Record<string, any> | null;
  isActive: boolean;
}

export interface CreateSessionOptions<TUser = any> {
  id?: string;
  userId: string;
  user: TUser;
  token?: string | null;
  refreshToken?: string | null;
  provider?: string | null;
  expiresAt?: number | null;
  /**
   * Duration in ms the session remains valid while offline without re-authenticating.
   * Default: 30 days. Set to 0 or Infinity for unlimited offline access.
   */
  offlineDurationMs?: number;
  metadata?: Record<string, any>;
  /**
   * Whether to activate this session as the active user immediately.
   * Default: true
   */
  setActive?: boolean;
}

export interface SessionManagerOptions {
  tableName?: string;
  defaultOfflineDurationMs?: number;
  network?: { isOnline(): boolean | Promise<boolean> };
}

export function mapSessionRow<TUser = any>(r: any): SessionRecord<TUser> {
  let userData: TUser;
  try {
    userData = typeof r.user_data === 'string' ? JSON.parse(r.user_data) : r.user_data;
  } catch {
    userData = r.user_data as TUser;
  }

  let metadata: Record<string, any> | null = null;
  if (r.metadata) {
    try {
      metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
    } catch {
      metadata = null;
    }
  }

  return {
    id: String(r.id),
    userId: String(r.user_id),
    user: userData,
    token: r.token || null,
    refreshToken: r.refresh_token || null,
    provider: r.provider || null,
    createdAt: Number(r.created_at || 0),
    lastActiveAt: Number(r.last_active_at || 0),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    offlineAccessUntil: r.offline_access_until != null ? Number(r.offline_access_until) : null,
    metadata,
    isActive: r.is_active === 1 || r.is_active === '1' || r.is_active === true,
  };
}

export class SessionManager {
  private tableName: string;
  private sqlTableName: string;
  private sqlUserIndexName: string;
  private sqlActiveIndexName: string;
  private defaultOfflineDurationMs: number;
  private network?: { isOnline(): boolean | Promise<boolean> };

  constructor(
    private db: DBExecutable,
    private events?: EventEmitter,
    options: SessionManagerOptions = {}
  ) {
    this.tableName = options.tableName ?? DEFAULT_SESSIONS_TABLE;
    this.sqlTableName = quoteIdentifier(this.tableName);
    this.sqlUserIndexName = quoteIdentifier(`idx_${this.tableName}_user`);
    this.sqlActiveIndexName = quoteIdentifier(`idx_${this.tableName}_active`);
    this.defaultOfflineDurationMs = options.defaultOfflineDurationMs ?? DEFAULT_OFFLINE_DURATION_MS;
    this.network = options.network;
  }

  /**
   * Ensures the _local_sessions schema exists.
   */
  async initialize(): Promise<void> {
    await this.db.execute(
      `CREATE TABLE IF NOT EXISTS ${this.sqlTableName} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_data TEXT NOT NULL,
        token TEXT,
        refresh_token TEXT,
        provider TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER,
        offline_access_until INTEGER,
        metadata TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      );`
    );

    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS ${this.sqlUserIndexName} ON ${this.sqlTableName} (user_id);`
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS ${this.sqlActiveIndexName} ON ${this.sqlTableName} (is_active);`
    );
  }

  /**
   * Creates or updates a user session, persisting it to local SQLite so it remains available offline.
   */
  async createSession<TUser = any>(options: CreateSessionOptions<TUser>): Promise<SessionRecord<TUser>> {
    const id = options.id || `sess_${generateUUID()}`;
    const now = Date.now();
    const offlineDuration =
      options.offlineDurationMs !== undefined
        ? options.offlineDurationMs
        : this.defaultOfflineDurationMs;

    const offlineAccessUntil =
      offlineDuration === 0 || offlineDuration === Infinity
        ? null
        : now + offlineDuration;

    const setActive = options.setActive !== false;
    const userDataStr = JSON.stringify(options.user ?? {});
    const metadataStr = options.metadata ? JSON.stringify(options.metadata) : null;

    if (setActive) {
      // Deactivate other sessions
      await this.db.execute(`UPDATE ${this.sqlTableName} SET is_active = ?;`, [0]);
    }

    const sql = `
      INSERT INTO ${this.sqlTableName} (id, user_id, user_data, token, refresh_token, provider, created_at, last_active_at, expires_at, offline_access_until, metadata, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        user_data = excluded.user_data,
        token = excluded.token,
        refresh_token = excluded.refresh_token,
        provider = excluded.provider,
        last_active_at = excluded.last_active_at,
        expires_at = excluded.expires_at,
        offline_access_until = excluded.offline_access_until,
        metadata = excluded.metadata,
        is_active = excluded.is_active;
    `;

    await this.db.execute(sql, [
      id,
      options.userId,
      userDataStr,
      options.token ?? null,
      options.refreshToken ?? null,
      options.provider ?? null,
      now,
      now,
      options.expiresAt ?? null,
      offlineAccessUntil,
      metadataStr,
      setActive ? 1 : 0,
    ]);

    const session: SessionRecord<TUser> = {
      id,
      userId: options.userId,
      user: options.user,
      token: options.token || null,
      refreshToken: options.refreshToken || null,
      provider: options.provider || null,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: options.expiresAt || null,
      offlineAccessUntil,
      metadata: options.metadata || null,
      isActive: setActive,
    };

    this.events?.emit(this.tableName, { operation: 'SET_SESSION', session });
    return session;
  }

  /**
   * Retrieves the currently active session.
   * If offline, the session remains active even if server tokens expired, as long as offlineAccessUntil is valid.
   */
  async getActiveSession<TUser = any>(): Promise<SessionRecord<TUser> | null> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlTableName} WHERE is_active = ? LIMIT 1;`,
      [1]
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const session = mapSessionRow<TUser>(rows[0]);
    const now = Date.now();

    // Check if offline access grace period has expired
    if (session.offlineAccessUntil != null && now > session.offlineAccessUntil) {
      await this.clearSession();
      return null;
    }

    // Touch last active
    await this.touch(session.id);
    return session;
  }

  /**
   * Returns true if there is an active valid session (works offline and online).
   */
  async isAuthenticated(): Promise<boolean> {
    const session = await this.getActiveSession();
    return session !== null;
  }

  /**
   * Retrieves the authenticated user profile object, or null if signed out.
   */
  async getUser<TUser = any>(): Promise<TUser | null> {
    const session = await this.getActiveSession<TUser>();
    return session ? session.user : null;
  }

  /**
   * Updates last active timestamp.
   */
  async touch(sessionId?: string): Promise<void> {
    const now = Date.now();
    if (sessionId) {
      await this.db.execute(
        `UPDATE ${this.sqlTableName} SET last_active_at = ? WHERE id = ?;`,
        [now, sessionId]
      );
    } else {
      await this.db.execute(
        `UPDATE ${this.sqlTableName} SET last_active_at = ? WHERE is_active = ?;`,
        [now, 1]
      );
    }
  }

  /**
   * Partially updates the active user's profile data in SQLite.
   */
  async updateUser<TUser = any>(partialUser: Partial<TUser>): Promise<SessionRecord<TUser> | null> {
    const session = await this.getActiveSession<TUser>();
    if (!session) return null;

    const updatedUser = {
      ...session.user,
      ...partialUser,
    };

    const userDataStr = JSON.stringify(updatedUser);
    const now = Date.now();

    await this.db.execute(
      `UPDATE ${this.sqlTableName} SET user_data = ?, last_active_at = ? WHERE id = ?;`,
      [userDataStr, now, session.id]
    );

    session.user = updatedUser;
    session.lastActiveAt = now;

    this.events?.emit(this.tableName, { operation: 'UPDATE_USER', session });
    return session;
  }

  /**
   * Updates access tokens without re-authenticating or resetting the offline grace period.
   */
  async updateTokens(tokens: {
    token?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
  }): Promise<void> {
    const session = await this.getActiveSession();
    if (!session) return;

    const token = tokens.token !== undefined ? tokens.token : session.token;
    const refreshToken = tokens.refreshToken !== undefined ? tokens.refreshToken : session.refreshToken;
    const expiresAt = tokens.expiresAt !== undefined ? tokens.expiresAt : session.expiresAt;
    const now = Date.now();

    await this.db.execute(
      `UPDATE ${this.sqlTableName} SET token = ?, refresh_token = ?, expires_at = ?, last_active_at = ? WHERE id = ?;`,
      [token, refreshToken, expiresAt, now, session.id]
    );

    session.token = token;
    session.refreshToken = refreshToken;
    session.expiresAt = expiresAt;

    this.events?.emit(this.tableName, { operation: 'UPDATE_TOKENS', session });
  }

  /**
   * Signs out the active user session.
   */
  async clearSession(): Promise<void> {
    await this.db.execute(`UPDATE ${this.sqlTableName} SET is_active = ? WHERE is_active = ?;`, [0, 1]);
    this.events?.emit(this.tableName, { operation: 'CLEAR_SESSION' });
  }

  /**
   * Completely purges all stored sessions (e.g. factory reset or privacy wipe).
   */
  async purgeAllSessions(): Promise<void> {
    await this.db.execute(`DELETE FROM ${this.sqlTableName};`);
    this.events?.emit(this.tableName, { operation: 'PURGE_SESSIONS' });
  }

  /**
   * Lists all sessions currently cached in SQLite.
   */
  async listSessions<TUser = any>(): Promise<SessionRecord<TUser>[]> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlTableName} ORDER BY last_active_at DESC;`
    );
    return (rows || []).map((r) => mapSessionRow<TUser>(r));
  }

  /**
   * Switches the active session to a different account (e.g., multi-account or organization switching offline).
   */
  async switchSession<TUser = any>(sessionIdOrUserId: string): Promise<SessionRecord<TUser> | null> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlTableName} WHERE id = ? OR user_id = ? LIMIT 1;`,
      [sessionIdOrUserId, sessionIdOrUserId]
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const targetSession = mapSessionRow<TUser>(rows[0]);
    await this.db.execute(`UPDATE ${this.sqlTableName} SET is_active = ?;`, [0]);
    await this.db.execute(
      `UPDATE ${this.sqlTableName} SET is_active = ?, last_active_at = ? WHERE id = ?;`,
      [1, Date.now(), targetSession.id]
    );

    targetSession.isActive = true;
    targetSession.lastActiveAt = Date.now();

    this.events?.emit(this.tableName, { operation: 'SWITCH_SESSION', session: targetSession });
    return targetSession;
  }
}
