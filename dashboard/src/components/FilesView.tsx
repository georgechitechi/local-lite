import React, { useState } from 'react';
import { apiRequest } from '../api';

interface FilesViewProps {
  filesData: { exists: boolean; files: any[] } | null;
  readOnly: boolean;
  onRefresh: () => void;
  onError: (msg: string | null) => void;
}

export const FilesView: React.FC<FilesViewProps> = ({
  filesData,
  readOnly,
  onRefresh,
  onError,
}) => {
  const [search, setSearch] = useState('');
  const [inspectFile, setInspectFile] = useState<any | null>(null);

  const files = filesData?.files ?? [];
  const filtered = files.filter((f) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(f.id ?? '').toLowerCase().includes(q) ||
      String(f.filename ?? f.name ?? '').toLowerCase().includes(q) ||
      String(f.mime_type ?? '').toLowerCase().includes(q)
    );
  });

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete file record "${id}"?`)) return;
    try {
      onError(null);
      await apiRequest(`/api/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      onRefresh();
    } catch (err: any) {
      onError(err.message);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <>
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong>File Storage (_local_blobs)</strong>
          <span className="badge">{files.length} files</span>
          <input
            className="input"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="content">
        {!filesData?.exists ? (
          <div className="empty">
            Blob storage table (<code>_local_blobs</code>) is not initialized in
            this database.
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">No files found.</div>
        ) : (
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Filename</th>
                  <th>MIME Type</th>
                  <th>Size</th>
                  <th>Sync Status</th>
                  <th>SHA-256</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id}>
                    <td
                      style={{ cursor: 'pointer' }}
                      onClick={() => setInspectFile(f)}
                    >
                      {f.id}
                    </td>
                    <td>{f.filename || f.name || '-'}</td>
                    <td>{f.mime_type || '-'}</td>
                    <td>{formatBytes(Number(f.size ?? 0))}</td>
                    <td>
                      <span className="badge">{f.sync_status || 'local'}</span>
                    </td>
                    <td>
                      {f.sha256 ? `${String(f.sha256).slice(0, 12)}...` : '-'}
                    </td>
                    <td>
                      <button
                        className="btn"
                        style={{ marginRight: 4 }}
                        onClick={() => setInspectFile(f)}
                      >
                        Inspect
                      </button>
                      <button
                        className="btn danger"
                        disabled={readOnly}
                        onClick={() => handleDelete(String(f.id))}
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

      {inspectFile && (
        <div className="modal-backdrop" onClick={() => setInspectFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <strong>File Metadata</strong>
              <button className="btn" onClick={() => setInspectFile(null)}>
                Close
              </button>
            </div>
            <pre>{JSON.stringify(inspectFile, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  );
};
