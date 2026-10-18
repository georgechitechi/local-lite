import { LocalDBAdapter } from '../adapters/local/index.js';
import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { ConflictResolver, ConflictStrategy, NetworkStatusProvider, RetryConfig } from '../core/types.js';
import { SyncLogger, CustomLogger, LogLevel } from '../utils/logger.js';

export interface SupabaseConfigOptions {
  url?: string;
  anonKey?: string;
  client?: any;
  schema?: string;
  updatedAtColumn?: string;
  deletedColumn?: string;
  deletedValue?: any;
  deletedAtColumn?: string;
  pushRpcName?: string;
  channelName?: string;
  scopedTables?: string[];
}

export interface ConvexConfigOptions {
  /**
   * ConvexClient instance.
   */
  client: any;

  /**
   * Primary key field name. Default: config.primaryKey or 'id'
   */
  primaryKey?: string;

  /**
   * Convex mutation function or name for pushing changes.
   * Default: 'sync:pushBatch'
   */
  pushMutation?: any;

  /**
   * Convex query function or name for pulling changes.
   * Default: 'sync:pullDeltas'
   */
  pullQuery?: any;

  /**
   * Column used for soft deletes. Default: 'deleted'
   */
  deletedColumn?: string;

  /**
   * Column used for updatedAt timestamp. Default: 'updatedAt'
   */
  updatedAtColumn?: string;
}

export interface FirebaseConfigOptions {
  /**
   * Firestore database instance (from modular firebase/firestore, @react-native-firebase/firestore, or compat SDK).
   */
  firestore: any;

  /**
   * Primary key field name. Default: config.primaryKey or 'id'
   */
  primaryKey?: string;

  /**
   * Field used for soft deletes. Default: 'deleted'
   */
  deletedColumn?: string;

  /**
   * Field used for updatedAt timestamp tracking. Default: 'updatedAt'
   */
  updatedAtColumn?: string;

  /**
   * Optional reference to modular firebase/firestore module if not globally available.
   */
  firestoreModule?: any;
}

export interface LocalLiteConfig {
  /**
   * Local SQLite Database instance, name, factory function, or LocalDBAdapter.
   * - Pass an Expo database instance (e.g. from SQLite.openDatabaseAsync('app.db'))
   * - Pass a factory: () => SQLite.openDatabaseAsync('app.db')
   * - Pass a database file name: 'app.db'
   * - Or a custom LocalDBAdapter
   */
  database?: any | string | (() => Promise<any> | any) | LocalDBAdapter;

  /**
   * Explicit database filename for the Expo convenience opener when database is not provided.
   */
  databaseName?: string;

  /**
   * List of tables to sync.
   * e.g. ['todos', 'notes']
   */
  tables?: string[];

  /**
   * Initial SQL table schema migration queries to execute on startup.
   * e.g. ["CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT);"]
   */
  migrations?: string[];

  /**
   * Automatically create tables and columns dynamically on the fly without manual SQL migrations.
   * Opt-in (default: false). When true, tables in `tables` are created automatically,
   * and any missing columns are added dynamically on insert/update/pull.
   */
  autoSchema?: boolean;

  /**
   * Primary key column. Default: 'id'
   */
  primaryKey?: string;

  /**
   * Supabase backend connection options.
   */
  supabase?: SupabaseConfigOptions;

  /**
   * Convex backend connection options.
   */
  convex?: ConvexConfigOptions;

  /**
   * Firebase / Firestore backend connection options.
   */
  firebase?: FirebaseConfigOptions;

  /**
   * Custom remote adapter (overrides Supabase / Convex / Firebase).
   */
  remote?: RemoteDBAdapter;

  /**
   * Explicitly enable a temporary simulated remote for demos when no backend is provided.
   * Acknowledged writes exist only in memory. Never enabled implicitly.
   * Default: false
   */
  inMemoryRemote?: boolean;

  /**
   * Conflict resolution strategy. Default: 'last-write-wins'
   */
  conflictResolver?: ConflictStrategy | ConflictResolver;

  /**
   * Periodic outbox push interval in ms. Default: 5000
   */
  pushIntervalMs?: number;

  /**
   * Periodic remote pull interval in ms. Default: 10000
   */
  pullIntervalMs?: number;

  /**
   * Automatically pause recurring sync timers and listeners when the app is backgrounded
   * (React Native AppState or Web Page Visibility API), and resume when foregrounded.
   * Default: true
   */
  autoPauseOnBackground?: boolean;

  /**
   * Maximum retry attempts for failed push items. Default: 5
   */
  maxRetries?: number;

  /**
   * Advanced retry configuration with exponential backoff and custom retry predicates.
   */
  retry?: number | RetryConfig;

  /**
   * Custom logger or false to silence logs in production.
   */
  logger?: SyncLogger | CustomLogger | boolean;

  /**
   * Minimum log level. Default: 'info'
   */
  logLevel?: LogLevel;

  /**
   * Network status provider. Default: DefaultNetworkStatusProvider
   */
  network?: NetworkStatusProvider;

  /**
   * Automatically call client.initialize() and create tables.
   * Default: true
   */
  autoInitialize?: boolean;

  /**
   * Start automatic sync after initialization. Default: true.
   * Set false to initialize storage and queue writes without timers or subscriptions.
   * Call client.syncWorker.start() to enable automatic sync, or push/pull manually.
   */
  autoStart?: boolean;

  /**
   * Explicitly configured JSON column map per table name.
   */
  jsonColumns?: Record<string, string[]>;

  /**
   * Automatically detect and hydrate stringified JSON objects and arrays across all columns.
   */
  autoHydrateJSON?: boolean;

  /**
   * Scoped synchronization filter (e.g. { org_id: '...' } or dynamic resolver callback).
   */
  syncScope?: Record<string, any> | (() => Record<string, any> | Promise<Record<string, any>>);
}
