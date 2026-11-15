import React, { useEffect, useState } from 'react';
import {
  apiRequest,
  buildApiUrl,
  getApiBase,
  getAuthToken,
  KVStoreEntry,
  SettingsResponse,
} from '../api';

interface SettingsViewProps {
  settings: SettingsResponse | null;
  theme: 'dark' | 'light';
  pageSize: number;
  onThemeChange: (theme: 'dark' | 'light') => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  theme,
  pageSize,
  onThemeChange,
  onPageSizeChange,
  onRefresh,
  onError,
}) => {
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase());
  const [tokenInput, setTokenInput] = useState(getAuthToken());

  const [journalMode, setJournalMode] = useState('WAL');
  const [synchronous, setSynchronous] = useState('1');
  const [busyTimeout, setBusyTimeout] = useState('5000');
  const [cacheSize, setCacheSize] = useState('-64000');
  const [foreignKeys, setForeignKeys] = useState('1');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  const [kvModal, setKvModal] = useState<{
    open: boolean;
    editing: KVStoreEntry | null;
    key: string;
    type: string;
    value: string;
    ttlMs: string;
  }>({
    open: false,
    editing: null,
    key: '',
    type: 'string',
    value: '',
    ttlMs: '',
  });

  useEffect(() => {
    if (!settings) return;
    setJournalMode(String(settings.pragmas.journalMode || 'WAL').toUpperCase());
    setSynchronous(String(settings.pragmas.synchronous ?? 1));
    setBusyTimeout(String(settings.pragmas.busyTimeout ?? 5000));
    setCacheSize(String(settings.pragmas.cacheSize ?? -64000));
    setForeignKeys(settings.pragmas.foreignKeys ? '1' : '0');
  }, [settings]);

  const saveConnection = () => {
    localStorage.setItem('local_lite_api_base', apiBaseInput.trim());
    localStorage.setItem('local_lite_auth_token', tokenInput.trim());
    setStatusMsg('Connection settings saved.');
    onRefresh();
  };

  const exportEncryptedBackup = async () => {
    if (backupPassphrase.length < 4) {
      onError('Passphrase must be at least 4 characters.');
      return;
    }
    setBackupBusy(true);
    try {
      onError(null);
      const res = await apiRequest<{
        filename: string;
        sizeBytes: number;
        tableCount: number;
        dataBase64: string;
      }>('/api/backups/export', {
        method: 'POST',
        body: JSON.stringify({ passphrase: backupPassphrase }),
      });
      const bin = atob(res.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(`Exported ${res.tableCount} tables (${res.sizeBytes} bytes encrypted).`);
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreEncryptedBackup = async (file: File) => {
    if (!restorePassphrase) {
      onError('Enter the backup passphrase before selecting a file.');
      return;
    }
    setBackupBusy(true);
    try {
      onError(null);
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const dataBase64 = btoa(bin);
      const res = await apiRequest<{ restoredTables: number; restoredRows: number }>(
        '/api/backups/restore',
        {
          method: 'POST',
          body: JSON.stringify({ passphrase: restorePassphrase, dataBase64 }),
        },
      );
      setStatusMsg(`Restored ${res.restoredTables} tables (${res.restoredRows} rows).`);
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const applyPragma = async (pragma: string, value: string | number | boolean) => {
    onError(null);
    setStatusMsg(null);
    try {
      await apiRequest('/api/settings/pragma', {
        method: 'POST',
        body: JSON.stringify({ pragma, value }),
      });
      setStatusMsg(`Updated PRAGMA ${pragma}.`);
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const runMaintenance = async (action: string) => {
    onError(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ message?: string }>(
        '/api/settings/maintenance',
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        },
      );
      setStatusMsg(res.message || 'Maintenance completed.');
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const saveKvEntry = async () => {
    try {
      onError(null);
      await apiRequest('/api/kv-store', {
        method: 'POST',
        body: JSON.stringify({
          key: kvModal.key.trim(),
          type: kvModal.type,
          value: kvModal.value,
          ttlMs: kvModal.ttlMs.trim() ? Number(kvModal.ttlMs) : null,
        }),
      });
      setKvModal({
        open: false,
        editing: null,
        key: '',
        type: 'string',
        value: '',
        ttlMs: '',
      });
      setStatusMsg('KV Store key saved.');
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const deleteKvEntry = async (key: string) => {
    if (!window.confirm(`Delete key "${key}"?`)) return;
    try {
      onError(null);
      await apiRequest('/api/kv-store', {
        method: 'DELETE',
        body: JSON.stringify({ key }),
      });
      setStatusMsg(`Deleted key "${key}".`);
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const readOnly = Boolean(settings?.dashboard.readOnly);
  const kvEntries = settings?.kvStore.entries ?? [];
  const sync = settings?.sync;

  return (
    <>
      <div className="toolbar">
        <strong>Settings &amp; Administration</strong>
      </div>
      <div className="content">
        {statusMsg && <div className="success-banner">{statusMsg}</div>}

        {!settings ? (
          <div className="empty">Loading settings...</div>
        ) : (
          <div className="settings-grid">
            <div className="card">
              <div className="label" style={{ marginBottom: 10 }}>
                Dashboard &amp; Connection
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>Title</strong>
                  <span>Configured dashboard header title</span>
                </div>
                <span className="badge">{settings.dashboard.title}</span>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>Access Mode</strong>
                  <span>
                    Write operations are {readOnly ? 'blocked' : 'enabled'}
                  </span>
                </div>
                <span className={`badge ${readOnly ? 'ro' : 'ok'}`}>
                  {readOnly ? 'Read-Only' : 'Read / Write'}
                </span>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>API Base URL</strong>
                  <span>Leave blank to use Vite dev proxy (/api)</span>
                </div>
                <input
                  className="input"
                  style={{ width: 190 }}
                  placeholder="http://127.0.0.1:4312"
                  value={apiBaseInput}
                  onChange={(e) => setApiBaseInput(e.target.value)}
                />
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>Auth Token</strong>
                  <span>Optional Bearer token for protected servers</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    type="password"
                    style={{ width: 140 }}
                    placeholder="Token..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button className="btn" onClick={saveConnection}>
                    Save
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>Theme</strong>
                  <span>Switch between dark and light mode</span>
                </div>
                <select
                  className="input"
                  value={theme}
                  onChange={(e) =>
                    onThemeChange(e.target.value as 'dark' | 'light')
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>Rows Per Page</strong>
                  <span>Default pagination size for Data view</span>
                </div>
                <select
                  className="input"
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                >
                  {[25, 50, 100, 250].map((n) => (
                    <option key={n} value={n}>
                      {n} rows
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="card">
              <div className="label" style={{ marginBottom: 10 }}>
                SQLite PRAGMAs &amp; Maintenance
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>journal_mode</strong>
                  <span>Current: {settings.pragmas.journalMode}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="input"
                    disabled={readOnly}
                    value={journalMode}
                    onChange={(e) => setJournalMode(e.target.value)}
                  >
                    {['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY'].map(
                      (m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ),
                    )}
                  </select>
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() => applyPragma('journal_mode', journalMode)}
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <strong>synchronous</strong>
                  <span>0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="input"
                    disabled={readOnly}
                    value={synchronous}
                    onChange={(e) => setSynchronous(e.target.value)}
                  >
                    <option value="0">0 (OFF)</option>
                    <option value="1">1 (NORMAL)</option>
                    <option value="2">2 (FULL)</option>
                    <option value="3">3 (EXTRA)</option>
                  </select>
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() =>
                      applyPragma('synchronous', Number(synchronous))
                    }
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <strong>busy_timeout (ms)</strong>
                  <span>Lock wait timeout in milliseconds</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 90 }}
                    disabled={readOnly}
                    value={busyTimeout}
                    onChange={(e) => setBusyTimeout(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() =>
                      applyPragma('busy_timeout', Number(busyTimeout))
                    }
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <strong>cache_size</strong>
                  <span>Pages (positive) or KiB (negative)</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 90 }}
                    disabled={readOnly}
                    value={cacheSize}
                    onChange={(e) => setCacheSize(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() => applyPragma('cache_size', Number(cacheSize))}
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-label">
                  <strong>foreign_keys</strong>
                  <span>Enforce foreign key constraints</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="input"
                    disabled={readOnly}
                    value={foreignKeys}
                    onChange={(e) => setForeignKeys(e.target.value)}
                  >
                    <option value="1">ON</option>
                    <option value="0">OFF</option>
                  </select>
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() =>
                      applyPragma('foreign_keys', foreignKeys === '1')
                    }
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  className="btn"
                  disabled={readOnly}
                  onClick={() => runMaintenance('vacuum')}
                >
                  Run VACUUM
                </button>
                <button
                  className="btn"
                  disabled={readOnly}
                  onClick={() => runMaintenance('checkpoint')}
                >
                  WAL Checkpoint
                </button>
                <button
                  className="btn"
                  onClick={() => runMaintenance('integrity_check')}
                >
                  Integrity Check
                </button>
                <a
                  className="btn"
                  href={buildApiUrl('/api/settings/export')}
                  download
                >
                  Export JSON
                </a>
              </div>
              <div
                style={{
                  marginTop: 8,
                  color: 'var(--muted)',
                  fontSize: 11,
                  fontFamily: 'var(--mono)',
                }}
              >
                Page size: {settings.pragmas.pageSize} B • Pages:{' '}
                {settings.pragmas.pageCount} • Freelist:{' '}
                {settings.pragmas.freelistCount}
              </div>
            </div>

            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <div className="label" style={{ margin: 0 }}>
                  KV Store Manager (_local_kv_store)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    disabled={readOnly}
                    onClick={() => runMaintenance('prune_kv_expired')}
                  >
                    Prune Expired
                  </button>
                  <button
                    className="btn primary"
                    disabled={readOnly}
                    onClick={() =>
                      setKvModal({
                        open: true,
                        editing: null,
                        key: '',
                        type: 'string',
                        value: '',
                        ttlMs: '',
                      })
                    }
                  >
                    + Set Key
                  </button>
                </div>
              </div>
              {kvEntries.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>
                  No keys stored in _local_kv_store.
                </div>
              ) : (
                <div className="grid-wrap" style={{ maxHeight: 280 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Type</th>
                        <th>Value</th>
                        <th>Expires</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kvEntries.map((k) => (
                        <tr key={k.key}>
                          <td>{k.key}</td>
                          <td>
                            <span className="badge">{k.type}</span>
                          </td>
                          <td>
                            {k.type === 'encrypted'
                              ? '[encrypted]'
                              : String(k.value ?? '')}
                          </td>
                          <td>
                            {k.expires_at
                              ? new Date(Number(k.expires_at)).toLocaleString()
                              : 'Never'}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button
                              className="btn"
                              disabled={readOnly}
                              style={{ marginRight: 4 }}
                              onClick={() =>
                                setKvModal({
                                  open: true,
                                  editing: k,
                                  key: k.key,
                                  type: k.type,
                                  value: String(k.value ?? ''),
                                  ttlMs: '',
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="btn danger"
                              disabled={readOnly}
                              onClick={() => deleteKvEntry(k.key)}
                            >
                              Del
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="label" style={{ marginBottom: 10 }}>
                Sync, Outbox &amp; Scheduler
              </div>
              <div className="setting-row">
                <div className="setting-label">
                  <strong>sync_outbox</strong>
                  <span>
                    Total: {sync?.outboxTotal ?? 0} • Pending:{' '}
                    {sync?.outboxPending ?? 0} • Failed:{' '}
                    {sync?.outboxFailed ?? 0}
                  </span>
                </div>
                <span className="badge">
                  {sync?.outboxExists ? 'Active' : 'Not initialized'}
                </span>
              </div>
              <div
                style={{
                  margin: '10px 0 14px',
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  className="btn"
                  disabled={readOnly}
                  onClick={() => runMaintenance('prune_outbox')}
                >
                  Prune Synced Outbox
                </button>
                <button
                  className="btn danger"
                  disabled={readOnly}
                  onClick={() => runMaintenance('clear_failed_outbox')}
                >
                  Clear Failed Mutations
                </button>
              </div>
              <div className="label" style={{ marginBottom: 6 }}>
                Scheduled Jobs
              </div>
              {!sync?.schedulerJobs ? (
                <div style={{ color: 'var(--muted)' }}>
                  No scheduler table initialized.
                </div>
              ) : sync.schedulerJobs.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>0 scheduled jobs.</div>
              ) : (
                <pre style={{ maxHeight: 180, overflow: 'auto' }}>
                  {JSON.stringify(sync.schedulerJobs, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>
            Encrypted Backup &amp; Restore (AES-256-GCM)
          </div>
          <div className="kv-list">
            <div className="kv-row">
              <div>
                <strong>Export Encrypted Snapshot</strong>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Download an AES-256-GCM encrypted <code>.localbackup</code> file of all tables and rows.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  type="password"
                  placeholder="Passphrase (min 4 chars)"
                  value={backupPassphrase}
                  onChange={(e) => setBackupPassphrase(e.target.value)}
                  style={{ width: 190 }}
                />
                <button
                  className="btn primary"
                  disabled={backupBusy || backupPassphrase.length < 4}
                  onClick={() => void exportEncryptedBackup()}
                >
                  {backupBusy ? 'Working...' : 'Export .localbackup'}
                </button>
              </div>
            </div>

            <div className="kv-row">
              <div>
                <strong>Restore from Encrypted Backup</strong>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Enter passphrase and select a <code>.localbackup</code> file to restore tables and rows.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  type="password"
                  placeholder="Backup passphrase"
                  value={restorePassphrase}
                  onChange={(e) => setRestorePassphrase(e.target.value)}
                  style={{ width: 190 }}
                  disabled={readOnly}
                />
                <label
                  className={`btn${readOnly || backupBusy || !restorePassphrase ? ' disabled' : ''}`}
                  style={{ cursor: readOnly || backupBusy || !restorePassphrase ? 'not-allowed' : 'pointer', opacity: readOnly || backupBusy || !restorePassphrase ? 0.5 : 1 }}
                >
                  Restore File
                  <input
                    type="file"
                    accept=".localbackup"
                    disabled={readOnly || backupBusy || !restorePassphrase}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void restoreEncryptedBackup(f);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {kvModal.open && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setKvModal((prev) => ({ ...prev, open: false, editing: null }))
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
              <strong>
                {kvModal.editing ? 'Edit KV Store Key' : 'Set KV Store Key'}
              </strong>
              <button
                className="btn"
                onClick={() =>
                  setKvModal((prev) => ({ ...prev, open: false, editing: null }))
                }
              >
                Close
              </button>
            </div>
            <div className="field-row">
              <label>Key</label>
              <input
                className="input"
                disabled={Boolean(kvModal.editing)}
                value={kvModal.key}
                onChange={(e) =>
                  setKvModal((prev) => ({ ...prev, key: e.target.value }))
                }
              />
            </div>
            <div className="field-row">
              <label>Type</label>
              <select
                className="input"
                value={kvModal.type}
                onChange={(e) =>
                  setKvModal((prev) => ({ ...prev, type: e.target.value }))
                }
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="json">json</option>
              </select>
            </div>
            <div className="field-row">
              <label>Value</label>
              <input
                className="input"
                value={kvModal.value}
                onChange={(e) =>
                  setKvModal((prev) => ({ ...prev, value: e.target.value }))
                }
              />
            </div>
            <div className="field-row">
              <label>TTL (ms, optional)</label>
              <input
                type="number"
                className="input"
                placeholder="Leave blank for no expiration"
                value={kvModal.ttlMs}
                onChange={(e) =>
                  setKvModal((prev) => ({ ...prev, ttlMs: e.target.value }))
                }
              />
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={saveKvEntry}>
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
