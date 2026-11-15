import React from 'react';
import { apiRequest } from '../api';

export interface JobsData {
  actions: any[] | null;
  scheduledJobs: any[] | null;
  jobRuns: any[] | null;
  outbox: any[] | null;
}

interface JobsViewProps {
  jobsData: JobsData | null;
  readOnly: boolean;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const JobsView: React.FC<JobsViewProps> = ({
  jobsData,
  readOnly,
  onRefresh,
  onError,
}) => {
  const runJobAction = async (payload: Record<string, any>) => {
    try {
      onError(null);
      await apiRequest('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const actions = jobsData?.actions ?? null;
  const scheduledJobs = jobsData?.scheduledJobs ?? null;
  const jobRuns = jobsData?.jobRuns ?? null;
  const outbox = jobsData?.outbox ?? null;

  return (
    <>
      <div className="toolbar">
        <strong>Schedules, Actions &amp; Outbox</strong>
      </div>
      <div className="content">
        <div className="card" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div className="label" style={{ margin: 0 }}>
              Action Outbox (_local_actions)
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="badge">
                {actions == null ? 'Not present' : `${actions.length} actions`}
              </span>
              {actions != null && (
                <button
                  className="btn"
                  disabled={readOnly}
                  onClick={() =>
                    runJobAction({ action: 'clear_completed_actions' })
                  }
                >
                  Clear Completed
                </button>
              )}
            </div>
          </div>
          {actions == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : actions.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 queued actions</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 260 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Error</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td>{a.name || a.type || '-'}</td>
                      <td>
                        <span className="badge">{a.status || 'pending'}</span>
                      </td>
                      <td>{a.attempts ?? 0}</td>
                      <td>{a.last_error || '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn"
                          disabled={readOnly}
                          style={{ marginRight: 4 }}
                          onClick={() =>
                            runJobAction({ action: 'retry_action', id: a.id })
                          }
                        >
                          Retry
                        </button>
                        <button
                          className="btn danger"
                          disabled={readOnly}
                          onClick={() =>
                            runJobAction({ action: 'delete_action', id: a.id })
                          }
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

        <div className="card" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div className="label" style={{ margin: 0 }}>
              Scheduled Jobs (_local_scheduled_jobs)
            </div>
            <span className="badge">
              {scheduledJobs == null
                ? 'Not present'
                : `${scheduledJobs.length} jobs`}
            </span>
          </div>
          {scheduledJobs == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : scheduledJobs.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 scheduled jobs</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 240 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Schedule</th>
                    <th>Enabled</th>
                    <th>Next Run</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledJobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.id}</td>
                      <td>{j.name || '-'}</td>
                      <td>{j.schedule || j.cron || '-'}</td>
                      <td>
                        <span className={`badge ${j.enabled ? 'ok' : 'ro'}`}>
                          {j.enabled ? 'Enabled' : 'Paused'}
                        </span>
                      </td>
                      <td>
                        {j.next_run_at
                          ? new Date(Number(j.next_run_at)).toLocaleString()
                          : '-'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn"
                          disabled={readOnly}
                          style={{ marginRight: 4 }}
                          onClick={() =>
                            runJobAction({
                              action: 'toggle_job',
                              id: j.id,
                              enabled: !j.enabled,
                            })
                          }
                        >
                          {j.enabled ? 'Pause' : 'Enable'}
                        </button>
                        <button
                          className="btn danger"
                          disabled={readOnly}
                          onClick={() =>
                            runJobAction({ action: 'delete_job', id: j.id })
                          }
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

        <div className="card" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div className="label" style={{ margin: 0 }}>
              Sync Outbox (sync_outbox)
            </div>
            <span className="badge">
              {outbox == null ? 'Not present' : `${outbox.length} mutations`}
            </span>
          </div>
          {outbox == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : outbox.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 pending mutations</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 240 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Table</th>
                    <th>Operation</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((m) => (
                    <tr key={m.id}>
                      <td>{m.id}</td>
                      <td>{m.table_name}</td>
                      <td>{m.operation}</td>
                      <td>
                        <span className="badge">{m.status || 'pending'}</span>
                      </td>
                      <td>{m.retry_count ?? 0}</td>
                      <td>
                        <button
                          className="btn"
                          disabled={readOnly}
                          onClick={() =>
                            runJobAction({ action: 'retry_outbox', id: m.id })
                          }
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {jobRuns != null && (
          <div className="card">
            <div className="label" style={{ marginBottom: 8 }}>
              Recent Job Runs (_local_job_runs)
            </div>
            {jobRuns.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>0 runs recorded</div>
            ) : (
              <pre style={{ maxHeight: 220, overflow: 'auto' }}>
                {JSON.stringify(jobRuns, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  );
};
