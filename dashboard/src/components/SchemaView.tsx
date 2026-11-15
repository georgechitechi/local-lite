import React from 'react';
import { TableSummary } from '../api';

interface SchemaViewProps {
  tables: TableSummary[];
  showSystem: boolean;
}

export const SchemaView: React.FC<SchemaViewProps> = ({ tables, showSystem }) => {
  const visible = tables.filter((t) => showSystem || !t.internal);

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
                <span className="badge">
                  {t.rowCount} rows • {t.columns.length} cols
                </span>
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
                          {c.notnull > 0 && <span className="badge">NOT NULL</span>}{' '}
                          {c.dflt_value != null && (
                            <span className="badge">={String(c.dflt_value)}</span>
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
                    <span key={idx.name} className="badge">
                      {idx.unique ? 'UNIQUE ' : 'IDX '}
                      {idx.name} ({idx.columns.join(', ')})
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
