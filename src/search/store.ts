import { DBExecutable } from '../core/schema-manager.js';
import { SearchIndexConfig, SearchQueryOptions, SearchResult } from './types.js';

export function getFtsTableName(table: string): string {
  return `_fts_${table}`;
}

export class SearchStore {
  /**
   * Ensures the FTS5 virtual table exists for the given table and columns.
   */
  static async ensureFtsTable(db: DBExecutable, config: SearchIndexConfig): Promise<void> {
    const ftsTable = getFtsTableName(config.table);
    const cols = config.columns.map((c) => c.trim()).filter(Boolean);
    const tokenize = config.tokenize || 'unicode61';

    // row_id is UNINDEXED in FTS5 so it does not pollute search tokens
    const columnDefs = ['row_id UNINDEXED', ...cols].join(', ');

    const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(${columnDefs}, tokenize='${tokenize}');`;
    try {
      await db.execute(sql);
    } catch (err: any) {
      // In case tokenize='unicode61' isn't supported by legacy SQLite build, retry without tokenize option
      if (err?.message?.includes('tokenize') || err?.message?.includes('unknown tokenizer')) {
        await db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(${columnDefs});`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Drops the FTS5 virtual table.
   */
  static async dropFtsTable(db: DBExecutable, table: string): Promise<void> {
    const ftsTable = getFtsTableName(table);
    await db.execute(`DROP TABLE IF EXISTS ${ftsTable};`);
  }

  /**
   * Indexes or updates a single row in the FTS table.
   */
  static async indexRow(
    db: DBExecutable,
    table: string,
    rowId: string,
    columns: string[],
    values: Record<string, any>
  ): Promise<void> {
    const ftsTable = getFtsTableName(table);

    // Delete existing entry if any
    await db.execute(`DELETE FROM ${ftsTable} WHERE row_id = ?;`, [rowId]);

    const cols = ['row_id', ...columns];
    const placeholders = cols.map(() => '?').join(', ');
    const params = [
      rowId,
      ...columns.map((c) => {
        const val = values[c];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }),
    ];

    await db.execute(
      `INSERT INTO ${ftsTable} (${cols.join(', ')}) VALUES (${placeholders});`,
      params
    );
  }

  /**
   * Removes a single row from the FTS table.
   */
  static async removeRow(db: DBExecutable, table: string, rowId: string): Promise<void> {
    const ftsTable = getFtsTableName(table);
    await db.execute(`DELETE FROM ${ftsTable} WHERE row_id = ?;`, [rowId]);
  }

  /**
   * Clears all rows in the FTS table.
   */
  static async clearFts(db: DBExecutable, table: string): Promise<void> {
    const ftsTable = getFtsTableName(table);
    await db.execute(`DELETE FROM ${ftsTable};`);
  }

  /**
   * Executes a full-text search match query against the FTS5 table.
   */
  static async search(
    db: DBExecutable,
    table: string,
    columns: string[],
    queryText: string,
    options: SearchQueryOptions = {}
  ): Promise<Array<{ rowId: string; rank: number; snippet?: string }>> {
    const ftsTable = getFtsTableName(table);
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const preTag = options.highlightPreTag ?? '<mark>';
    const postTag = options.highlightPostTag ?? '</mark>';

    // Prepare match phrase: escape quotes or sanitize
    // If query has multiple terms, SQLite FTS5 supports prefix matching (e.g. "term*")
    const terms = queryText
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/["*]/g, ''))
      .filter(Boolean);

    if (terms.length === 0) {
      return [];
    }

    // Search query syntax: each term as prefix search: "term1"* "term2"*
    const matchQuery = terms.map((t) => `"${t}"*`).join(' ');

    // Snippet column index in FTS5: columns are 0-based: col 0 is row_id, col 1 is columns[0], etc.
    // We pick column index 1 (or the first indexed text column) for snippet extraction
    const snippetColIndex = 1;

    let sql = `
      SELECT 
        row_id,
        rank,
        snippet(${ftsTable}, ${snippetColIndex}, '${preTag}', '${postTag}', '...', 15) as snippet_text
      FROM ${ftsTable}
      WHERE ${ftsTable} MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?;
    `;

    try {
      const rows = await db.execute(sql, [matchQuery, limit, offset]);
      return (rows || []).map((r: any) => ({
        rowId: String(r.row_id),
        rank: Number(r.rank ?? 0),
        snippet: r.snippet_text ?? undefined,
      }));
    } catch (err: any) {
      // In case snippet() function is unavailable in the environment, fallback to rank-only search
      if (err?.message?.includes('snippet') || err?.message?.includes('no such function')) {
        const fallbackSql = `
          SELECT row_id, rank
          FROM ${ftsTable}
          WHERE ${ftsTable} MATCH ?
          ORDER BY rank
          LIMIT ? OFFSET ?;
        `;
        const rows = await db.execute(fallbackSql, [matchQuery, limit, offset]);
        return (rows || []).map((r: any) => ({
          rowId: String(r.row_id),
          rank: Number(r.rank ?? 0),
        }));
      }
      throw err;
    }
  }
}
