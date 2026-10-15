export interface BackupOptions {
  action: 'share' | 'save';
  format: 'json';
}

export interface PreviewData {
  version: string;
  timestamp: string;
  uri: string;
  data: Record<string, any[]>;
  tables: {
    name: string;
    count: number;
  }[];
}

export interface RestoreModalData {
  type: 'storage' | 'file';
  fileName?: string;
  urlData?: { publicUrl: string };
  fileContent?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export interface SuccessModalData {
  title: string;
  type: 'success' | 'warning' | 'error';
  message: string;
  details?: string[];
  failedTables?: string;
  warning?: string;
}

export interface StorageFile {
  name: string;
  metadata?: {
    size?: number;
  };
  updated_at?: string;
  created_at?: string;
}

export interface StorageFolder {
  name: string;
  metadata: null;
}

const pad = (n: number) => n.toString().padStart(2, '0');

function formatBackupFileName(date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

export function createBackupFileContent(data: Record<string, any[]>): {
  fileName: string;
  content: string;
} {
  const backup = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    data,
  };

  return {
    fileName: formatBackupFileName(new Date()),
    content: JSON.stringify(backup),
  };
}

export function isValidBackupFile(backup: any): boolean {
  return Boolean(backup?.version && backup.timestamp && backup.data);
}

export function buildBackupPreview(backup: any, uri: string): PreviewData {
  return {
    version: backup.version,
    timestamp: backup.timestamp,
    uri,
    data: backup.data,
    tables: Object.entries(backup.data).map(([table, data]: [string, any]) => ({
      name: table,
      count: Array.isArray(data) ? data.length : 0,
    })),
  };
}

export function getTableColumns(tableRow?: any): { name: string; type: string }[] {
  if (!tableRow) return [];
  return Object.keys(tableRow).map(column => ({
    name: column,
    type: typeof tableRow[column],
  }));
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
