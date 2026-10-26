export interface SearchIndexConfig {
  /**
   * The name of the table to index (e.g. 'properties', 'tenants').
   */
  table: string;

  /**
   * The text columns to include in the full-text search index.
   */
  columns: string[];

  /**
   * SQLite FTS tokenizer (e.g. 'unicode61', 'porter', 'ascii').
   * Default: 'unicode61'
   */
  tokenize?: string;
}

export interface SearchQueryOptions {
  /**
   * Maximum search results to return (default: 20).
   */
  limit?: number;

  /**
   * Pagination offset.
   */
  offset?: number;

  /**
   * Whether to include a highlighted snippet matching the search query.
   * Default: true
   */
  highlight?: boolean;

  /**
   * Tag prefix for highlights (default: '<mark>').
   */
  highlightPreTag?: string;

  /**
   * Tag suffix for highlights (default: '</mark>').
   */
  highlightPostTag?: string;

  /**
   * Whether to hydrate the full row record from the base table.
   * Default: true
   */
  hydrateRow?: boolean;
}

export interface SearchResult<T = any> {
  rowId: string;
  rank: number;
  snippet?: string;
  data?: T | null;
}
