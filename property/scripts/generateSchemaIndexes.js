const fs = require('fs');
const path = require('path');

const DTS_PATH = path.resolve(__dirname, '../src/shared/types/database.types.ts');
const OUTPUT_PATH = path.resolve(__dirname, '../src/shared/services/sync/schemaIndexes.ts');

if (!fs.existsSync(DTS_PATH)) {
  console.error(`Database types file not found at: ${DTS_PATH}`);
  process.exit(1);
}

const content = fs.readFileSync(DTS_PATH, 'utf8');
const lines = content.split(/\r?\n/);

let currentTable = null;
let inRelationships = false;
let relLines = [];
const relationships = [];

for (const line of lines) {
  // Capture table name (e.g. "      contracts: {")
  const tableMatch = line.match(/^\s{6}([a-z0-9_]+):\s*\{/);
  if (tableMatch && !['Row', 'Insert', 'Update'].includes(tableMatch[1])) {
    currentTable = tableMatch[1];
  }

  // Handle empty relationships: "        Relationships: [];"
  if (line.includes('Relationships: [];')) {
    continue;
  }

  if (line.includes('Relationships: [')) {
    inRelationships = true;
    relLines = [];
    continue;
  }

  if (inRelationships) {
    // Only close on the array closing bracket, not column definitions like columns: ['id'];
    if (line.trim() === '];') {
      inRelationships = false;
      const block = relLines.join('\n');
      const itemRegex = /foreignKeyName:\s*['"]([^'"]+)['"][\s\S]*?columns:\s*\[([^\]]+)\][\s\S]*?isOneToOne:\s*(true|false)[\s\S]*?referencedRelation:\s*['"]([^'"]+)['"]/g;
      const matches = [...block.matchAll(itemRegex)];
      for (const m of matches) {
        const columns = m[2].split(',').map(c => c.trim().replace(/['"]/g, ''));
        relationships.push({
          table: currentTable,
          foreignKeyName: m[1],
          columns,
          isOneToOne: m[3] === 'true',
          referencedRelation: m[4],
        });
      }
      continue;
    }
    relLines.push(line);
  }
}

console.log(`Extracted ${relationships.length} foreign key relationships from database.types.ts.`);

// Build index statements
const statements = [];
for (const rel of relationships) {
  const isUnique = rel.isOneToOne ? 'UNIQUE ' : '';
  const colSql = rel.columns.map(c => `"${c}"`).join(', ');
  const colSlug = rel.columns.join('_');
  const indexName = `idx_${rel.table}_${colSlug}`;
  statements.push({
    table: rel.table,
    columns: rel.columns,
    isOneToOne: rel.isOneToOne,
    sql: `CREATE ${isUnique}INDEX IF NOT EXISTS "${indexName}" ON "${rel.table}" (${colSql});`,
    comment: rel.referencedRelation ? `References ${rel.referencedRelation}` : undefined,
  });
}

const fileContent = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.
 * Generated from src/shared/types/database.types.ts by scripts/generateSchemaIndexes.js.
 * Run "node scripts/generateSchemaIndexes.js" to regenerate.
 */

export interface SchemaIndexDefinition {
  table: string;
  columns: readonly string[];
  isOneToOne: boolean;
  sql: string;
  comment?: string;
}

/**
 * Foreign key relationships extracted from database.types.ts.
 */
export const SCHEMA_INDEXES: readonly SchemaIndexDefinition[] = ${JSON.stringify(statements, null, 2)} as const;

/**
 * Applies all schema foreign-key indexes into SQLite to ensure 0ms local reads.
 * Executes each index creation safely, catching missing tables during early initialization.
 */
export async function ensureSchemaForeignIndexes(db: {
  execute: (query: string) => Promise<any>;
}): Promise<void> {
  for (const index of SCHEMA_INDEXES) {
    try {
      await db.execute(index.sql);
    } catch {
      // Ignore if table does not exist yet on fresh install
    }
  }
}
`;

fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf8');
console.log(`Generated schema indexes written to ${OUTPUT_PATH}`);
