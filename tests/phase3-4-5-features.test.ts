import { describe, it, expect } from 'vitest';
import { FieldEncryptor, applySqlCipherKey } from '../src/core/field-encryption.js';
import { AuditManager } from '../src/core/audit.js';
import { defineTypedSchema, createTypedClient } from '../src/schema/typed.js';
import { createTestClient } from '../src/testing/index.js';
import { PresenceChannel, PresenceTransport } from '../src/presence/index.js';
import { OutboxStore } from '../src/core/outbox-store.js';

describe('Phases 3, 4 & 5: Security, DX, Testing & Presence', () => {
  it('FieldEncryptor transparently encrypts and decrypts configured columns', async () => {
    const encryptor = new FieldEncryptor({
      key: 'super-secret-passphrase',
      encryptedColumns: {
        users: ['ssn', 'notes'],
      },
    });

    const plain = { id: 'u1', name: 'Alice', ssn: '123-45-6789', notes: { vip: true } };
    const encrypted = await encryptor.encryptPayload('users', plain);

    expect(encrypted.name).toBe('Alice');
    expect(typeof encrypted.ssn).toBe('string');
    expect(encrypted.ssn.startsWith('enc:v1:')).toBe(true);
    expect(typeof encrypted.notes).toBe('string');
    expect((encrypted.notes as string).startsWith('enc:v1:')).toBe(true);

    // Idempotent if already encrypted
    const reEncrypted = await encryptor.encryptPayload('users', encrypted);
    expect(reEncrypted.ssn).toBe(encrypted.ssn);

    const decrypted = await encryptor.decryptRow('users', encrypted);
    expect(decrypted).toEqual(plain);

    // SQLCipher helper issues PRAGMA key
    const executed: string[] = [];
    await applySqlCipherKey(
      {
        execute: async (q) => {
          executed.push(q);
          return [];
        },
        transaction: async (fn) => fn({ execute: async () => [] }),
      },
      "my'secret",
    );
    expect(executed[0]).toBe("PRAGMA key = 'my''secret'");
  });

  it('AuditManager records mutations and supports undo/redo', async () => {
    const handle = await createTestClient({ tables: ['tasks'] });
    const audit = new AuditManager(handle.client.db);

    await handle.client.insert('tasks', { id: 't1', title: 'Draft' });
    await audit.record({
      tableName: 'tasks',
      rowId: 't1',
      operation: 'INSERT',
      after: { id: 't1', title: 'Draft' },
    });

    await handle.client.update('tasks', 't1', { title: 'Published' });
    await audit.record({
      tableName: 'tasks',
      rowId: 't1',
      operation: 'UPDATE',
      before: { title: 'Draft' },
      after: { title: 'Published' },
    });

    expect((await handle.client.findById('tasks', 't1'))?.title).toBe('Published');

    await audit.undo(handle.client);
    expect((await handle.client.findById('tasks', 't1'))?.title).toBe('Draft');

    await audit.redo(handle.client);
    expect((await handle.client.findById('tasks', 't1'))?.title).toBe('Published');

    await audit.undo(handle.client);
    await audit.undo(handle.client);
    expect(await handle.client.findById('tasks', 't1')).toBeNull();

    await handle.dispose();
  });

  it('defineTypedSchema + createTypedClient + createTestClient work end-to-end', async () => {
    const schema = defineTypedSchema({
      todos: {
        id: 'string',
        title: 'string',
        done: 'boolean',
      },
    });

    const handle = await createTestClient({ tables: ['todos'], online: false });
    const typed = createTypedClient(handle.client, schema);

    await typed.insert('todos', { id: '1', title: 'Offline Task', done: false });
    const rows = await typed.from('todos').where({ done: false }).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Offline Task');

    handle.simulateOnline();
    await handle.injectRemoteChange('todos', '2', { id: '2', title: 'Remote Task', done: true }, 'INSERT');
    await handle.flushOutbox();

    const all = await typed.from('todos').orderBy('id', 'asc').execute();
    expect(all.map((t) => t.id)).toEqual(['1', '2']);

    await handle.dispose();
  });

  it('PresenceChannel tracks peers, updates state, and prunes stale peers', () => {
    const handlers = new Set<(msg: any) => void>();
    const transport: PresenceTransport = {
      send: (msg) => handlers.forEach((h) => h(msg)),
      onMessage: (h) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
    };

    const peerA = new PresenceChannel<{ cursor: number }>({
      room: 'doc-1',
      peerId: 'alice',
      ttlMs: 1000,
      transport,
    });
    const peerB = new PresenceChannel<{ cursor: number }>({
      room: 'doc-1',
      peerId: 'bob',
      ttlMs: 1000,
      transport,
    });

    const seenByA: any[] = [];
    peerA.onPeersChange((peers) => seenByA.push(peers));

    peerA.join({ cursor: 0 });
    peerB.join({ cursor: 10 });
    expect(peerA.getPeers()).toHaveLength(1);
    expect(peerA.getPeers()[0].state.cursor).toBe(10);

    peerB.updateState({ cursor: 42 });
    expect(peerA.getPeers()[0].state.cursor).toBe(42);

    // Stale TTL pruning
    expect(peerA.getPeers(Date.now() + 5000)).toHaveLength(0);

    peerB.leave();
    peerA.dispose();
  });

  it('LocalFirstClient.editOutboxMutationPayload updates queued payload', async () => {
    const handle = await createTestClient({ tables: ['todos'], online: false });
    await handle.client.insert('todos', { id: 't1', title: 'Bad Payload' });

    const pending = await OutboxStore.getPending(handle.client.db);
    expect(pending).toHaveLength(1);

    await handle.client.editOutboxMutationPayload(pending[0].id, {
      id: 't1',
      title: 'Fixed Payload',
    });

    const updated = await OutboxStore.getPending(handle.client.db);
    expect(updated[0].payload.title).toBe('Fixed Payload');

    await handle.dispose();
  });
});
