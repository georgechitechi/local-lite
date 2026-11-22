import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  cleanups: [] as Array<() => void>,
  cursor: { state: 0, ref: 0 },
}));

vi.mock('react', () => ({
  useState<T>(init: T | (() => T)) {
    const idx = hookState.cursor.state++;
    if (!(idx in hookState.states)) {
      hookState.states[idx] = typeof init === 'function' ? (init as () => T)() : init;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      hookState.states[idx] =
        typeof next === 'function'
          ? (next as (prev: T) => T)(hookState.states[idx] as T)
          : next;
    };
    return [hookState.states[idx] as T, setState];
  },
  useRef<T>(init: T) {
    const idx = hookState.cursor.ref++;
    if (!(idx in hookState.refs)) {
      hookState.refs[idx] = { current: init };
    }
    return hookState.refs[idx] as { current: T };
  },
  useEffect(effect: () => void | (() => void)) {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      hookState.cleanups.push(cleanup);
    }
  },
  useCallback<T extends (...args: never[]) => unknown>(fn: T) {
    return fn;
  },
  useMemo<T>(fn: () => T) {
    return fn();
  },
}));

import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { LocalFirstClient } from '../src/core/client.js';
import { MockDB } from './helpers/mock-db.js';

vi.resetModules();
const {
  clearLiveQueryCache,
  resolveSyncTheme,
  useAppleAuth,
  useDatabaseMaintenance,
  useGitHubAuth,
  useGoogleAuth,
  useGoogleDriveBackup,
  useKVStore,
  useLiveInfiniteQuery,
  useLiveQueries,
  useLiveQuery,
  useLiveRow,
  useLocalAuth,
  useMicrosoftAuth,
  useMutations,
  useOneDriveBackup,
  useSearch,
  useSession,
  useSyncMetrics,
  useSyncStatus,
} = await import('../src/react/index.js');

function resetHooks() {
  for (const cleanup of hookState.cleanups.splice(0)) {
    cleanup();
  }
  hookState.states.length = 0;
  hookState.refs.length = 0;
  hookState.cursor.state = 0;
  hookState.cursor.ref = 0;
}

const flush = () => new Promise((r) => setTimeout(r, 25));

describe('React hooks coverage', () => {
  let db: MockDB;
  let client: LocalFirstClient;

  beforeEach(async () => {
    resetHooks();
    clearLiveQueryCache();
    db = new MockDB();
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(true),
      autoStart: false,
      tables: ['todos'],
      auth: {},
    });
    await client.initialize();
  });

  afterEach(() => {
    resetHooks();
    client.stop();
  });

  it('resolves themes and runs live query, row, multi-query, infinite, mutation, and maintenance hooks', async () => {
    expect(resolveSyncTheme('light').isDark).toBe(false);
    expect(resolveSyncTheme('dark').isDark).toBe(true);
    expect(resolveSyncTheme('auto', 'light').isDark).toBe(false);
    expect(resolveSyncTheme({ isDark: false, accent: '#000' }).accent).toBe('#000');

    await client.insert('todos', { id: 't1', title: 'One', done: 0 });
    await client.insert('todos', { id: 't2', title: 'Two', done: 1 });

    // useLiveQuery
    resetHooks();
    const lq = useLiveQuery(client, 'todos', { orderBy: 'title ASC' });
    await flush();
    await lq.refetch();
    expect(lq.loading).toBe(true); // initial snapshot before re-render

    // useLiveQueries
    resetHooks();
    const lqs = useLiveQueries(client, {
      all: { table: 'todos' },
      open: { table: 'todos', where: { done: 0 } },
    });
    await flush();
    await lqs.refetch();

    // useLiveRow
    resetHooks();
    const lr = useLiveRow(client, 'todos', 't1');
    await flush();
    await lr.refetch();

    // useLiveInfiniteQuery
    resetHooks();
    const liq = useLiveInfiniteQuery(client, 'todos', { pageSize: 1 });
    await flush();
    await liq.fetchNextPage();
    await liq.refetch();

    // useMutations
    resetHooks();
    const mut = useMutations(client);
    const createdId = await mut.insert('todos', { title: 'Three' });
    await mut.update('todos', createdId!, { done: 1 });
    await mut.delete('todos', createdId!);

    // useDatabaseMaintenance
    resetHooks();
    const maint = useDatabaseMaintenance(client);
    await maint.refreshStats();
    await maint.pruneOutbox({ retentionDays: 1 });
    await maint.vacuum();
    await maint.checkpoint('PASSIVE');
  });

  it('runs useKVStore, useSearch, useSession, useSyncStatus, and useSyncMetrics', async () => {
    resetHooks();
    const [val, setVal] = useKVStore(client, 'theme', 'light');
    expect(val).toBe('light');
    await setVal('dark');
    await flush();

    resetHooks();
    await client.search.createIndex({ table: 'todos', columns: ['title'] });
    await client.insert('todos', { id: 's1', title: 'Alpha task' });
    const searchRes = useSearch(client, 'todos', 'Alpha', { debounceMs: 5 });
    expect(searchRes.results).toEqual([]);
    await flush();

    resetHooks();
    const sessionRes = useSession(client);
    await sessionRes.createSession({ userId: 'u1', user: { name: 'Ada' } });
    await sessionRes.updateUser({ name: 'Ada L.' });
    await sessionRes.updateTokens({ token: 'tok_2' });
    await sessionRes.refetchSession();
    await sessionRes.signOut();

    resetHooks();
    const statusRes = useSyncStatus(client);
    await statusRes.refresh();
    client.events.emit('sync:status', {
      isOnline: true,
      isPushing: false,
      isPulling: false,
      pendingCount: 0,
    });
    client.events.emit('sync:pull', { success: true });
    await flush();

    resetHooks();
    const metricsRes = useSyncMetrics(client, 0);
    await metricsRes.refresh();
  });

  it('runs useLocalAuth, OAuth hooks, and cloud backup hooks', async () => {
    // useLocalAuth
    resetHooks();
    const localAuth = useLocalAuth(client.auth);
    await flush();
    await localAuth.signUp({ email: 'u@test.com', password: 'Password123!' });
    await localAuth.signOut();
    await localAuth.signIn('u@test.com', 'Password123!');

    // OAuth hooks with minimal client doubles
    const mockOAuth = (user: unknown) => ({
      getUser: async () => user,
      onAuthStateChange: (cb: (u: unknown) => void) => {
        cb(user);
        return () => {};
      },
      signInWithPopup: async () => user,
      signIn: async () => user,
      signOut: async () => {},
      getAccessToken: async () => 'tok_1',
    });

    resetHooks();
    const gAuth = useGoogleAuth(mockOAuth({ id: 'g1' }) as never);
    await gAuth.signIn();
    await gAuth.signOut();

    resetHooks();
    const msAuth = useMicrosoftAuth(mockOAuth({ id: 'm1' }) as never);
    await msAuth.signIn();
    await msAuth.signOut();

    resetHooks();
    const ghAuth = useGitHubAuth(mockOAuth({ id: 'gh1' }) as never);
    await ghAuth.signIn();
    await ghAuth.signOut();

    resetHooks();
    const apAuth = useAppleAuth(mockOAuth({ id: 'a1' }) as never);
    await apAuth.signIn();
    await apAuth.signOut();

    // Cloud backup hooks with minimal backup client doubles
    const mockBackupClient = {
      isConnected: async () => true,
      connect: async () => true,
      disconnect: async () => {},
      list: async () => [
        { id: 'b1', name: 'snap.db', size: 10, modifiedTime: '2026-01-01' },
      ],
      save: async () => 'b2',
      read: async () => new Uint8Array([1, 2, 3]),
      delete: async () => {},
    };
    const backupDb = {
      exportDatabase: async () => new Uint8Array([1, 2, 3]),
      importDatabase: async () => {},
    };

    resetHooks();
    const gdBackup = useGoogleDriveBackup(mockBackupClient as never, backupDb as never);
    await flush();
    await gdBackup.refreshBackups();
    await gdBackup.backup();
    await gdBackup.restore('b1');
    await gdBackup.deleteBackup('b1');
    await gdBackup.connect();
    await gdBackup.disconnect();

    resetHooks();
    const odBackup = useOneDriveBackup(mockBackupClient as never, backupDb as never);
    await flush();
    await odBackup.refreshBackups();
    await odBackup.backup();
    await odBackup.restore('b1');
    await odBackup.deleteBackup('b1');
  });
});
