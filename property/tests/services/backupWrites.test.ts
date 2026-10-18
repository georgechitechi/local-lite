import { saveOrShareBackup } from '@/features/backup/services/backupEngine';

const mockWrite = jest.fn();
const mockShare = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ uri: 'file:///backup.json', write: mockWrite })),
  Directory: jest.fn(),
  Paths: { cache: 'file:///cache', document: 'file:///documents' },
}));
jest.mock('expo-sharing', () => ({ shareAsync: (...args: unknown[]) => mockShare(...args) }));
jest.mock('@/shared/services/sync/client', () => ({ getSyncClient: jest.fn() }));
jest.mock('@/shared/services/sync/tables', () => ({ BUSINESS_COLLECTIONS: [] }));

describe('SDK 58 asynchronous backup writes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('waits for the file to finish writing before opening the share sheet', async () => {
    let finishWrite!: () => void;
    mockWrite.mockReturnValue(new Promise<void>(resolve => { finishWrite = resolve; }));
    const saving = saveOrShareBackup({
      fileName: 'backup.json', content: '{}',
      backupOptions: { action: 'share', format: 'json' },
      showSnackbar: jest.fn(),
    });
    expect(mockWrite).toHaveBeenCalledWith('{}');
    expect(mockShare).not.toHaveBeenCalled();
    finishWrite();
    await saving;
    expect(mockShare).toHaveBeenCalledWith('file:///backup.json', expect.any(Object));
  });

  it('does not share a file when its asynchronous write fails', async () => {
    mockWrite.mockRejectedValue(new Error('Storage full'));
    await expect(saveOrShareBackup({
      fileName: 'backup.json', content: '{}',
      backupOptions: { action: 'share', format: 'json' },
      showSnackbar: jest.fn(),
    })).rejects.toThrow('Storage full');
    expect(mockShare).not.toHaveBeenCalled();
  });
});
