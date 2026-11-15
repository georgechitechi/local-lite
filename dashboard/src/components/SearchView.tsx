import { Fragment, useCallback, useEffect, useState } from 'react';
import { apiRequest, TableSummary } from '../api';

interface FtsIndexInfo {
  ftsTable: string;
  sourceTable: string;
  rowCount: number;
  sql: string | null;
}

interface SearchViewProps {
  tables: TableSummary[];
  readOnly: boolean;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function renderSnippet(snippet: unknown) {
  const text = String(snippet ?? '');
  const parts = text.split(/(<mark>.*?<\/mark>)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
      return (
        <mark key={idx} style={{ background: 'rgba(234, 179, 8, 0.28)', color: 'inherit', padding: '0 2px', borderRadius: 2 }}>
          {part.slice(6, -7)}
        </mark>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

export function SearchView({ tables, readOnly, onNotify }: SearchViewProps) {
  const userTables = tables.filter((t) => !t.internal && !t.name.startsWith('_fts_'));
  const [indexes, setIndexes] = useState<FtsIndexInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [activeFtsTable, setActiveFtsTable] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [searching, setSearching] = useState(false);

  const loadIndexes = useCallback(async () => {
    try {
      const res = await apiRequest<{ indexes: FtsIndexInfo[] }>('/api/search/indexes');
      const list = res.indexes ?? [];
      setIndexes(list);
      if (!activeFtsTable && list.length > 0) {
        setActiveFtsTable(list[0].ftsTable);
      }
    } catch (err: any) {
      onNotify(err?.message ?? 'Failed to load FTS5 indexes', 'error');
    }
  }, [activeFtsTable, onNotify]);

  useEffect(() => {
    void loadIndexes();
  }, [loadIndexes]);

  useEffect(() => {
    if (!selectedSource && userTables.length > 0) {
      setSelectedSource(userTables[0].name);
    }
  }, [selectedSource, userTables]);

  const runSearch = useCallback(async (ftsTable: string, q: string) => {
    if (!ftsTable) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ table: ftsTable, limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      const res = await apiRequest<{ rows: Record<string, unknown>[]; columns: string[] }>(
        `/api/search?${params.toString()}`,
      );
      setRows(res.rows ?? []);
      setColumns(res.columns ?? []);
    } catch (err: any) {
      onNotify(err?.message ?? 'Search query failed', 'error');
    } finally {
      setSearching(false);
    }
  }, [onNotify]);

  useEffect(() => {
    if (activeFtsTable) {
      void runSearch(activeFtsTable, query);
    }
  }, [activeFtsTable, query, runSearch]);

  const handleBuildIndex = async () => {
    if (!selectedSource) return;
    setIndexing(true);
    try {
      const res = await apiRequest<{ ftsTable: string; rowCount: number }>('/api/search/index', {
        method: 'POST',
        body: JSON.stringify({ table: selectedSource }),
      });
      onNotify(`Indexed ${res.rowCount} rows into ${res.ftsTable}`, 'success');
      setActiveFtsTable(res.ftsTable);
      await loadIndexes();
      await runSearch(res.ftsTable, query);
    } catch (err: any) {
      onNotify(err?.message ?? 'Failed to build FTS5 index', 'error');
    } finally {
      setIndexing(false);
    }
  };

  const displayColumns = columns.filter((c) => c !== 'rowid' && c !== '_rank');

  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            className="input"
            style={{ width: 190 }}
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            disabled={userTables.length === 0}
          >
            {userTables.length === 0 ? (
              <option value="">No user tables</option>
            ) : (
              userTables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.rowCount} rows)
                </option>
              ))
            )}
          </select>
          <button
            className="btn primary"
            onClick={() => void handleBuildIndex()}
            disabled={readOnly || indexing || !selectedSource}
          >
            {indexing ? 'Indexing...' : 'Build FTS5 Index'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            className="input"
            style={{ width: 190 }}
            value={activeFtsTable}
            onChange={(e) => setActiveFtsTable(e.target.value)}
            disabled={indexes.length === 0}
          >
            {indexes.length === 0 ? (
              <option value="">No FTS5 indexes</option>
            ) : (
              indexes.map((idx) => (
                <option key={idx.ftsTable} value={idx.ftsTable}>
                  {idx.sourceTable} ({idx.rowCount} docs)
                </option>
              ))
            )}
          </select>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Full-text search (FTS5 MATCH)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!activeFtsTable}
          />
          <button
            className="btn"
            onClick={() => void runSearch(activeFtsTable, query)}
            disabled={!activeFtsTable || searching}
          >
            Search
          </button>
        </div>
      </div>

      <div className="content">
        {indexes.length === 0 ? (
          <div className="empty-state">
            No FTS5 search indexes yet. Select a table above and click "Build FTS5 Index" to enable instant full-text search with BM25 ranking.
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            {query.trim() ? `No matches for "${query}"` : 'Index is empty'}
          </div>
        ) : (
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>rowid</th>
                  {columns.includes('_rank') && <th style={{ width: 90 }}>BM25</th>}
                  {displayColumns.map((col) => (
                    <th key={col}>{col === '_snippet' ? 'Snippet' : col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={String(row.rowid ?? i)}>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{String(row.rowid ?? '')}</td>
                    {columns.includes('_rank') && (
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                        {typeof row._rank === 'number' ? row._rank.toFixed(3) : String(row._rank ?? '')}
                      </td>
                    )}
                    {displayColumns.map((col) => (
                      <td key={col}>
                        {col === '_snippet'
                          ? renderSnippet(row[col])
                          : row[col] === null || row[col] === undefined
                            ? <span style={{ color: 'var(--muted)' }}>NULL</span>
                            : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
