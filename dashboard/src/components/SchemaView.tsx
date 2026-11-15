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
        </div>
        <button
          className="btn primary"
          disabled={visible.length === 0}
          onClick={() => openSqlModal(null)}
        >
          Generate SQL Schema
        </button>
      </div>
      <div className="content">
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
    </>
  );
};
