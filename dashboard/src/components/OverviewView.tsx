import React from 'react';
import { OverviewResponse } from '../api';

interface OverviewViewProps {
  overview: OverviewResponse | null;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ overview }) => {
  const maxRows =
    overview && overview.topTables.length > 0
      ? Math.max(1, ...overview.topTables.map((t) => t.rowCount))
      : 1;

  return (
    <>
      <div className="toolbar">
        <strong>Database Overview</strong>
      </div>
      <div className="content">
        {!overview ? (
          <div className="empty">Loading...</div>
        ) : (
          <>
            <div className="cards">
              <div className="card">
                <div className="label">SQLite Version</div>
                <div className="value">{overview.sqliteVersion}</div>
              </div>
              <div className="card">
                <div className="label">Journal Mode</div>
                <div className="value">{overview.journalMode}</div>
              </div>
              <div className="card">
                <div className="label">Data Tables</div>
                <div className="value">{overview.dataTableCount}</div>
              </div>
              <div className="card">
                <div className="label">System Tables</div>
                <div className="value">{overview.systemTableCount}</div>
              </div>
              <div className="card">
                <div className="label">Total Data Rows</div>
                <div className="value">{overview.totalDataRows}</div>
              </div>
              <div className="card">
                <div className="label">Indexes</div>
                <div className="value">{overview.totalIndexes}</div>
              </div>
              <div className="card">
                <div className="label">DB Size</div>
                <div className="value">
                  {Math.round(overview.databaseSizeBytes / 1024)} KB
                </div>
              </div>
            </div>

            <div className="card">
              <div className="label" style={{ marginBottom: 12 }}>
                Top Tables by Row Count
              </div>
              {overview.topTables.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>No data tables</div>
              ) : (
                overview.topTables.map((t) => (
                  <div key={t.name} className="bar-row">
                    <span
                      style={{
                        width: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.name}
                    </span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.round((t.rowCount / maxRows) * 100)}%`,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 60,
                        textAlign: 'right',
                        color: 'var(--muted)',
                      }}
                    >
                      {t.rowCount}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};
