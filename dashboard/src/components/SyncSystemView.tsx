import React from 'react';

interface SyncSystemViewProps {
  system: Record<string, any[] | null> | null;
}

export const SyncSystemView: React.FC<SyncSystemViewProps> = ({ system }) => {
  const sys = system || {};
  const sections: [string, any[] | null | undefined][] = [
    ['Sync Outbox (sync_outbox)', sys.outbox],
    ['KV Store (_local_kv_store)', sys.kvStore],
    ['Scheduler (_local_scheduler)', sys.scheduler],
    ['Actions (_local_actions)', sys.actions],
    ['Local Users (_local_users)', sys.users],
    ['Sessions (_local_sessions)', sys.sessions],
    ['Migrations (schema_migrations)', sys.migrations],
  ];

  return (
    <>
      <div className="toolbar">
        <strong>Sync &amp; System Tables</strong>
      </div>
      <div className="content">
        {sections.map(([label, rows]) => (
          <div key={label} className="card" style={{ marginBottom: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <div className="label" style={{ margin: 0 }}>
                {label}
              </div>
              <span className="badge">
                {rows == null ? 'Not present' : `${rows.length} rows`}
              </span>
            </div>
            {rows == null ? (
              <div style={{ color: 'var(--muted)' }}>
                Not initialized in this database
              </div>
            ) : rows.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>0 entries</div>
            ) : (
              <pre>{JSON.stringify(rows, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>
    </>
  );
};
