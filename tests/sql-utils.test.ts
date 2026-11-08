import { describe, it, expect } from 'vitest';
import { escapeIdentifier, isInternalTable } from '../src/utils/sql.js';

describe('SQL Utilities', () => {
  describe('escapeIdentifier', () => {
    it('wraps simple identifiers in double quotes', () => {
      expect(escapeIdentifier('users')).toBe('"users"');
      expect(escapeIdentifier('first_name')).toBe('"first_name"');
      expect(escapeIdentifier('id')).toBe('"id"');
    });

    it('escapes embedded double quotes by doubling them', () => {
      expect(escapeIdentifier('weird"name')).toBe('"weird""name"');
      expect(escapeIdentifier('a"b"c')).toBe('"a""b""c"');
      expect(escapeIdentifier('""')).toBe('""""""');
    });

    it('prevents SQL injection attempts in table/column names', () => {
      const malicious = 'users"; DROP TABLE users; --';
      const escaped = escapeIdentifier(malicious);
      expect(escaped).toBe('"users""; DROP TABLE users; --"');
    });
  });

  describe('isInternalTable', () => {
    it('returns true for SQLite internal tables', () => {
      expect(isInternalTable('sqlite_sequence')).toBe(true);
      expect(isInternalTable('sqlite_stat1')).toBe(true);
      expect(isInternalTable('SQLITE_MASTER')).toBe(true);
    });

    it('returns true for Android metadata tables', () => {
      expect(isInternalTable('android_metadata')).toBe(true);
      expect(isInternalTable('ANDROID_METADATA')).toBe(true);
    });

    it('returns true for FTS virtual tables and shadow tables', () => {
      expect(isInternalTable('_fts_notes_idx')).toBe(true);
      expect(isInternalTable('_fts_content')).toBe(true);
    });

    it('returns true for local-lite engine tables', () => {
      expect(isInternalTable('_local_auth_users')).toBe(true);
      expect(isInternalTable('_local_auth_sessions')).toBe(true);
      expect(isInternalTable('_local_keys')).toBe(true);
      expect(isInternalTable('sync_outbox')).toBe(true);
      expect(isInternalTable('SYNC_META')).toBe(true);
      expect(isInternalTable('schema_migrations')).toBe(true);
    });

    it('returns false for user application tables', () => {
      expect(isInternalTable('todos')).toBe(false);
      expect(isInternalTable('users')).toBe(false);
      expect(isInternalTable('posts')).toBe(false);
      expect(isInternalTable('orders_2026')).toBe(false);
      expect(isInternalTable('custom_sync')).toBe(false);
    });

    it('returns true for non-string or falsy inputs for safety', () => {
      expect(isInternalTable('' as any)).toBe(true);
      expect(isInternalTable(null as any)).toBe(true);
      expect(isInternalTable(undefined as any)).toBe(true);
      expect(isInternalTable(123 as any)).toBe(true);
    });
  });
});

