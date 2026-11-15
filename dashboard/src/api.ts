export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export interface TableIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableForeignKeyInfo {
  table: string;
  from: string;
  to: string;
}

export interface TableSummary {
  name: string;
  internal: boolean;
  rowCount: number;
  columns: TableColumnInfo[];
  indexes: TableIndexInfo[];
  foreignKeys?: TableForeignKeyInfo[];
}

export interface OverviewResponse {
  title: string;
  readOnly: boolean;
  sqliteVersion: string;
  journalMode: string;
  databaseSizeBytes: number;
  dataTableCount: number;
  systemTableCount: number;
  totalDataRows: number;
  totalIndexes: number;
  topTables: { name: string; rowCount: number }[];
}

export interface KVStoreEntry {
  key: string;
  value: string;
  type: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

export interface SettingsResponse {
  dashboard: {
    title: string;
    readOnly: boolean;
    authEnabled: boolean;
    basePath: string;
  };
  pragmas: {
    journalMode: string;
    synchronous: number;
    busyTimeout: number;
    cacheSize: number;
    foreignKeys: boolean;
    pageSize: number;
    pageCount: number;
    freelistCount: number;
  };
  kvStore: {
    exists: boolean;
    entries: KVStoreEntry[];
  };
  sync: {
    outboxExists: boolean;
    outboxTotal: number;
    outboxPending: number;
    outboxFailed: number;
    schedulerJobs: any[] | null;
  };
}

export function getApiBase(): string {
  return (localStorage.getItem('local_lite_api_base') || '').replace(/\/+$/, '');
}

export function getAuthToken(): string {
  return (
    new URLSearchParams(window.location.search).get('token') ||
    localStorage.getItem('local_lite_auth_token') ||
    ''
  );
}

export function buildApiUrl(path: string): string {
  const base = getApiBase();
  const token = getAuthToken();
  const url = `${base}${path}`;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}
