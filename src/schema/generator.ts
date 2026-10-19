export interface SchemaIndexDefinition {
  table: string;
  columns: string[];
  isOneToOne: boolean;
  sql: string;
  referencedRelation?: string;
  referencedColumns?: string[];
  comment?: string;
}

export interface GenerateSchemaIndexesOptions {
  /**
   * Path to the Supabase database.types.ts file.
   */
  typesPath?: string;
  /**
   * Raw string content of the database.types.ts file.
   */
  typesContent?: string;
  /**
   * Target path where the generated TypeScript file should be written.
   */
  outputPath?: string;
  /**
   * Whether to also generate composite sync indexes for tables with business_id and deleted.
   * Default: true
   */
  includeBusinessSyncIndexes?: boolean;
}

export interface GenerateSchemaIndexesResult {
  indexes: SchemaIndexDefinition[];
  code: string;
  written: boolean;
  outputPath?: string;
}

interface NodeFS {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: string): string;
  writeFileSync(p: string, data: string, encoding: string): void;
  mkdirSync(p: string, options?: { recursive?: boolean }): void;
}

interface NodePath {
  resolve(...paths: string[]): string;
  dirname(p: string): string;
}

async function getNodeModules(): Promise<{ fs: NodeFS; path: NodePath }> {
  try {
    const fsModName = 'node:fs';
    const pathModName = 'node:path';
    const fsMod = await import(/* @vite-ignore */ fsModName);
    const pathMod = await import(/* @vite-ignore */ pathModName);
    return {
      fs: (fsMod.default || fsMod) as any,
      path: (pathMod.default || pathMod) as any,
    };
  } catch {
    const req = typeof require !== 'undefined' ? require : null;
    if (req) {
      return {
        fs: req('fs'),
        path: req('path'),
      };
    }
    throw new Error(
      'Node.js filesystem (fs) and path modules are not available in this environment.'
    );
  }
}

/**
 * Parses raw Supabase database.types.ts content and extracts foreign-key index definitions.
 */
export function parseSchemaIndexes(
  content: string,
  options: { includeBusinessSyncIndexes?: boolean } = {}
): SchemaIndexDefinition[] {
  const lines = content.split(/\r?\n/);
  const includeBusiness = options.includeBusinessSyncIndexes ?? true;

  let currentTable: string | null = null;
  let inRow = false;
  let inRelationships = false;
  let relLines: string[] = [];
  const tableColumns = new Map<string, Set<string>>();
  const relationships: SchemaIndexDefinition[] = [];

  for (const line of lines) {
    // Detect table definition: "      <table_name>: {"
    const tableMatch = line.match(/^\s{6}([a-z0-9_]+):\s*\{/);
    if (tableMatch && !['Row', 'Insert', 'Update'].includes(tableMatch[1])) {
      currentTable = tableMatch[1];
      if (!tableColumns.has(currentTable)) {
        tableColumns.set(currentTable, new Set());
      }
    }

    // Track column names in Row: { ... }
    if (line.includes('Row: {')) {
      inRow = true;
      continue;
    }
    if (inRow) {
      if (line.trim() === '};' || line.trim() === '}') {
        inRow = false;
      } else if (currentTable) {
        const colMatch = line.match(/^\s{10}([a-z0-9_]+):/);
        if (colMatch) {
          tableColumns.get(currentTable)?.add(colMatch[1]);
        }
      }
    }

    // Skip empty relationships
    if (line.includes('Relationships: [];') || line.includes('Relationships: []')) {
      continue;
    }

    if (line.includes('Relationships: [')) {
      inRelationships = true;
      relLines = [];
      continue;
    }

    if (inRelationships) {
      if (line.trim() === '];' || line.trim() === ']') {
        inRelationships = false;
        if (currentTable) {
          const block = relLines.join('\n');
          const itemRegex =
            /foreignKeyName:\s*['"]([^'"]+)['"][\s\S]*?columns:\s*\[([^\]]+)\][\s\S]*?isOneToOne:\s*(true|false)[\s\S]*?referencedRelation:\s*['"]([^'"]+)['"](?:[\s\S]*?referencedColumns:\s*\[([^\]]+)\])?/g;
          const matches = [...block.matchAll(itemRegex)];
          for (const m of matches) {
            const columns = m[2].split(',').map(c => c.trim().replace(/['"]/g, ''));
            const isOneToOne = m[3] === 'true';
            const referencedRelation = m[4];
            const referencedColumns = m[5]
              ? m[5].split(',').map(c => c.trim().replace(/['"]/g, ''))
              : undefined;

            const isUnique = isOneToOne ? 'UNIQUE ' : '';
            const colSql = columns.map(c => `"${c}"`).join(', ');
            const colSlug = columns.join('_');
            const indexName = `idx_${currentTable}_${colSlug}`;

            relationships.push({
              table: currentTable,
              columns,
              isOneToOne,
              referencedRelation,
              referencedColumns,
              sql: `CREATE ${isUnique}INDEX IF NOT EXISTS "${indexName}" ON "${currentTable}" (${colSql});`,
              comment: referencedRelation
                ? `References ${referencedRelation}${referencedColumns ? `(${referencedColumns.join(', ')})` : ''}`
                : undefined,
            });
          }
        }
        continue;
      }
      relLines.push(line);
    }
  }

  // Optionally append composite business sync indexes
  if (includeBusiness) {
    for (const [table, cols] of tableColumns.entries()) {
      if (cols.has('business_id') && cols.has('deleted')) {
        const idxName = `idx_${table}_biz_del`;
        if (
          !relationships.some(
            r =>
              r.table === table &&
              r.columns.length === 2 &&
              r.columns.includes('business_id') &&
              r.columns.includes('deleted')
          )
        ) {
          relationships.push({
            table,
            columns: ['business_id', 'deleted'],
            isOneToOne: false,
            sql: `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" ("business_id", "deleted");`,
            comment: 'Composite business partition index for zero-latency local queries',
          });
        }
      }
    }
  }

  return relationships;
}

/**
 * Generates TypeScript source code containing index definitions and an applicator helper.
 */
export function formatSchemaIndexesCode(indexes: SchemaIndexDefinition[]): string {
  return `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.
 * Generated by local-lite schema index generator.
 */

export interface SchemaIndexDefinition {
  table: string;
  columns: readonly string[];
  isOneToOne: boolean;
  sql: string;
  referencedRelation?: string;
  referencedColumns?: readonly string[];
  comment?: string;
}

/**
 * Schema indexes extracted from Supabase database types.
 */
export const SCHEMA_INDEXES: readonly SchemaIndexDefinition[] = ${JSON.stringify(indexes, null, 2)} as const;

/**
 * Applies all schema indexes into SQLite to ensure zero-latency local reads.
 * Executes each statement safely, ignoring errors if tables are not yet created.
 */
export async function ensureSchemaIndexes(db: {
  execute: (query: string, params?: any[]) => Promise<any>;
}): Promise<void> {
  for (const index of SCHEMA_INDEXES) {
    try {
      await db.execute(index.sql);
    } catch {
      // Safe fallback if table has not been created yet
    }
  }
}
`;
}

/**
 * Core generator function.
 * Accepts the path or content of database.types.ts and generates schema indexes.
 */
export async function generateSchemaIndexes(
  typesPathOrOptions: string | GenerateSchemaIndexesOptions,
  maybeOutputPath?: string
): Promise<GenerateSchemaIndexesResult> {
  const options: GenerateSchemaIndexesOptions =
    typeof typesPathOrOptions === 'string'
      ? { typesPath: typesPathOrOptions, outputPath: maybeOutputPath }
      : typesPathOrOptions;

  let content = options.typesContent;

  if (!content && options.typesPath) {
    const { fs, path } = await getNodeModules();
    const resolvedPath = path.resolve(options.typesPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Types file not found at: ${resolvedPath}`);
    }
    content = fs.readFileSync(resolvedPath, 'utf8');
  }

  if (!content) {
    throw new Error('Either typesPath or typesContent must be provided to generateSchemaIndexes.');
  }

  const indexes = parseSchemaIndexes(content, {
    includeBusinessSyncIndexes: options.includeBusinessSyncIndexes,
  });
  const code = formatSchemaIndexesCode(indexes);

  let written = false;
  let resolvedOutputPath: string | undefined;

  if (options.outputPath) {
    const { fs, path } = await getNodeModules();
    resolvedOutputPath = path.resolve(options.outputPath);
    const parentDir = path.dirname(resolvedOutputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolvedOutputPath, code, 'utf8');
    written = true;
  }

  return {
    indexes,
    code,
    written,
    outputPath: resolvedOutputPath,
  };
}
