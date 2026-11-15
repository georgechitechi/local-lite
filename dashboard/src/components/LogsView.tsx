import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api';

export interface LogEntry {
  id: number;
  timestamp: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  detail?: string;
}

interface LogsViewProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function LogsView({ onNotify }: LogsViewProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'' | 'ok' | 'error'>('');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (level) params.set('level', level);
      if (search.trim()) params.set('q', search.trim());
      const res = await apiRequest<{ logs: LogEntry[] }>(`/api/logs?${params.toString()}`);
      setLogs(res.logs ?? []);
    } catch (err: any) {
      onNotify(err?.message ?? 'Failed to load logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [level, search, onNotify]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadLogs();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadLogs]);

  const handleClear = async () => {
    try {
      await apiRequest('/api/logs', { method: 'DELETE' });
      setLogs([]);
      onNotify('Logs cleared', 'success');
    } catch (err: any) {
      onNotify(err?.message ?? 'Failed to clear logs', 'error');
    }
  };

  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="Filter by path, method, or SQL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 130 }}
            value={level}
            onChange={(e) => setLevel(e.target.value as '' | 'ok' | 'error')}
          >
            <option value="">All Status</option>
            <option value="ok">2xx / 3xx</option>
            <option value="error">4xx / 5xx</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Live (2.5s)
          </label>
          <button className="btn" onClick={() => void loadLogs()} disabled={loading}>
            Refresh
          </button>
          <button className="btn danger" onClick={() => void handleClear()} disabled={logs.length === 0}>
            Clear
          </button>
        </div>
      </div>

      <div className="content">
        {logs.length === 0 ? (
          <div className="empty-state">
            No API or query logs recorded yet. Run queries or browse tables to see live telemetry here.
          </div>
        ) : (
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Time</th>
                  <th style={{ width: 80 }}>Method</th>
                  <th style={{ width: 220 }}>Endpoint</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 90 }}>Duration</th>
                  <th>Detail / SQL</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => {
                  const isError = entry.status >= 400;
                  return (
                    <tr key={entry.id}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td>
                        <span className="badge">{entry.method}</span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{entry.path}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            color: isError ? 'var(--red)' : 'var(--green)',
                            borderColor: isError ? 'var(--red)' : 'var(--green)',
                          }}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                        {entry.durationMs.toFixed(1)} ms
                      </td>
                      <td
                        style={{
                          fontFamily: 'var(--mono)',
                          maxWidth: 420,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={entry.detail ?? ''}
                      >
                        {entry.detail || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
