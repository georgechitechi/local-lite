import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest, buildApiUrl, TableSummary } from '../api';

interface SchemaViewProps {
  tables: TableSummary[];
  showSystem: boolean;
  readOnly: boolean;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const SchemaView: React.FC<SchemaViewProps> = ({
  tables,
  showSystem,
  readOnly,
  onRefresh,
  onError,
}) => {
  const [viewMode, setViewMode] = useState<'cards' | 'er'>('cards');
  const [diffModal, setDiffModal] = useState<{
    open: boolean;
    targetSql: string;
    sql: string;
    changes: { type: string; table: string; detail: string }[];
    loading: boolean;
    copied: boolean;
  }>({ open: false, targetSql: '', sql: '', changes: [], loading: false, copied: false });

  const [idxModal, setIdxModal] = useState<{
    open: boolean;
    table: TableSummary | null;
    name: string;
    columns: string[];
    unique: boolean;
  }>({ open: false, table: null, name: '', columns: [], unique: false });

  const [sqlModal, setSqlModal] = useState<{
    open: boolean;
    tableName: string | null;
    dialect: 'sqlite' | 'postgres' | 'mysql' | 'typescript';
    includeSystem: boolean;
    sql: string;
    loading: boolean;
    copied: boolean;
  }>({
    open: false,
    tableName: null,
    dialect: 'sqlite',
    includeSystem: showSystem,
    sql: '',
    loading: false,
    copied: false,
  });

  const visible = tables.filter((t) => showSystem || !t.internal);

  const loadGeneratedSql = useCallback(
    async (
      dialect: 'sqlite' | 'postgres' | 'mysql' | 'typescript',
      includeSystem: boolean,
      tableName: string | null,
    ) => {
      if (dialect === 'typescript') {
        const selected = tables.filter((t) => {
          if (tableName && t.name !== tableName) return false;
          if (!tableName && !includeSystem && t.internal) return false;
          return true;
        });
        const toPascal = (s: string) =>
          s
            .replace(/(^|[_-])([a-zA-Z0-9])/g, (_, __, ch) => ch.toUpperCase())
            .replace(/[^a-zA-Z0-9]/g, '');
        const toTsType = (raw: string) => {
          const u = (raw || 'TEXT').toUpperCase();
          if (u.includes('INT') || u.includes('REAL') || u.includes('FLOA') || u.includes('DOUB') || u.includes('NUM')) return 'number';
          if (u.includes('BOOL')) return 'boolean';
          if (u.includes('BLOB')) return 'Uint8Array';
          return 'string';
        };
        const tsCode = selected
          .map((t) => {
            const fields = t.columns
              .map((c) => {
                const nullable = c.notnull === 0 && c.pk === 0 ? ' | null' : '';
                return `  ${c.name}: ${toTsType(c.type)}${nullable};`;
              })
              .join('\n');
            return `export interface ${toPascal(t.name)} {\n${fields}\n}`;
          })
          .join('\n\n');
        setSqlModal((prev) => ({ ...prev, sql: tsCode, loading: false, copied: false }));
        return;
      }
      setSqlModal((prev) => ({ ...prev, loading: true, copied: false }));
      try {
        const q = new URLSearchParams({
          dialect,
          includeSystem: includeSystem ? '1' : '0',
        });
        if (tableName) q.set('table', tableName);
        const res = await apiRequest<{ sql: string }>(
          `/api/schema/sql?${q.toString()}`,
        );
        setSqlModal((prev) => ({ ...prev, sql: res.sql || '', loading: false }));
      } catch (err: any) {
        onError(err.message);
        setSqlModal((prev) => ({ ...prev, loading: false }));
      }
    },
    [onError, tables],
  );

  useEffect(() => {
    if (!sqlModal.open) return;
    loadGeneratedSql(sqlModal.dialect, sqlModal.includeSystem, sqlModal.tableName);
  }, [
    sqlModal.open,
    sqlModal.dialect,
    sqlModal.includeSystem,
    sqlModal.tableName,
    loadGeneratedSql,
  ]);

  const openSqlModal = (tableName: string | null) => {
    setSqlModal({
      open: true,
      tableName,
      dialect: 'sqlite',
      includeSystem: showSystem,
      sql: '',
      loading: true,
      copied: false,
    });
  };

  const createIndex = async () => {
    if (!idxModal.table) return;
    try {
      onError(null);
      await apiRequest(
        `/api/tables/${encodeURIComponent(idxModal.table.name)}/indexes`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: idxModal.name.trim(),
            columns: idxModal.columns,
            unique: idxModal.unique,
          }),
        },
      );
      setIdxModal({
        open: false,
        table: null,
        name: '',
        columns: [],
        unique: false,
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const dropIndex = async (tableName: string, indexName: string) => {
    if (!window.confirm(`Drop index "${indexName}"?`)) return;
    try {
      onError(null);
      await apiRequest(
        `/api/tables/${encodeURIComponent(tableName)}/indexes/${encodeURIComponent(indexName)}`,
        { method: 'DELETE' },
      );
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const runMigrationDiff = async (targetSqlText: string) => {
    setDiffModal((prev) => ({ ...prev, loading: true, copied: false }));
    try {
      const res = await apiRequest<{
        sql: string;
        changes: { type: string; table: string; detail: string }[];
      }>('/api/schema/diff', {
        method: 'POST',
        body: JSON.stringify({ targetSql: targetSqlText }),
      });
      setDiffModal((prev) => ({
        ...prev,
        sql: res.sql || '',
        changes: res.changes || [],
        loading: false,
      }));
    } catch (err: any) {
      setDiffModal((prev) => ({ ...prev, loading: false }));
      onError(err.message);
    }
  };

  const openDiffModal = () => {
    setDiffModal({
      open: true,
      targetSql: '',
      sql: '',
      changes: [],
      loading: true,
      copied: false,
    });
    void runMigrationDiff('');
  };

  const downloadQuery = new URLSearchParams({
    dialect: sqlModal.dialect,
    includeSystem: sqlModal.includeSystem ? '1' : '0',
    download: '1',
  });
  if (sqlModal.tableName) downloadQuery.set('table', sqlModal.tableName);

  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>Schema &amp; Indexes</strong>
          <span className="badge">{visible.length} tables</span>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginLeft: 8 }}>
            <button
              className={`btn${viewMode === 'cards' ? ' primary' : ''}`}
              style={{ border: 0, borderRadius: 0 }}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </button>
            <button
              className={`btn${viewMode === 'er' ? ' primary' : ''}`}
              style={{ border: 0, borderRadius: 0 }}
              onClick={() => setViewMode('er')}
            >
              ER Diagram
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn"
            disabled={visible.length === 0}
            onClick={openDiffModal}
          >
            Migration Diff
          </button>
          <button
            className="btn primary"
            disabled={visible.length === 0}
            onClick={() => openSqlModal(null)}
          >
            Generate SQL Schema
          </button>
        </div>
      </div>
      <div className="content">
        {viewMode === 'er' ? (
          (() => {
            const colsPerRow = Math.max(1, Math.min(3, visible.length));
            const nodeWidth = 260;
            const nodeGapX = 70;
            const nodeGapY = 50;
            const nodeHeaderH = 38;
            const rowH = 24;
            const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
            const rowHeights: number[] = [];
            visible.forEach((t, idx) => {
              const r = Math.floor(idx / colsPerRow);
              const h = nodeHeaderH + Math.max(1, t.columns.length) * rowH + 14;
              rowHeights[r] = Math.max(rowHeights[r] || 0, h);
            });
            visible.forEach((t, idx) => {
              const r = Math.floor(idx / colsPerRow);
              const c = idx % colsPerRow;
              const yOffset = rowHeights.slice(0, r).reduce((sum, h) => sum + h + nodeGapY, 24);
              const xOffset = 24 + c * (nodeWidth + nodeGapX);
              const h = nodeHeaderH + Math.max(1, t.columns.length) * rowH + 14;
              positions.set(t.name, { x: xOffset, y: yOffset, w: nodeWidth, h });
            });
            const totalW = Math.max(600, colsPerRow * (nodeWidth + nodeGapX) + 24);
            const totalH = Math.max(320, rowHeights.reduce((sum, h) => sum + h + nodeGapY, 24) + 24);
            const edges: { fromTable: string; toTable: string; fromCol: string; toCol: string }[] = [];
            visible.forEach((t) => {
              (t.foreignKeys ?? []).forEach((fk) => {
                if (positions.has(fk.table)) {
                  edges.push({ fromTable: t.name, toTable: fk.table, fromCol: fk.from, toCol: fk.to });
                }
              });
            });
            return (
              <div className="card" style={{ overflow: 'auto', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
                  <span>Entity-Relationship Diagram ({visible.length} tables, {edges.length} foreign keys)</span>
                  <span>PK = Primary Key • FK = Foreign Key</span>
                </div>
                <div style={{ position: 'relative', width: totalW, height: totalH }}>
                  <svg
                    width={totalW}
                    height={totalH}
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                  >
                    <defs>
                      <marker id="er-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                        <path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" />
                      </marker>
                    </defs>
                    {edges.map((edge, idx) => {
                      const src = positions.get(edge.fromTable);
                      const dst = positions.get(edge.toTable);
                      if (!src || !dst) return null;
                      const x1 = src.x + src.w;
                      const y1 = src.y + 30;
                      const x2 = dst.x;
                      const y2 = dst.y + 30;
                      const mx = (x1 + x2) / 2;
                      return (
                        <g key={idx}>
                          <path
                            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="1.75"
                            markerEnd="url(#er-arrow)"
                            opacity="0.85"
                          />
                        </g>
                      );
                    })}
                  </svg>
                  {visible.map((t) => {
                    const pos = positions.get(t.name)!;
                    const fkCols = new Set((t.foreignKeys ?? []).map((f) => f.from));
                    return (
                      <div
                        key={t.name}
                        className="card"
                        style={{
                          position: 'absolute',
                          left: pos.x,
                          top: pos.y,
                          width: pos.w,
                          padding: 0,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 10px',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'var(--bg-elevated, rgba(255,255,255,0.03))',
                          }}
                        >
                          <strong style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{t.name}</strong>
                          <span className="badge">{t.rowCount}</span>
                        </div>
                        <div style={{ padding: '6px 10px' }}>
                          {t.columns.map((c) => (
                            <div
                              key={c.name}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                height: rowH,
                                fontSize: 12,
                                fontFamily: 'var(--mono)',
                              }}
                            >
                              <span>
                                {c.pk > 0 ? '🔑 ' : fkCols.has(c.name) ? '🔗 ' : ''}
                                {c.name}
                              </span>
                              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{c.type || 'ANY'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()
        ) : (
        <div className="schema-grid">
          {visible.map((t) => (
            <div key={t.name} className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong style={{ fontFamily: 'var(--mono)' }}>{t.name}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="badge">
                    {t.rowCount} rows • {t.columns.length} cols
                  </span>
                  <button
                    className="btn"
                    onClick={() => openSqlModal(t.name)}
                    title="Generate SQL for this table"
                  >
                    SQL
                  </button>
                  {!t.internal && (
                    <button
                      className="btn"
                      disabled={readOnly}
                      onClick={() =>
                        setIdxModal({
                          open: true,
                          table: t,
                          name: `idx_${t.name}_${t.columns[0]?.name || 'col'}`,
                          columns: t.columns[0] ? [t.columns[0].name] : [],
                          unique: false,
                        })
                      }
                    >
                      + Index
                    </button>
                  )}
                </div>
              </div>
              <div className="grid-wrap" style={{ marginBottom: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.columns.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.type || 'ANY'}</td>
                        <td>
                          {c.pk > 0 && <span className="badge pk">PK</span>}{' '}
                          {c.notnull > 0 && (
                            <span className="badge">NOT NULL</span>
                          )}{' '}
                          {c.dflt_value != null && (
                            <span className="badge">
                              ={String(c.dflt_value)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.indexes.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {t.indexes.map((idx) => (
                    <span
                      key={idx.name}
                      className="badge"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>
                        {idx.unique ? 'UNIQUE ' : 'IDX '}
                        {idx.name} ({idx.columns.join(', ')})
                      </span>
                      {!readOnly &&
                        !idx.name.startsWith('sqlite_autoindex_') && (
                          <button
                            onClick={() => dropIndex(t.name, idx.name)}
                            style={{
                              border: 0,
                              background: 'transparent',
                              color: 'var(--red)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 11,
                            }}
                            title="Drop index"
                          >
                            ×
                          </button>
                        )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
      </div>

      {sqlModal.open && (
        <div
          className="modal-backdrop"
          onClick={() => setSqlModal((prev) => ({ ...prev, open: false }))}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <strong>
                {sqlModal.tableName
                  ? `SQL Schema: ${sqlModal.tableName}`
                  : 'Generated SQL Schema'}
              </strong>
              <button
                className="btn"
                onClick={() =>
                  setSqlModal((prev) => ({ ...prev, open: false }))
                }
              >
                Close
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  className="input"
                  value={sqlModal.dialect}
                  onChange={(e) =>
                    setSqlModal((prev) => ({
                      ...prev,
                      dialect: e.target.value as 'sqlite' | 'postgres' | 'mysql' | 'typescript',
                    }))
                  }
                >
                  <option value="sqlite">SQLite</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="typescript">TypeScript</option>
                </select>
                {!sqlModal.tableName && (
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={sqlModal.includeSystem}
                      onChange={(e) =>
                        setSqlModal((prev) => ({
                          ...prev,
                          includeSystem: e.target.checked,
                        }))
                      }
                    />
                    Include system tables
                  </label>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  disabled={!sqlModal.sql}
                  onClick={async () => {
                    await navigator.clipboard.writeText(sqlModal.sql);
                    setSqlModal((prev) => ({ ...prev, copied: true }));
                    setTimeout(
                      () =>
                        setSqlModal((prev) => ({ ...prev, copied: false })),
                      1800,
                    );
                  }}
                >
                  {sqlModal.copied ? 'Copied!' : 'Copy SQL'}
                </button>
                {sqlModal.dialect === 'typescript' ? (
                  <button
                    className="btn primary"
                    disabled={!sqlModal.sql}
                    onClick={() => {
                      const blob = new Blob([sqlModal.sql], { type: 'text/typescript' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'schema.ts';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download .ts
                  </button>
                ) : (
                  <a
                    className="btn primary"
                    href={buildApiUrl(`/api/schema/sql?${downloadQuery.toString()}`)}
                    download
                  >
                    Download .sql
                  </a>
                )}
              </div>
            </div>

            {sqlModal.loading ? (
              <div className="empty">Generating SQL...</div>
            ) : !sqlModal.sql ? (
              <div className="empty">No tables to generate SQL for.</div>
            ) : (
              <pre style={{ maxHeight: '55vh', overflow: 'auto' }}>
                {sqlModal.sql}
              </pre>
            )}
          </div>
        </div>
      )}

      {idxModal.open && idxModal.table && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setIdxModal((prev) => ({ ...prev, open: false, table: null }))
          }
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <strong>Create Index on {idxModal.table.name}</strong>
              <button
                className="btn"
                onClick={() =>
                  setIdxModal((prev) => ({ ...prev, open: false, table: null }))
                }
              >
                Close
              </button>
            </div>
            <div className="field-row">
              <label>Index Name</label>
              <input
                className="input"
                value={idxModal.name}
                onChange={(e) =>
                  setIdxModal((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="field-row">
              <label>Columns</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {idxModal.table.columns.map((c) => {
                  const checked = idxModal.columns.includes(c.name);
                  return (
                    <label
                      key={c.name}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setIdxModal((prev) => ({
                            ...prev,
                            columns: e.target.checked
                              ? [...prev.columns, c.name]
                              : prev.columns.filter((x) => x !== c.name),
                          }));
                        }}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="field-row">
              <label
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <input
                  type="checkbox"
                  checked={idxModal.unique}
                  onChange={(e) =>
                    setIdxModal((prev) => ({
                      ...prev,
                      unique: e.target.checked,
                    }))
                  }
                />
                Unique Index
              </label>
            </div>
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button className="btn primary" onClick={createIndex}>
                Create Index
              </button>
            </div>
          </div>
        </div>
      )}

      {diffModal.open && (
        <div
          className="modal-backdrop"
          onClick={() => setDiffModal((prev) => ({ ...prev, open: false }))}
        >
          <div
            className="modal"
            style={{ width: 680, maxWidth: '94vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <strong>Migration &amp; Schema Diff Generator</strong>
              <button
                className="btn"
                onClick={() => setDiffModal((prev) => ({ ...prev, open: false }))}
              >
                Close
              </button>
            </div>
            <div className="field-row">
              <label>Target Schema SQL (leave empty for baseline migration of live DB)</label>
              <textarea
                className="input"
                rows={5}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                placeholder="CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT);"
                value={diffModal.targetSql}
                onChange={(e) =>
                  setDiffModal((prev) => ({ ...prev, targetSql: e.target.value }))
                }
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {diffModal.changes.map((c, idx) => (
                  <span key={idx} className="badge">
                    {c.table}: {c.detail}
                  </span>
                ))}
              </div>
              <button
                className="btn primary"
                disabled={diffModal.loading}
                onClick={() => void runMigrationDiff(diffModal.targetSql)}
              >
                {diffModal.loading ? 'Diffing...' : 'Compute Diff'}
              </button>
            </div>
            <div className="field-row">
              <label>Generated Migration SQL</label>
              <textarea
                className="input"
                rows={9}
                readOnly
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                value={diffModal.sql || '-- No schema differences detected'}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn"
                disabled={!diffModal.sql}
                onClick={() => {
                  void navigator.clipboard.writeText(diffModal.sql);
                  setDiffModal((prev) => ({ ...prev, copied: true }));
                }}
              >
                {diffModal.copied ? 'Copied!' : 'Copy SQL'}
              </button>
              <button
                className="btn primary"
                disabled={!diffModal.sql}
                onClick={() => {
                  const blob = new Blob([diffModal.sql], { type: 'text/sql' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `migration-${Date.now()}.sql`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .sql
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
