import { DBExecutable } from '../core/schema-manager.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { TableChangeEvent } from '../core/types.js';
import { SearchIndexConfig, SearchQueryOptions, SearchResult } from './types.js';
import { SearchStore } from './store.js';

export class SearchManager {
  private indices: Map<string, SearchIndexConfig> = new Map();
  private eventListeners: Map<string, (event: TableChangeEvent) => void> = new Map();

  constructor(
    private db: DBExecutable,
    private events?: EventEmitter,
    private getRowById?: (table: string, id: string) => Promise<any | null>
  ) {}

  /**
   * Registers and creates an FTS5 index for the specified table and columns.
   * If an EventEmitter is available, hooks automatically update the index on mutations.
   */
  async createIndex(config: SearchIndexConfig): Promise<void> {
    const table = config.table;
    this.indices.set(table, config);
    await SearchStore.ensureFtsTable(this.db, config);

    // Auto-sync via event emitter if configured
    if (this.events && !this.eventListeners.has(table)) {
      const listener = async (e: TableChangeEvent) => {
        try {
          if (e.operation === 'DELETE') {
            await this.removeRecord(table, e.rowId);
          } else if (e.payload) {
            await this.indexRecord(table, e.rowId, e.payload);
          }
        } catch {
          // Background sync errors shouldn't crash the event bus
        }
      };
      this.events.on(table, listener);
      this.eventListeners.set(table, listener);
    }
  }

  /**
   * Indexes or updates a single record in the FTS index.
   */
  async indexRecord(table: string, rowId: string, values: Record<string, any>): Promise<void> {
    const config = this.indices.get(table);
    const columns = config ? config.columns : Object.keys(values).filter((k) => k !== 'id');
    await SearchStore.indexRow(this.db, table, rowId, columns, values);
  }

  /**
   * Removes a record from the FTS index.
   */
  async removeRecord(table: string, rowId: string): Promise<void> {
    await SearchStore.removeRow(this.db, table, rowId);
  }

  /**
   * Rebuilds the search index for a table from an array of existing records.
   */
  async rebuildIndex(table: string, records: Array<{ id: string } & Record<string, any>>): Promise<void> {
    const config = this.indices.get(table);
    if (!config) {
      throw new Error(`Search index not configured for table "${table}". Call createIndex first.`);
    }

    await SearchStore.clearFts(this.db, table);
    for (const record of records) {
      await SearchStore.indexRow(this.db, table, record.id, config.columns, record);
    }
  }

  /**
   * Executes a full-text search query, returning ranked matches with optional snippets and hydrated rows.
   */
  async query<T = any>(
    table: string,
    queryText: string,
    options: SearchQueryOptions = {}
  ): Promise<SearchResult<T>[]> {
    const config = this.indices.get(table);
    const columns = config ? config.columns : [];

    const matches = await SearchStore.search(this.db, table, columns, queryText, options);
    const shouldHydrate = options.hydrateRow !== false;

    const results: SearchResult<T>[] = [];

    for (const match of matches) {
      let data: T | null = null;
      if (shouldHydrate) {
        if (this.getRowById) {
          data = await this.getRowById(table, match.rowId);
        } else {
          try {
            const rows = await this.db.execute(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [match.rowId]);
            data = rows && rows.length > 0 ? rows[0] : null;
          } catch {
            data = null;
          }
        }
      }

      results.push({
        rowId: match.rowId,
        rank: match.rank,
        snippet: match.snippet,
        data,
      });
    }

    return results;
  }

  /**
   * Drops an index and cleans up auto-sync listeners.
   */
  async dropIndex(table: string): Promise<void> {
    this.indices.delete(table);
    const listener = this.eventListeners.get(table);
    if (listener && this.events) {
      this.events.off(table, listener);
      this.eventListeners.delete(table);
    }
    await SearchStore.dropFtsTable(this.db, table);
  }

  /**
   * Returns list of currently indexed table names.
   */
  getIndexedTables(): string[] {
    return Array.from(this.indices.keys());
  }
}
