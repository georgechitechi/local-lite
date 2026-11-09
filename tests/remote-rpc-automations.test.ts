import { describe, it, expect, vi } from 'vitest';
import { ConvexRemoteAdapter } from '../src/adapters/remote/convex.js';
import { SupabaseRemoteAdapter } from '../src/adapters/remote/supabase.js';

describe('Remote Provider RPC & Automations Adapter', () => {
  describe('ConvexRemoteAdapter', () => {
    it('supports call (action/mutation), queryRemote, automations, and backups', async () => {
      const mockClient = {
        action: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com/link' }),
        query: vi.fn().mockImplementation((name) => {
          if (name === 'functions/automations:listMine') {
            return Promise.resolve([{ id: 'job_1', name: 'Daily Backup', enabled: true }]);
          }
          if (name === 'functions/convexBackups:listMyBackups') {
            return Promise.resolve([{ createdAt: 12345, status: 'succeeded', downloadUrl: 'https://cdn.example.com/file' }]);
          }
          return Promise.resolve({ data: 'mock_query' });
        }),
        mutation: vi.fn().mockResolvedValue({ patched: true }),
      };

      const adapter = new ConvexRemoteAdapter(mockClient, { tables: ['users'] });

      // 1. call
      const actionRes = await adapter.call('functions/tenantSelfService:createSelfServiceLink', { tenantId: '123' });
      expect(actionRes).toEqual({ success: true, url: 'https://example.com/link' });
      expect(mockClient.action).toHaveBeenCalledWith('functions/tenantSelfService:createSelfServiceLink', { tenantId: '123' });

      // 2. queryRemote
      const queryRes = await adapter.queryRemote('anyQuery', { id: 'abc' });
      expect(queryRes).toEqual({ data: 'mock_query' });
      expect(mockClient.query).toHaveBeenCalledWith('anyQuery', { id: 'abc' });

      // 3. automations
      const automations = await adapter.listAutomations();
      expect(automations).toEqual([{ id: 'job_1', name: 'Daily Backup', enabled: true }]);
      await adapter.setAutomationEnabled('job_1', false);
      expect(mockClient.action).toHaveBeenCalledWith('functions/automations:setEnabled', { jobId: 'job_1', enabled: false });

      // 4. backups
      const backups = await adapter.listBackups();
      expect(backups).toHaveLength(1);
      expect(backups[0].status).toBe('succeeded');
    });
  });

  describe('SupabaseRemoteAdapter', () => {
    it('supports call (edge function/RPC), queryRemote, automations, and backups', async () => {
      const mockSupabase = {
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: { message: 'invoked' }, error: null }),
        },
        rpc: vi.fn().mockResolvedValue({ data: [{ id: 'auto_1', name: 'Nightly', enabled: true }], error: null }),
        storage: {
          from: vi.fn().mockReturnValue({
            list: vi.fn().mockResolvedValue({
              data: [{ name: 'backup-1.json', created_at: '2026-01-01', metadata: { size: 1024 } }],
              error: null,
            }),
            createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.supabase.co/file' } }),
          }),
        },
      };

      const adapter = new SupabaseRemoteAdapter(mockSupabase as any, { tables: ['users'] });

      // 1. call
      const fnRes = await adapter.call('send-sms', { phone: '+123456789' });
      expect(fnRes).toEqual({ message: 'invoked' });
      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('send-sms', { body: { phone: '+123456789' } });

      // 2. queryRemote
      const rpcRes = await adapter.queryRemote('get_stats', { year: 2026 });
      expect(rpcRes).toEqual([{ id: 'auto_1', name: 'Nightly', enabled: true }]);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_stats', { year: 2026 });

      // 3. backups
      const backups = await adapter.listBackups();
      expect(backups).toHaveLength(1);
      expect(backups[0].fileName).toBe('backup-1.json');

      // 4. download url
      const downloadUrl = await adapter.getDownloadUrl('backup-1.json');
      expect(downloadUrl).toBe('https://signed.supabase.co/file');
    });
  });
});

