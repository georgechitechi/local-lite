import React, { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  OverviewResponse,
  SettingsResponse,
  TableSummary,
} from './api';
import { AuthAdminData, AuthAdminView } from './components/AuthAdminView';
import { DataView } from './components/DataView';
import { FilesView } from './components/FilesView';
import { JobsData, JobsView } from './components/JobsView';
import { OverviewView } from './components/OverviewView';
import { SchemaView } from './components/SchemaView';
import { SettingsView } from './components/SettingsView';
import { SqlConsoleView } from './components/SqlConsoleView';
import { SyncSystemView } from './components/SyncSystemView';

type ViewTab =
  | 'data'
  | 'schema'
  | 'files'
  | 'jobs'
  | 'auth'
  | 'sql'
  | 'sync'
  | 'overview'
  | 'settings';

export function App() {
  const [view, setView] = useState<ViewTab>('data');
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('local_lite_theme') as 'dark' | 'light') || 'dark',
  );
  const [pollMs, setPollMs] = useState<number>(0);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [showSystem, setShowSystem] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState<number>(
    () => Number(localStorage.getItem('local_lite_limit')) || 50,
  );
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [filterCol, setFilterCol] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [orderBy, setOrderBy] = useState('');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [system, setSystem] = useState<Record<string, any[] | null> | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [filesData, setFilesData] = useState<{
    exists: boolean;
    files: any[];
  } | null>(null);
  const [jobsData, setJobsData] = useState<JobsData | null>(null);
  const [authData, setAuthData] = useState<AuthAdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newTableModal, setNewTableModal] = useState<{
    open: boolean;
    name: string;
    columns: Array<{ name: string; type: string; pk: boolean; notnull: boolean }>;
  }>({
    open: false,
    name: '',
    columns: [
      { name: 'id', type: 'TEXT', pk: true, notnull: true },
      { name: 'title', type: 'TEXT', pk: false, notnull: true },
    ],
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    table: TableSummary;
  } | null>(null);

  const [editTableModal, setEditTableModal] = useState<{
    table: TableSummary;
    newName: string;
    colName: string;
    colType: string;
    colNotNull: boolean;
    colDefault: string;
  } | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('local_lite_theme', theme);
  }, [theme]);

  const loadTables = useCallback(async () => {
    const data = await apiRequest<{ tables: TableSummary[] }>('/api/tables');
    const list = data.tables || [];
    setTables(list);
    setSelectedTable((prev) => {
      if (prev && list.some((t) => t.name === prev)) return prev;
      const firstUser = list.find((t) => !t.internal) || list[0];
      return firstUser ? firstUser.name : null;
    });
    return list;
  }, []);

  const refreshActiveView = useCallback(async () => {
    setError(null);
    try {
      if (view === 'data') {
        const list = await loadTables();
        const active =
          selectedTable && list.some((t) => t.name === selectedTable)
            ? selectedTable
            : (list.find((t) => !t.internal) || list[0])?.name;
        if (active) {
          const q = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            search,
            filterCol,
            filterVal,
            orderBy,
            orderDir,
          });
          const data = await apiRequest<{ rows: any[]; total: number }>(
            `/api/tables/${encodeURIComponent(active)}/rows?${q.toString()}`,
          );
          setRows(data.rows || []);
          setTotal(data.total || 0);
        } else {
          setRows([]);
          setTotal(0);
        }
      } else if (view === 'schema') {
        await loadTables();
      } else if (view === 'files') {
        const f = await apiRequest<{ exists: boolean; files: any[] }>('/api/files');
        setFilesData(f);
      } else if (view === 'jobs') {
        const j = await apiRequest<JobsData>('/api/jobs');
        setJobsData(j);
      } else if (view === 'auth') {
        const a = await apiRequest<AuthAdminData>('/api/auth-admin');
        setAuthData(a);
      } else if (view === 'overview') {
        const o = await apiRequest<OverviewResponse>('/api/overview');
        setOverview(o);
      } else if (view === 'sync') {
        const s = await apiRequest<Record<string, any[] | null>>('/api/system');
        setSystem(s);
      } else if (view === 'settings') {
        const st = await apiRequest<SettingsResponse>('/api/settings');
        setSettings(st);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [
    view,
    loadTables,
    selectedTable,
    limit,
    offset,
    search,
    filterCol,
    filterVal,
    orderBy,
    orderDir,
  ]);

  useEffect(() => {
    refreshActiveView();
  }, [refreshActiveView]);

  useEffect(() => {
    apiRequest<OverviewResponse>('/api/overview')
      .then(setOverview)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (pollMs <= 0) return;
    const id = window.setInterval(refreshActiveView, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refreshActiveView]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleCreateTable = async () => {
    try {
      setError(null);
      await apiRequest('/api/tables', {
        method: 'POST',
        body: JSON.stringify({
          name: newTableModal.name.trim(),
          columns: newTableModal.columns,
        }),
      });
      const created = newTableModal.name.trim();
      setNewTableModal({
        open: false,
        name: '',
        columns: [
          { name: 'id', type: 'TEXT', pk: true, notnull: true },
          { name: 'title', type: 'TEXT', pk: false, notnull: true },
        ],
      });
      setSelectedTable(created);
      setView('data');
      await refreshActiveView();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const visibleTables = tables.filter(
    (t) =>
      (showSystem || !t.internal) &&
      (!tableFilter.trim() ||
        t.name.toLowerCase().includes(tableFilter.trim().toLowerCase())),
  );

  const selectedMeta = tables.find((t) => t.name === selectedTable);
  const readOnly = Boolean(overview?.readOnly);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>{overview?.title || 'local-lite Dashboard'}</span>
          <span className={`badge ${readOnly ? 'ro' : 'ok'}`}>
            {readOnly ? 'Read-Only' : 'Read / Write'}
          </span>
          <span className="badge">SQLite {overview?.sqliteVersion || ''}</span>
        </div>
        <div className="top-actions">
          <select
            className="input"
            value={pollMs}
            onChange={(e) => setPollMs(Number(e.target.value))}
          >
            <option value={0}>Live: Off</option>
            <option value={2000}>Live: 2s</option>
            <option value={5000}>Live: 5s</option>
            <option value={10000}>Live: 10s</option>
          </select>
          <button className="btn" onClick={refreshActiveView}>
            Refresh
          </button>
        </div>
      </div>

      <div className="workspace">
        <aside className="nav">
          <div className="nav-tabs">
            {(
              [
                ['data', 'Data'],
                ['schema', 'Schema & Indexes'],
                ['files', 'File Storage'],
                ['jobs', 'Schedules & Actions'],
                ['auth', 'Auth & API Keys'],
                ['sql', 'SQL Console'],
                ['sync', 'Sync & System'],
                ['overview', 'Overview'],
                ['settings', 'Settings'],
              ] as [ViewTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className={`nav-btn ${view === id ? 'active' : ''}`}
                onClick={() => setView(id)}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="tables-header">
            <span>Tables</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {!readOnly && (
                <button
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 11 }}
                  onClick={() =>
                    setNewTableModal((prev) => ({ ...prev, open: true }))
                  }
                >
                  + New
                </button>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  textTransform: 'none',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={showSystem}
                  onChange={(e) => setShowSystem(e.target.checked)}
                />{' '}
                sys
              </label>
            </div>
          </div>
          <div className="table-filter-wrap">
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="Filter tables..."
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
            />
          </div>
          <div className="tables-list">
            {visibleTables.length === 0 ? (
              <div style={{ padding: 10, color: 'var(--muted)' }}>
                No matching tables
              </div>
            ) : (
              visibleTables.map((t) => (
                <div
                  key={t.name}
                  className={`table-item ${selectedTable === t.name ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedTable(t.name);
                    setOffset(0);
                    setOrderBy('');
                    setFilterCol('');
                    setFilterVal('');
                    if (view !== 'data' && view !== 'schema') setView('data');
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, table: t });
                  }}
                >
                  <span className="name">{t.name}</span>
                  <span className="cnt">{t.rowCount}</span>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="main">
          {error && (
            <div style={{ padding: '12px 16px 0' }}>
              <div className="error-banner">{error}</div>
            </div>
          )}

          {view === 'data' && (
            <DataView
              tableMeta={selectedMeta}
              rows={rows}
              total={total}
              limit={limit}
              offset={offset}
              search={search}
              filterCol={filterCol}
              filterVal={filterVal}
              orderBy={orderBy}
              orderDir={orderDir}
              readOnly={readOnly}
              onSearchChange={(v) => {
                setSearch(v);
                setOffset(0);
              }}
              onFilterColChange={(v) => {
                setFilterCol(v);
                setOffset(0);
              }}
              onFilterValChange={(v) => {
                setFilterVal(v);
                setOffset(0);
              }}
              onSortChange={(col) => {
                if (orderBy === col) {
                  setOrderDir((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
                } else {
                  setOrderBy(col);
                  setOrderDir('ASC');
                }
                setOffset(0);
              }}
              onPageChange={setOffset}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
          {view === 'schema' && (
            <SchemaView
              tables={tables}
              showSystem={showSystem}
              readOnly={readOnly}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
          {view === 'files' && (
            <FilesView
              filesData={filesData}
              readOnly={readOnly}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
          {view === 'jobs' && (
            <JobsView
              jobsData={jobsData}
              readOnly={readOnly}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
          {view === 'auth' && (
            <AuthAdminView
              authData={authData}
              readOnly={readOnly}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
          {view === 'sql' && (
            <SqlConsoleView selectedTable={selectedTable} onError={setError} />
          )}
          {view === 'sync' && <SyncSystemView system={system} />}
          {view === 'overview' && <OverviewView overview={overview} />}
          {view === 'settings' && (
            <SettingsView
              settings={settings}
              theme={theme}
              pageSize={limit}
              onThemeChange={setTheme}
              onPageSizeChange={(size) => {
                setLimit(size);
                localStorage.setItem('local_lite_limit', String(size));
              }}
              onRefresh={refreshActiveView}
              onError={setError}
            />
          )}
        </main>
      </div>

      {newTableModal.open && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setNewTableModal((prev) => ({ ...prev, open: false }))
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
              <strong>Create New Table</strong>
              <button
                className="btn"
                onClick={() =>
                  setNewTableModal((prev) => ({ ...prev, open: false }))
                }
              >
                Close
              </button>
            </div>
            <div className="field-row">
              <label>Table Name</label>
              <input
                className="input"
                placeholder="e.g. projects"
                value={newTableModal.name}
                onChange={(e) =>
                  setNewTableModal((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>
            <div className="field-row">
              <label>Columns</label>
              {newTableModal.columns.map((col, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: 6,
                    marginBottom: 6,
                    alignItems: 'center',
                  }}
                >
                  <input
                    className="input"
                    placeholder="name"
                    value={col.name}
                    onChange={(e) => {
                      const next = [...newTableModal.columns];
                      next[idx] = { ...col, name: e.target.value };
                      setNewTableModal((prev) => ({ ...prev, columns: next }));
                    }}
                  />
                  <select
                    className="input"
                    style={{ width: 120 }}
                    value={col.type}
                    onChange={(e) => {
                      const next = [...newTableModal.columns];
                      next[idx] = { ...col, type: e.target.value };
                      setNewTableModal((prev) => ({ ...prev, columns: next }));
                    }}
                  >
                    {['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={col.pk}
                      onChange={(e) => {
                        const next = [...newTableModal.columns];
                        next[idx] = { ...col, pk: e.target.checked };
                        setNewTableModal((prev) => ({ ...prev, columns: next }));
                      }}
                    />
                    PK
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={col.notnull}
                      onChange={(e) => {
                        const next = [...newTableModal.columns];
                        next[idx] = { ...col, notnull: e.target.checked };
                        setNewTableModal((prev) => ({ ...prev, columns: next }));
                      }}
                    />
                    NN
                  </label>
                  <button
                    className="btn danger"
                    onClick={() =>
                      setNewTableModal((prev) => ({
                        ...prev,
                        columns: prev.columns.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setNewTableModal((prev) => ({
                    ...prev,
                    columns: [
                      ...prev.columns,
                      { name: '', type: 'TEXT', pk: false, notnull: false },
                    ],
                  }))
                }
              >
                + Add Column
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={handleCreateTable}>
                Create Table
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            disabled={readOnly || contextMenu.table.internal}
            onClick={() => {
              const t = contextMenu.table;
              setContextMenu(null);
              setEditTableModal({
                table: t,
                newName: t.name,
                colName: '',
                colType: 'TEXT',
                colNotNull: false,
                colDefault: '',
              });
            }}
          >
            <span>Edit Table &amp; Columns</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const t = contextMenu.table;
              setContextMenu(null);
              setSelectedTable(t.name);
              setView('schema');
            }}
          >
            <span>View Schema</span>
          </button>
          <div className="context-menu-sep" />
          <button
            className="context-menu-item danger"
            disabled={readOnly || contextMenu.table.internal}
            onClick={async () => {
              const t = contextMenu.table;
              setContextMenu(null);
              if (!window.confirm(`Delete ALL rows from "${t.name}"?`)) return;
              try {
                setError(null);
                await apiRequest(`/api/tables/${encodeURIComponent(t.name)}/clear`, {
                  method: 'POST',
                });
                await refreshActiveView();
              } catch (err: any) {
                setError(err.message);
              }
            }}
          >
            <span>Clear Rows</span>
          </button>
          <button
            className="context-menu-item danger"
            disabled={readOnly || contextMenu.table.internal}
            onClick={async () => {
              const t = contextMenu.table;
              setContextMenu(null);
              if (!window.confirm(`DROP table "${t.name}" permanently?`)) return;
              try {
                setError(null);
                await apiRequest(`/api/tables/${encodeURIComponent(t.name)}`, {
                  method: 'DELETE',
                });
                if (selectedTable === t.name) setSelectedTable(null);
                await refreshActiveView();
              } catch (err: any) {
                setError(err.message);
              }
            }}
          >
            <span>Drop Table</span>
          </button>
        </div>
      )}

      {editTableModal && (
        <div
          className="modal-backdrop"
          onClick={() => setEditTableModal(null)}
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
              <strong>Edit Table: {editTableModal.table.name}</strong>
              <button
                className="btn"
                onClick={() => setEditTableModal(null)}
              >
                Close
              </button>
            </div>

            <div className="field-row">
              <label>Rename Table</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  value={editTableModal.newName}
                  onChange={(e) =>
                    setEditTableModal((prev) =>
                      prev ? { ...prev, newName: e.target.value } : null,
                    )
                  }
                />
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      setError(null);
                      const nextName = editTableModal.newName.trim();
                      await apiRequest(
                        `/api/tables/${encodeURIComponent(editTableModal.table.name)}`,
                        {
                          method: 'PATCH',
                          body: JSON.stringify({ newName: nextName }),
                        },
                      );
                      if (selectedTable === editTableModal.table.name) {
                        setSelectedTable(nextName);
                      }
                      setEditTableModal(null);
                      await refreshActiveView();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                >
                  Rename
                </button>
              </div>
            </div>

            <div className="field-row" style={{ marginTop: 14 }}>
              <label>Columns ({editTableModal.table.columns.length})</label>
              <div className="grid-wrap" style={{ maxHeight: 180, marginBottom: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Flags</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editTableModal.table.columns.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.type || 'ANY'}</td>
                        <td>
                          {c.pk > 0 && <span className="badge pk">PK</span>}{' '}
                          {c.notnull > 0 && <span className="badge">NN</span>}
                        </td>
                        <td>
                          <button
                            className="btn danger"
                            disabled={c.pk > 0}
                            onClick={async () => {
                              if (!window.confirm(`Drop column "${c.name}"?`)) return;
                              try {
                                setError(null);
                                await apiRequest(
                                  `/api/tables/${encodeURIComponent(editTableModal.table.name)}`,
                                  {
                                    method: 'PATCH',
                                    body: JSON.stringify({ dropColumn: c.name }),
                                  },
                                );
                                setEditTableModal(null);
                                await refreshActiveView();
                              } catch (err: any) {
                                setError(err.message);
                              }
                            }}
                          >
                            Drop
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="field-row">
              <label>Add Column</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 120 }}
                  placeholder="column_name"
                  value={editTableModal.colName}
                  onChange={(e) =>
                    setEditTableModal((prev) =>
                      prev ? { ...prev, colName: e.target.value } : null,
                    )
                  }
                />
                <select
                  className="input"
                  style={{ width: 110 }}
                  value={editTableModal.colType}
                  onChange={(e) =>
                    setEditTableModal((prev) =>
                      prev ? { ...prev, colType: e.target.value } : null,
                    )
                  }
                >
                  {['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 110 }}
                  placeholder="default..."
                  value={editTableModal.colDefault}
                  onChange={(e) =>
                    setEditTableModal((prev) =>
                      prev ? { ...prev, colDefault: e.target.value } : null,
                    )
                  }
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: 0 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={editTableModal.colNotNull}
                    onChange={(e) =>
                      setEditTableModal((prev) =>
                        prev ? { ...prev, colNotNull: e.target.checked } : null,
                      )
                    }
                  />
                  NN
                </label>
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      setError(null);
                      await apiRequest(
                        `/api/tables/${encodeURIComponent(editTableModal.table.name)}`,
                        {
                          method: 'PATCH',
                          body: JSON.stringify({
                            addColumn: {
                              name: editTableModal.colName.trim(),
                              type: editTableModal.colType,
                              notnull: editTableModal.colNotNull,
                              defaultValue: editTableModal.colDefault,
                            },
                          }),
                        },
                      );
                      setEditTableModal(null);
                      await refreshActiveView();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                >
                  + Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
