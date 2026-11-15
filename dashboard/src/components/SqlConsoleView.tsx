import React, { useState } from 'react';
import { apiRequest } from '../api';

interface SqlConsoleViewProps {
  selectedTable: string | null;
  onError: (msg: string | null) => void;
}

export const SqlConsoleView: React.FC<SqlConsoleViewProps> = ({
  selectedTable,
  onError,
}) => {
  const [sqlText, setSqlText] = useState(
    'SELECT name, type FROM sqlite_master ORDER BY name;',
  );
  const [result, setResult] = useState<{
    columns: string[];
    rows: any[];
    durationMs: number;
  } | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('local_lite_sql_history') || '[]');
    } catch {
      return [];
    }
  });

  const runQuery = async (prefix = '') => {
    const raw = sqlText.trim();
    if (!raw) return;
    onError(null);
    try {
      const res = await apiRequest<{
        columns: string[];
        rows: any[];
        durationMs: number;
      }>('/api/query', {
        method: 'POST',
        body: JSON.stringify({ sql: prefix ? `${prefix}${raw}` : raw }),
      });
      setResult(res);
      if (!prefix && history[0] !== raw) {
        const next = [raw, ...history.filter((x) => x !== raw)].slice(0, 10);
        setHistory(next);
        localStorage.setItem('local_lite_sql_history', JSON.stringify(next));
      }
    } catch (err: any) {
      onError(err.message);
    }
  };

  const snippets = [
    { label: 'List Tables', sql: 'SELECT name, type FROM sqlite_master ORDER BY name;' },
    { label: 'PRAGMA WAL', sql: 'PRAGMA journal_mode;' },
    {
      label: 'Outbox Queue',
      sql: 'SELECT * FROM sync_outbox ORDER BY created_at DESC LIMIT 50;',
    },
    ...(selectedTable
      ? [
          {
            label: `Sample ${selectedTable}`,
            sql: `SELECT * FROM "${selectedTable}" LIMIT 50;`,
          },
        ]
      : []),
  ];

  const formatCell = (v: unknown) => {
    if (v === null || v === undefined) {
      return <span style={{ color: 'var(--muted)' }}>NULL</span>;
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <>
      <div className="toolbar">
        <strong>SQL Console</strong>
        <span style={{ color: 'var(--muted)' }}>Ctrl/Cmd + Enter to run</span>
      </div>
      <div className="content">
        <textarea
          className="sql"
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              runQuery('');
            }
          }}
        />
        <div className="snippets">
          <button className="btn primary" onClick={() => runQuery('')}>
            Run Query
          </button>
          <button className="btn" onClick={() => runQuery('EXPLAIN QUERY PLAN ')}>
            Explain Plan
          </button>
          {snippets.map((s) => (
            <button key={s.label} className="btn" onClick={() => setSqlText(s.sql)}>
              {s.label}
            </button>
          ))}
        </div>

        {history.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>Recent: </span>
            {history.map((h, i) => (
              <button
                key={i}
                className="btn"
                style={{ fontSize: 11, padding: '3px 7px', margin: '0 4px 4px 0' }}
                onClick={() => setSqlText(h)}
              >
                {h.slice(0, 48)}
              </button>
            ))}
          </div>
        )}

        {result ? (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
                color: 'var(--muted)',
              }}
            >
              <span>
                {result.rows.length} row(s) • {result.durationMs} ms
              </span>
              {result.rows.length > 0 && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      const escCsv = (v: unknown) => {
                        if (v == null) return '';
                        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
                        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                      };
                      const csv = [
                        result.columns.map(escCsv).join(','),
                        ...result.rows.map((r) =>
                          result.columns.map((c) => escCsv(r[c])).join(','),
                        ),
                      ].join('\r\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'query-results.csv';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Export CSV
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(result.rows, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'query-results.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Export JSON
                  </button>
                </div>
              )}
            </div>
            <div className="grid-wrap">
              <table>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c}>{formatCell(r[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="empty">Run a SQL query to inspect results.</div>
        )}
      </div>
    </>
  );
};
