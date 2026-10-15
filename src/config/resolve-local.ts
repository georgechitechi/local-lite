import { LocalDBAdapter } from '../adapters/local/index.js';
import { ExpoSQLiteAdapter } from '../adapters/local/expo-sqlite.js';
import { OpSQLiteAdapter } from '../adapters/local/op-sqlite.js';
import { BetterSQLite3Adapter } from '../adapters/local/better-sqlite3.js';
import { LibSQLAdapter } from '../adapters/local/libsql.js';
import { SqlJsAdapter } from '../adapters/local/sql-js.js';
import { NodeSQLiteAdapter } from '../adapters/local/node-sqlite.js';
import { LocalLiteConfig } from './types.js';

/**
 * Resolves or instantiates the appropriate LocalDBAdapter based on the provided configuration.
 * Auto-detects Expo SQLite, OP-SQLite, better-sqlite3, LibSQL, sql.js, and Node.js built-in sqlite.
 */
export async function resolveLocalAdapter(config: LocalLiteConfig): Promise<LocalDBAdapter> {
  let rawDb = config.database;
  if (typeof rawDb === 'function') {
    rawDb = await rawDb();
  }

  // 1. @libsql/client (Turso / LibSQL) instance
  if (rawDb && typeof rawDb.batch === 'function' && typeof rawDb.execute === 'function') {
    return new LibSQLAdapter(rawDb);
  }

  // 2. sql.js Database instance
  if (rawDb && typeof rawDb.export === 'function' && typeof rawDb.exec === 'function') {
    return new SqlJsAdapter(rawDb);
  }

  // 3. Custom object already implementing LocalDBAdapter
  if (rawDb && typeof rawDb.execute === 'function' && typeof rawDb.transaction === 'function') {
    return rawDb;
  }

  // 4. Expo SQLite database instance (openDatabaseAsync)
  if (rawDb && typeof rawDb.getAllAsync === 'function') {
    return new ExpoSQLiteAdapter(rawDb);
  }

  // 5. @op-engineering/op-sqlite or react-native-quick-sqlite instance
  if (rawDb && typeof rawDb.executeAsync === 'function') {
    return new OpSQLiteAdapter(rawDb);
  }

  // 6. better-sqlite3 database instance
  if (rawDb && typeof rawDb.prepare === 'function' && typeof rawDb.pragma === 'function') {
    return new BetterSQLite3Adapter(rawDb);
  }

  // 7. Node.js 22+ built-in node:sqlite (DatabaseSync) instance
  if (rawDb && typeof rawDb.prepare === 'function' && typeof rawDb.exec === 'function') {
    return new NodeSQLiteAdapter(rawDb);
  }

  // 8. Fallback for prepare-based SQLite instances
  if (rawDb && typeof rawDb.prepare === 'function') {
    return new BetterSQLite3Adapter(rawDb);
  }

  // 9. Auto-open by name using expo-sqlite if available
  if (typeof rawDb === 'string' || config.databaseName) {
    const dbName = typeof rawDb === 'string' ? rawDb : (config.databaseName ?? 'local_lite.db');
    let expoSqlite: any;
    try {
      if (typeof require === 'function') {
        expoSqlite = require('expo-sqlite');
      }
    } catch {
      // ignore
    }

    try {
      if (!expoSqlite) {
        expoSqlite = await import('expo-sqlite');
      }
      if (expoSqlite && typeof expoSqlite.openDatabaseAsync === 'function') {
        const expoDb = await expoSqlite.openDatabaseAsync(dbName);
        return new ExpoSQLiteAdapter(expoDb);
      }
      throw new Error('expo-sqlite openDatabaseAsync not found');
    } catch (err) {
      throw new Error(
        `Failed to auto-open SQLite database "${dbName}". ` +
        `Please pass the database instance to config.database: ${err}`
      );
    }
  }

  throw new Error(
    'No database provided in sync config. Please specify config.database or config.databaseName.'
  );
}
