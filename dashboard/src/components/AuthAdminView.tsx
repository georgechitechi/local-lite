import React from 'react';
import { apiRequest } from '../api';

export interface AuthAdminData {
  users: any[] | null;
  sessions: any[] | null;
  apiKeys: any[] | null;
}

interface AuthAdminViewProps {
  authData: AuthAdminData | null;
  readOnly: boolean;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const AuthAdminView: React.FC<AuthAdminViewProps> = ({
  authData,
  readOnly,
  onRefresh,
  onError,
}) => {
  const runAuthAction = async (action: string, id: string) => {
    try {
      onError(null);
      await apiRequest('/api/auth-admin', {
        method: 'POST',
        body: JSON.stringify({ action, id }),
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const users = authData?.users ?? null;
  const sessions = authData?.sessions ?? null;
  const apiKeys = authData?.apiKeys ?? null;

  return (
    <>
      <div className="toolbar">
        <strong>Authentication, Sessions &amp; API Keys</strong>
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
              Local Users (_local_users)
            </div>
            <span className="badge">
              {users == null ? 'Not present' : `${users.length} users`}
            </span>
          </div>
          {users == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : users.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 users</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 240 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Email / Username</th>
                    <th>Role</th>
                    <th>Failed Attempts</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td>{u.email || u.username || '-'}</td>
                      <td>{u.role || 'user'}</td>
                      <td>{u.failed_attempts ?? 0}</td>
                      <td>
                        <button
                          className="btn"
                          disabled={readOnly}
                          onClick={() => runAuthAction('unlock_user', u.id)}
                        >
                          Unlock
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
              Active Sessions (_local_sessions)
            </div>
            <span className="badge">
              {sessions == null ? 'Not present' : `${sessions.length} sessions`}
            </span>
          </div>
          {sessions == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : sessions.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 sessions</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 240 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User ID</th>
                    <th>Expires At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.user_id || '-'}</td>
                      <td>
                        {s.expires_at
                          ? new Date(Number(s.expires_at)).toLocaleString()
                          : '-'}
                      </td>
                      <td>
                        <button
                          className="btn danger"
                          disabled={readOnly}
                          onClick={() => runAuthAction('revoke_session', s.id)}
                        >
                          Revoke
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div className="label" style={{ margin: 0 }}>
              API Keys (_local_api_keys)
            </div>
            <span className="badge">
              {apiKeys == null ? 'Not present' : `${apiKeys.length} keys`}
            </span>
          </div>
          {apiKeys == null ? (
            <div style={{ color: 'var(--muted)' }}>Not initialized</div>
          ) : apiKeys.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>0 API keys</div>
          ) : (
            <div className="grid-wrap" style={{ maxHeight: 240 }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((k) => (
                    <tr key={k.id}>
                      <td>{k.id}</td>
                      <td>{k.name || '-'}</td>
                      <td>{k.prefix || '-'}</td>
                      <td>
                        <span className={`badge ${k.revoked_at ? 'ro' : 'ok'}`}>
                          {k.revoked_at ? 'Revoked' : 'Active'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn danger"
                          disabled={readOnly || Boolean(k.revoked_at)}
                          onClick={() => runAuthAction('revoke_api_key', k.id)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
