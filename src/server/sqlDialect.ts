export type SqlDialect = 'mysql' | 'postgres';

export interface SqlExecutor {
  dialect: SqlDialect;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ affectedRows: number }>;
  withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export function quoteIdent(
  ident: string,
  dialect: SqlDialect = 'mysql',
): string {
  const clean = ident.replace(/[`"]/g, '');
  return dialect === 'postgres' ? `"${clean}"` : `\`${clean}\``;
}

export interface UpsertSqlOptions {
  table: string;
  conflictCols: string[];
  insertCols: string[];
  updateCols: string[];
  dialect?: SqlDialect;
}

export function buildUpsertSql(opts: UpsertSqlOptions): string {
  const dialect = opts.dialect ?? 'mysql';
  const q = (col: string) => quoteIdent(col, dialect);
  const tbl = q(opts.table);
  const cols = opts.insertCols.map(q).join(', ');
  const placeholders = opts.insertCols.map(() => '?').join(', ');

  if (dialect === 'postgres') {
    const conflict = opts.conflictCols.map(q).join(', ');
    if (opts.updateCols.length === 0) {
      return `INSERT INTO ${tbl} (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO NOTHING`;
    }
    const updates = opts.updateCols
      .map((c) => `${q(c)} = EXCLUDED.${q(c)}`)
      .join(', ');
    return `INSERT INTO ${tbl} (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
  }

  if (opts.updateCols.length === 0) {
    return `INSERT IGNORE INTO ${tbl} (${cols}) VALUES (${placeholders})`;
  }
  const updates = opts.updateCols
    .map((c) => `${q(c)} = VALUES(${q(c)})`)
    .join(', ');
  return `INSERT INTO ${tbl} (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
}

export function rewriteSqlTokensForPostgres(sql: string): string {
  let out = '';
  let paramIdx = 1;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      if (inSingle && sql[i + 1] === "'") {
        out += "'";
        i++;
      }
      continue;
    }
    if (ch === '\\' && inSingle && i + 1 < sql.length) {
      out += ch + sql[i + 1];
      i++;
      continue;
    }
    if (ch === '`' && !inSingle) {
      inDouble = !inDouble;
      out += '"';
      continue;
    }
    if (ch === '?' && !inSingle && !inDouble) {
      out += `$${paramIdx++}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export function adaptSqlForPostgres(rawSql: string): string[] {
  let sql = rawSql.trim();
  if (!sql) return [];
  if (sql.startsWith('--') && !sql.includes('\n')) return [];

  sql = sql.replace(/\s+ENGINE\s*=\s*\w+/gi, '');
  sql = sql.replace(/\s+DEFAULT\s+CHARSET\s*=\s*[\w-]+/gi, '');
  sql = sql.replace(/\s+COLLATE\s*=?\s*[\w-]+/gi, '');
  sql = sql.replace(/`([^`]+)`/g, '"$1"');
  sql = sql.replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'SMALLINT');
  sql = sql.replace(/\bLONGTEXT\b/gi, 'TEXT');
  sql = sql.replace(/\bMEDIUMTEXT\b/gi, 'TEXT');
  sql = sql.replace(/\bDOUBLE\b/gi, 'DOUBLE PRECISION');
  sql = sql.replace(/\bENUM\s*\([^)]*\)/gi, 'VARCHAR(64)');
  sql = sql.replace(
    /\bBIGINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi,
    'BIGSERIAL PRIMARY KEY',
  );
  sql = sql.replace(
    /\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi,
    'SERIAL PRIMARY KEY',
  );

  if (/^\s*INSERT\s+IGNORE\s+INTO\b/i.test(sql)) {
    sql = sql.replace(/^\s*INSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    sql = sql.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
    return [sql];
  }

  const alterIdxMatch = sql.match(
    /^\s*ALTER\s+TABLE\s+(?:"([^"]+)"|(\S+))\s+ADD\s+(?:UNIQUE\s+)?INDEX\s+"?(\w+)"?\s*\(([^)]+)\)\s*;?\s*$/i,
  );
  if (alterIdxMatch) {
    const tbl = alterIdxMatch[1] || alterIdxMatch[2];
    const idxName = alterIdxMatch[3];
    const cols = alterIdxMatch[4];
    const unique = /\bADD\s+UNIQUE\s+INDEX\b/i.test(sql) ? 'UNIQUE ' : '';
    return [
      `CREATE ${unique}INDEX IF NOT EXISTS "${tbl}_${idxName}" ON "${tbl}" (${cols})`,
    ];
  }

  const tableMatch = sql.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\S+))\s*\(/i,
  );
  const tableName = tableMatch?.[1] || tableMatch?.[2];
  const extractedIndexes: string[] = [];

  if (tableName) {
    sql = sql.replace(
      /,\s*INDEX\s+"?(\w+)"?\s*\(([^)]+)\)/gi,
      (_m, idxName, cols) => {
        extractedIndexes.push(
          `CREATE INDEX IF NOT EXISTS "${tableName}_${idxName}" ON "${tableName}" (${cols})`,
        );
        return '';
      },
    );
  }

  return [sql, ...extractedIndexes];
}

export function createSqlExecutor(pool: any, dialect: SqlDialect): SqlExecutor {
  const execOn = (conn: any): SqlExecutor => ({
    dialect,
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      if (dialect === 'postgres') {
        const res = await conn.query(rewriteSqlTokensForPostgres(sql), params);
        return (res?.rows ?? []) as T[];
      }
      const [rows] = await conn.query(sql, params);
      return (Array.isArray(rows) ? rows : []) as T[];
    },
    async execute(
      sql: string,
      params: any[] = [],
    ): Promise<{ affectedRows: number }> {
      if (dialect === 'postgres') {
        const res = await conn.query(rewriteSqlTokensForPostgres(sql), params);
        return { affectedRows: Number(res?.rowCount ?? 0) };
      }
      const [res] = await conn.execute(sql, params);
      return { affectedRows: Number(res?.affectedRows ?? 0) };
    },
    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return fn(execOn(conn));
    },
  });

  const root = execOn(pool);
  return {
    ...root,
    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (dialect === 'postgres') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(execOn(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(execOn(conn));
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
