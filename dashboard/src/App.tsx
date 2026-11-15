import React, { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  OverviewResponse,
  SettingsResponse,
  TableSummary,
} from './api';
import { DataView } from './components/DataView';
import { OverviewView } from './components/OverviewView';
import { SchemaView } from './components/SchemaView';
import { SettingsView } from './components/SettingsView';
import { SqlConsoleView } from './components/SqlConsoleView';
import { SyncSystemView } from './components/SyncSystemView';

type ViewTab = 'data' | 'schema' | 'sql' | 'sync' | 'overview' | 'settings';

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
  const [error, setError] = useState<string | null>(null);

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
          <span className="badge">
            SQLite {overview?.sqliteVersion || ''}
          </span>
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
            <SchemaView tables={tables} showSystem={showSystem} />
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
    </div>
  );
}
