import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSqlTargetSchema,
  generateSqlMigration,
  type SchemaDictionary,
} from '../src/schema/index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-lite-mysql-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SQL migration generator', () => {
  it('orders id first, deleted/created_at/updated_at last, and uses VARCHAR(64) for date columns', () => {
    const dictionary: SchemaDictionary = {
      houses: {
        name: 'string',
        updated_at: 'string | null',
        property_id: 'string',
        created_at: 'string | null',
        deleted: 'boolean | null',
        move_in_date: 'string | null',
        id: 'string',
      },
      properties: {
        name: 'string',
        id: 'string',
      },
    };

    const schema = buildSqlTargetSchema(dictionary, ['properties', 'houses']);
    expect(Object.keys(schema.tables)).toEqual(['properties', 'houses']);
    expect(Object.keys(schema.tables.houses.columns)).toEqual([
      'id',
      'name',
      'property_id',
      'move_in_date',
      'deleted',
      'created_at',
      'updated_at',
    ]);
    expect(schema.tables.houses.columns.move_in_date.sqlType).toBe('VARCHAR(64)');
    expect(schema.tables.houses.columns.created_at.sqlType).toBe('VARCHAR(64)');
    expect(schema.tables.houses.columns.updated_at.sqlType).toBe('BIGINT');
  });

  it('generates initial and incremental migrations by replaying SQL files without a snapshot', () => {
    const dir = makeTempDir();
    const migrationsDir = path.join(dir, 'migrations');
    const serverSchemaPath = path.join(dir, 'syncedSchema.ts');

    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000000_core_tables.sql'),
      '-- +up\nCREATE TABLE IF NOT EXISTS _server_changes (cursor BIGINT PRIMARY KEY);\n-- +down\nDROP TABLE IF EXISTS _server_changes;\n',
      'utf8',
    );

    const v1: SchemaDictionary = {
      properties: { id: 'string', name: 'string' },
      houses: { id: 'string', property_id: 'string', house_number: 'string' },
    };

    const first = generateSqlMigration({
      dictionary: v1,
      migrationsDir,
      tableOrder: ['properties', 'houses'],
      name: 'initial',
      serverSchemaPath,
    });

    expect(first.warnings).toEqual([]);
    expect(first.migrationPath).toBeTruthy();
    expect(first.up[0]).toContain('CREATE TABLE IF NOT EXISTS `properties`');
    expect(first.up[1]).toContain('CREATE TABLE IF NOT EXISTS `houses`');
    expect(first.down).toEqual([
      'DROP TABLE IF EXISTS `houses`;',
      'DROP TABLE IF EXISTS `properties`;',
    ]);
    expect(fs.readFileSync(serverSchemaPath, 'utf8')).toContain('SYNCED_TABLE_COLUMNS');

    // Re-running with no changes should produce no diff
    const noop = generateSqlMigration({
      dictionary: v1,
      migrationsDir,
      tableOrder: ['properties', 'houses'],
    });
    expect(noop.up).toEqual([]);

    // Adding a column should produce ALTER TABLE ADD COLUMN
    const v2: SchemaDictionary = {
      properties: { id: 'string', name: 'string', location: 'string | null' },
      houses: { id: 'string', property_id: 'string', house_number: 'string' },
    };
    const second = generateSqlMigration({
      dictionary: v2,
      migrationsDir,
      tableOrder: ['properties', 'houses'],
      dryRun: true,
    });
    expect(second.up).toEqual([
      'ALTER TABLE `properties` ADD COLUMN `location` VARCHAR(255) NULL;',
    ]);
    expect(second.down).toEqual([
      'ALTER TABLE `properties` DROP COLUMN `location`;',
    ]);
  });

  it('supports postgres and sqlite dialects with idempotent re-runs', () => {
    const pgDir = makeTempDir();
    const sqliteDir = makeTempDir();
    const schema: SchemaDictionary = {
      properties: { id: 'string', name: 'string', metadata: 'json | null', active: 'boolean' },
    };

    const pgFirst = generateSqlMigration({
      dictionary: schema,
      migrationsDir: pgDir,
      dialect: 'postgres',
      name: 'init_pg',
    });
    expect(pgFirst.sql).toContain('CREATE TABLE IF NOT EXISTS "properties"');
    expect(pgFirst.sql).toContain('"metadata" JSONB NULL');
    expect(pgFirst.sql).toContain('"active" BOOLEAN NOT NULL DEFAULT FALSE');
    expect(pgFirst.sql).toContain('CREATE INDEX IF NOT EXISTS "idx_properties_updated_at" ON "properties" ("updated_at");');
    expect(
      generateSqlMigration({ dictionary: schema, migrationsDir: pgDir, dialect: 'postgres' }).up,
    ).toEqual([]);

    const sqliteFirst = generateSqlMigration({
      dictionary: schema,
      migrationsDir: sqliteDir,
      dialect: 'sqlite',
      name: 'init_sqlite',
    });
    expect(sqliteFirst.sql).toContain('CREATE TABLE IF NOT EXISTS "properties"');
    expect(sqliteFirst.sql).toContain('"id" TEXT NOT NULL PRIMARY KEY');
    expect(sqliteFirst.sql).toContain('"active" INTEGER NOT NULL DEFAULT 0');
    expect(sqliteFirst.sql).toContain('CREATE INDEX IF NOT EXISTS "idx_properties_updated_at" ON "properties" ("updated_at");');
    expect(
      generateSqlMigration({ dictionary: schema, migrationsDir: sqliteDir, dialect: 'sqlite' }).up,
    ).toEqual([]);
  });
});
