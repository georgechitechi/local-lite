import { describe, it, expect } from 'vitest';
import { parseSchemaIndexes, formatSchemaIndexesCode, generateSchemaIndexes } from '../src/schema/index.js';

const SAMPLE_DATABASE_TYPES = `
export type Database = {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          deleted: boolean | null;
        };
        Insert: { id: string };
        Update: { id?: string };
        Relationships: [
          {
            foreignKeyName: "properties_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          }
        ];
      };
      contracts: {
        Row: {
          id: string;
          business_id: string;
          house_id: string;
          tenant_id: string;
          deleted: boolean | null;
        };
        Insert: { id: string };
        Update: { id?: string };
        Relationships: [
          {
            foreignKeyName: "contracts_house_id_fkey";
            columns: ["house_id"];
            isOneToOne: false;
            referencedRelation: "houses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          }
        ];
      };
    };
  };
};
`;

describe('Schema Index Generator', () => {
  it('parses foreign keys and generates correct index statements', () => {
    const indexes = parseSchemaIndexes(SAMPLE_DATABASE_TYPES, { includeBusinessSyncIndexes: false });

    expect(indexes).toHaveLength(3);

    // Standard FK
    const houseIndex = indexes.find(i => i.table === 'contracts' && i.columns.includes('house_id'));
    expect(houseIndex).toBeDefined();
    expect(houseIndex?.isOneToOne).toBe(false);
    expect(houseIndex?.sql).toBe('CREATE INDEX IF NOT EXISTS "idx_contracts_house_id" ON "contracts" ("house_id");');

    // Unique 1:1 FK
    const tenantIndex = indexes.find(i => i.table === 'contracts' && i.columns.includes('tenant_id'));
    expect(tenantIndex).toBeDefined();
    expect(tenantIndex?.isOneToOne).toBe(true);
    expect(tenantIndex?.sql).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "idx_contracts_tenant_id" ON "contracts" ("tenant_id");');
  });

  it('detects tables with business_id and deleted to create composite sync indexes', () => {
    const indexes = parseSchemaIndexes(SAMPLE_DATABASE_TYPES, { includeBusinessSyncIndexes: true });

    const bizIndexes = indexes.filter(i => i.columns.includes('business_id') && i.columns.includes('deleted'));
    expect(bizIndexes.length).toBeGreaterThanOrEqual(2);
    expect(bizIndexes.some(i => i.table === 'properties')).toBe(true);
    expect(bizIndexes.some(i => i.table === 'contracts')).toBe(true);
  });

  it('formats executable TypeScript code containing ensureSchemaIndexes', () => {
    const indexes = parseSchemaIndexes(SAMPLE_DATABASE_TYPES, { includeBusinessSyncIndexes: false });
    const code = formatSchemaIndexesCode(indexes);

    expect(code).toContain('export const SCHEMA_INDEXES');
    expect(code).toContain('export async function ensureSchemaIndexes');
    expect(code).toContain('idx_contracts_house_id');
  });

  it('generates indexes from string content via generateSchemaIndexes', async () => {
    const result = await generateSchemaIndexes({
      typesContent: SAMPLE_DATABASE_TYPES,
      includeBusinessSyncIndexes: true,
    });

    expect(result.indexes.length).toBeGreaterThan(0);
    expect(result.code).toContain('SCHEMA_INDEXES');
    expect(result.written).toBe(false);
  });
});
