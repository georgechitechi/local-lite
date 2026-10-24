import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import {
  exportTablesToJson,
  importTablesFromJson,
  exportTableToCsv,
  importTableFromCsv,
  parseCsv,
} from '../src/utils/portability.js';

describe('Universal Data Portability (JSON & CSV)', () => {
  let raw: DatabaseSync;
  let db: NodeSQLiteAdapter;
  let client: LocalFirstClient;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    db = new NodeSQLiteAdapter(raw);
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      autoHydrateJSON: true,
      tables: ['contacts', 'notes'],
      autoStart: false,
      logger: false,
    });
    await client.initialize();
  });

  afterEach(async () => {
    await client.close();
  });

  describe('JSON Portability', () => {
    it('exports and imports tables cleanly in merge mode', async () => {
      await client.insert('contacts', { id: 'c1', name: 'Alice', phone: '123' });
      await client.insert('notes', { id: 'n1', title: 'First Note' });

      const jsonStr = await exportTablesToJson(client, undefined, { pretty: true });
      expect(jsonStr).toContain('"version": 1');
      expect(jsonStr).toContain('"Alice"');
      expect(jsonStr).toContain('"First Note"');

      // Add a second contact
      await client.insert('contacts', { id: 'c2', name: 'Bob', phone: '456' });

      // Modify Alice's phone in the exported JSON and re-import
      const modifiedJson = jsonStr.replace('123', '999');
      const result = await importTablesFromJson(client, modifiedJson, { mode: 'merge' });

      expect(result.tables).toEqual(['contacts', 'notes']);
      expect(result.rowCounts.contacts).toBe(1);

      // Verify Alice was updated and Bob was preserved
      const alice = await client.findById('contacts', 'c1');
      expect(alice.phone).toBe('999');

      const bob = await client.findById('contacts', 'c2');
      expect(bob).not.toBeNull();
    });

    it('replaces table rows in replace mode', async () => {
      await client.insert('contacts', { id: 'c1', name: 'Old Alice' });
      await client.insert('contacts', { id: 'c2', name: 'Old Bob' });

      const newBackupJson = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        tables: {
          contacts: [{ id: 'c3', name: 'New Charlie' }],
        },
      });

      await importTablesFromJson(client, newBackupJson, { mode: 'replace' });

      const all = await client.findMany('contacts');
      expect(all.length).toBe(1);
      expect(all[0].name).toBe('New Charlie');
    });

    it('rejects malformed JSON export files with helpful errors', async () => {
      await expect(importTablesFromJson(client, 'invalid-json')).rejects.toThrow(
        /Invalid JSON export format/,
      );
      await expect(importTablesFromJson(client, '{"version": 1}')).rejects.toThrow(
        /missing tables object/,
      );
    });
  });

  describe('CSV Portability', () => {
    it('correctly parses RFC-4180 CSV strings with quotes and newlines', () => {
      const csv = 'id,name,bio\n1,"Doe, John","Multi-line\nbio with ""quotes"""';
      const parsed = parseCsv(csv);
      expect(parsed.length).toBe(2);
      expect(parsed[0]).toEqual(['id', 'name', 'bio']);
      expect(parsed[1]).toEqual(['1', 'Doe, John', 'Multi-line\nbio with "quotes"']);
    });

    it('exports and imports CSV tables with field escaping and type inference', async () => {
      await client.insert('notes', {
        id: 'note-1',
        title: 'Meeting, Notes',
        tags: JSON.stringify(['work', 'urgent']),
        priority: 5,
        done: 1,
      });

      const csv = await exportTableToCsv(client, 'notes');
      expect(csv).toContain('id,title,tags,priority,done');
      expect(csv).toContain('"Meeting, Notes"');

      // Clear table
      await client.reset();

      // Re-import CSV
      const importRes = await importTableFromCsv(client, 'notes', csv);
      expect(importRes.rowCount).toBe(1);

      const note = await client.findById('notes', 'note-1');
      expect(note).not.toBeNull();
      expect(note.title).toBe('Meeting, Notes');
      expect(note.priority).toBe(5);
      expect(note.tags).toEqual(['work', 'urgent']); // auto-detected JSON array
    });

    it('supports custom delimiter such as semicolon', async () => {
      await client.insert('contacts', { id: 'c1', name: 'Alice' });

      const csv = await exportTableToCsv(client, 'contacts', { delimiter: ';' });
      expect(csv).toContain(';');

      await client.reset();

      const importRes = await importTableFromCsv(client, 'contacts', csv, { delimiter: ';' });
      expect(importRes.rowCount).toBe(1);

      const contact = await client.findById('contacts', 'c1');
      expect(contact.name).toBe('Alice');
    });
  });
});
