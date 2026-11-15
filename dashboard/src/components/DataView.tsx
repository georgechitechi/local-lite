import React, { useState } from 'react';
import { apiRequest, buildApiUrl, TableSummary } from '../api';

interface DataViewProps {
  tableMeta: TableSummary | undefined;
  rows: any[];
  total: number;
  limit: number;
  offset: number;
  search: string;
  filterCol: string;
  filterVal: string;
  orderBy: string;
  orderDir: 'ASC' | 'DESC';
  readOnly: boolean;
  onSearchChange: (v: string) => void;
  onFilterColChange: (v: string) => void;
  onFilterValChange: (v: string) => void;
  onSortChange: (col: string) => void;
  onPageChange: (nextOffset: number) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const DataView: React.FC<DataViewProps> = ({
  tableMeta,
  rows,
  total,
  limit,
  offset,
  search,
  filterCol,
  filterVal,
  orderBy,
  orderDir,
  readOnly,
  onSearchChange,
  onFilterColChange,
  onFilterValChange,
  onSortChange,
  onPageChange,
  onRefresh,
  onError,
}) => {
  const [inspectRow, setInspectRow] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('[\n  \n]');
  const [editorState, setEditorState] = useState<{
    open: boolean;
    existing: any | null;
    values: Record<string, string>;
  }>({ open: false, existing: null, values: {} });

  if (!tableMeta) {
    return (
      <>
        <div className="toolbar">
          <strong>Data Explorer</strong>
        </div>
        <div className="content">
          <div className="empty">Select a table from the left sidebar.</div>
        </div>
      </>
    );
  }

  const cols = tableMeta.columns.map((c) => c.name);
  const pkCols = tableMeta.columns.filter((c) => c.pk > 0).map((c) => c.name);
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + rows.length);

  const openEditor = (existing: any | null) => {
    const initial: Record<string, string> = {};
    tableMeta.columns.forEach((c) => {
      const v = existing ? existing[c.name] : '';
      initial[c.name] =
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
    });
    setEditorState({ open: true, existing, values: initial });
  };

  const handleSave = async () => {
    try {
      onError(null);
      const payload: Record<string, any> = {};
      tableMeta.columns.forEach((c) => {
        if (editorState.existing && pkCols.includes(c.name)) return;
        const v = editorState.values[c.name] ?? '';
        if (v !== '' || editorState.existing) {
          payload[c.name] = v === '' ? null : v;
        }
      });

      if (editorState.existing) {
        const key: Record<string, any> = {};
        pkCols.forEach((pk) => {
          key[pk] = editorState.existing[pk];
        });
        await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/rows`, {
          method: 'PATCH',
          body: JSON.stringify({ key, updates: payload }),
        });
      } else {
        await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/rows`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setEditorState({ open: false, existing: null, values: {} });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const handleDelete = async (row: any) => {
    if (!window.confirm('Delete this row?')) return;
    try {
      onError(null);
      const key: Record<string, any> = {};
      pkCols.forEach((pk) => {
        key[pk] = row[pk];
      });
      await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ key }),
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const handleImport = async () => {
    try {
      onError(null);
      const parsed = JSON.parse(importText);
      const rowsArr = Array.isArray(parsed) ? parsed : [parsed];
      await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/import`, {
        method: 'POST',
        body: JSON.stringify({ rows: rowsArr }),
      });
      setImportOpen(false);
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const handleClearTable = async () => {
    if (!window.confirm(`Delete ALL rows from "${tableMeta.name}"?`)) return;
    try {
      onError(null);
      await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/clear`, {
        method: 'POST',
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const handleDropTable = async () => {
    if (!window.confirm(`DROP table "${tableMeta.name}" permanently?`)) return;
    try {
      onError(null);
      await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}`, {
        method: 'DELETE',
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong>{tableMeta.name}</strong>
          <span className="badge">{total} rows</span>
          <input
            className="input"
            placeholder="Search rows..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <select
            className="input"
            value={filterCol}
            onChange={(e) => onFilterColChange(e.target.value)}
          >
            <option value="">Filter column...</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Equals..."
            style={{ width: 120 }}
            value={filterVal}
            onChange={(e) => onFilterValChange(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={readOnly}
            onClick={() => setImportOpen(true)}
          >
            Import JSON
          </button>
          <a
            className="btn"
            href={buildApiUrl(
              `/api/tables/${encodeURIComponent(tableMeta.name)}/export?format=csv`,
            )}
            download
          >
            CSV
          </a>
          <a
            className="btn"
            href={buildApiUrl(
              `/api/tables/${encodeURIComponent(tableMeta.name)}/export?format=json`,
            )}
            download
          >
            JSON
          </a>
          {!tableMeta.internal && (
            <>
              <button
                className="btn danger"
                disabled={readOnly}
                onClick={handleClearTable}
              >
                Clear
              </button>
              <button
                className="btn danger"
                disabled={readOnly}
                onClick={handleDropTable}
              >
                Drop
              </button>
            </>
          )}
          <button
            className="btn primary"
            disabled={readOnly}
            onClick={() => openEditor(null)}
          >
            + Insert Row
          </button>
        </div>
      </div>

      <div className="content">
        <div className="grid-wrap">
          <table>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} onClick={() => onSortChange(c)}>
                    {c}
                    {orderBy === c ? (orderDir === 'ASC' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th style={{ cursor: 'default' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="empty">
                    No rows found
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={idx}>
                    {cols.map((c) => (
                      <td
                        key={c}
                        onClick={() => setInspectRow(r)}
                        style={{ cursor: 'pointer' }}
                      >
                        {formatCell(r[c])}
                      </td>
                    ))}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn"
                        disabled={readOnly || pkCols.length === 0}
                        onClick={() => openEditor(r)}
                        style={{ marginRight: 4 }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn danger"
                        disabled={readOnly || pkCols.length === 0}
                        onClick={() => handleDelete(r)}
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
            color: 'var(--muted)',
          }}
        >
          <span>
            Showing {start}–{end} of {total}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn"
              disabled={offset === 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
            >
              Prev
            </button>
            <button
              className="btn"
              disabled={offset + limit >= total}
              onClick={() => onPageChange(offset + limit)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {inspectRow && (
        <div className="modal-backdrop" onClick={() => setInspectRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <strong>Row JSON</strong>
              <button className="btn" onClick={() => setInspectRow(null)}>
                Close
              </button>
            </div>
            <pre>{JSON.stringify(inspectRow, null, 2)}</pre>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <strong>Import JSON Rows into {tableMeta.name}</strong>
              <button className="btn" onClick={() => setImportOpen(false)}>
                Close
              </button>
            </div>
            <textarea
              className="sql"
              style={{ minHeight: 180 }}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={handleImport}>
                Import Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {editorState.open && (
        <div
          className="modal-backdrop"
          onClick={() => setEditorState({ open: false, existing: null, values: {} })}
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
                {editorState.existing ? 'Edit row in ' : 'Insert into '}
                {tableMeta.name}
              </strong>
              <button
                className="btn"
                onClick={() => setEditorState({ open: false, existing: null, values: {} })}
              >
                Close
              </button>
            </div>
            <div>
              {tableMeta.columns.map((c) => {
                const disabled = Boolean(editorState.existing && pkCols.includes(c.name));
                return (
                  <div key={c.name} className="field-row">
                    <label>
                      {c.name}{' '}
                      <span style={{ color: 'var(--muted)' }}>
                        ({c.type || 'ANY'}
                        {c.pk ? ', PK' : ''}
                        {c.notnull ? ', NOT NULL' : ''})
                      </span>
                    </label>
                    <input
                      className="input"
                      disabled={disabled}
                      value={editorState.values[c.name] ?? ''}
                      onChange={(e) =>
                        setEditorState((prev) => ({
                          ...prev,
                          values: { ...prev.values, [c.name]: e.target.value },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={handleSave}>
                {editorState.existing ? 'Save Changes' : 'Insert Row'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
