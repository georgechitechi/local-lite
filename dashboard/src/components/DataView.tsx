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
  onLimitChange: (nextLimit: number) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onNotify: (msg: string) => void;
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
  onLimitChange,
  onRefresh,
  onError,
  onNotify,
}) => {
  const [inspectRow, setInspectRow] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('[\n  \n]');
  const [selectedRowIdxs, setSelectedRowIdxs] = useState<number[]>([]);
  const [inlineEdit, setInlineEdit] = useState<{
    rowIdx: number;
    col: string;
    value: string;
  } | null>(null);
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
      onNotify('Row deleted');
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRowIdxs.length === 0 || pkCols.length === 0) return;
    if (!window.confirm(`Delete ${selectedRowIdxs.length} selected row(s)?`)) return;
    try {
      onError(null);
      for (const idx of selectedRowIdxs) {
        const row = rows[idx];
        if (!row) continue;
        const key: Record<string, any> = {};
        pkCols.forEach((pk) => {
          key[pk] = row[pk];
        });
        await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/rows`, {
          method: 'DELETE',
          body: JSON.stringify({ key }),
        });
      }
      const count = selectedRowIdxs.length;
      setSelectedRowIdxs([]);
      onNotify(`Deleted ${count} row(s)`);
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const commitInlineEdit = async () => {
    if (!inlineEdit || pkCols.length === 0) {
      setInlineEdit(null);
      return;
    }
    const row = rows[inlineEdit.rowIdx];
    if (!row) {
      setInlineEdit(null);
      return;
    }
    const key: Record<string, any> = {};
    pkCols.forEach((pk) => {
      key[pk] = row[pk];
    });
    try {
      onError(null);
      await apiRequest(`/api/tables/${encodeURIComponent(tableMeta.name)}/rows`, {
        method: 'PATCH',
        body: JSON.stringify({
          key,
          updates: { [inlineEdit.col]: inlineEdit.value === '' ? null : inlineEdit.value },
        }),
      });
      setInlineEdit(null);
      onNotify(`Updated ${inlineEdit.col}`);
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
          {selectedRowIdxs.length > 0 && !readOnly && pkCols.length > 0 && (
            <button className="btn danger" onClick={handleBulkDelete}>
              Delete Selected ({selectedRowIdxs.length})
            </button>
          )}
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
                {!readOnly && pkCols.length > 0 && (
                  <th style={{ width: 32, cursor: 'default' }}>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedRowIdxs.length === rows.length}
                      onChange={(e) =>
                        setSelectedRowIdxs(
                          e.target.checked ? rows.map((_, i) => i) : [],
                        )
                      }
                    />
                  </th>
                )}
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
                  <td colSpan={cols.length + (!readOnly && pkCols.length > 0 ? 2 : 1)} className="empty">
                    No rows found
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={idx}>
                    {!readOnly && pkCols.length > 0 && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedRowIdxs.includes(idx)}
                          onChange={(e) =>
                            setSelectedRowIdxs((prev) =>
                              e.target.checked
                                ? [...prev, idx]
                                : prev.filter((x) => x !== idx),
                            )
                          }
                        />
                      </td>
                    )}
                    {cols.map((c) => {
                      const isEditing =
                        inlineEdit?.rowIdx === idx && inlineEdit?.col === c;
                      const canInline = !readOnly && pkCols.length > 0 && !pkCols.includes(c);
                      return (
                        <td
                          key={c}
                          onClick={() => {
                            if (!isEditing) setInspectRow(r);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!canInline) return;
                            const rawVal = r[c];
                            setInlineEdit({
                              rowIdx: idx,
                              col: c,
                              value:
                                rawVal === null || rawVal === undefined
                                  ? ''
                                  : typeof rawVal === 'object'
                                    ? JSON.stringify(rawVal)
                                    : String(rawVal),
                            });
                          }}
                          title={canInline ? 'Click to inspect • Double-click to edit' : 'Click to inspect'}
                          style={{ cursor: 'pointer' }}
                        >
                          {isEditing ? (
                            <input
                              className="inline-cell-input"
                              autoFocus
                              value={inlineEdit.value}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setInlineEdit((prev) =>
                                  prev ? { ...prev, value: e.target.value } : null,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitInlineEdit();
                                } else if (e.key === 'Escape') {
                                  setInlineEdit(null);
                                }
                              }}
                              onBlur={commitInlineEdit}
                            />
                          ) : (
                            formatCell(r[c])
                          )}
                        </td>
                      );
                    })}
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              className="input"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              {[25, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
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
