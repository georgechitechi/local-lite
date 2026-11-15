import React, { useState } from 'react';
import { apiRequest, TableSummary } from '../api';

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

  const visible = tables.filter((t) => showSystem || !t.internal);

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

  return (
    <>
      <div className="toolbar">
        <strong>Schema &amp; Indexes</strong>
        <span className="badge">{visible.length} tables</span>
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
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>
                        {idx.unique ? 'UNIQUE ' : 'IDX '}
                        {idx.name} ({idx.columns.join(', ')})
                      </span>
                      {!readOnly && !idx.name.startsWith('sqlite_autoindex_') && (
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
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
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
