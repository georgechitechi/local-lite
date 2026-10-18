import { LocalFirstClient, TransactionalClient } from './client.js';
import { QueryOptions, WhereFilter } from './types.js';

type ClientLike = LocalFirstClient | TransactionalClient;

/**
 * Escapes an identifier or compound identifier (e.g. 'table.column' or 'table.col as alias').
 */
export function formatColumnIdentifier(col: string): string {
  const trimmed = col.trim();
  if (trimmed === '*') return '*';

  // Handle "expression AS alias"
  const asMatch = trimmed.match(/^(.+?)\s+(?:AS|as)\s+([A-Za-z0-9_"]+)$/i);
  if (asMatch) {
    const [, expr, rawAlias] = asMatch;
    const unquotedAlias =
      rawAlias.startsWith('"') && rawAlias.endsWith('"')
        ? rawAlias.slice(1, -1)
        : rawAlias;
    const cleanAlias = `"${unquotedAlias.replace(/"/g, '""')}"`;
    if (expr.includes('(') && expr.endsWith(')')) {
      return `${expr} AS ${cleanAlias}`;
    }
    return `${formatColumnIdentifier(expr)} AS ${cleanAlias}`;
  }

  // Handle function calls without alias (e.g. COUNT(*))
  if (trimmed.includes('(') && trimmed.endsWith(')')) {
    return trimmed;
  }

  // Handle "table.column"
  if (trimmed.includes('.')) {
    return trimmed
      .split('.')
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join('.');
  }

  return `"${trimmed.replace(/"/g, '""')}"`;
}

export interface JoinDefinition {
  type: 'INNER' | 'LEFT' | 'CROSS';
  table: string;
  firstCol: string;
  secondCol: string;
}

export interface AggregateSpec {
  where?: WhereFilter;
  count?: boolean;
  sum?: string[];
  avg?: string[];
  min?: string[];
  max?: string[];
}

export interface AggregateResult {
  count?: number;
  sum?: Record<string, number>;
  avg?: Record<string, number | null>;
  min?: Record<string, any>;
  max?: Record<string, any>;
}

/**
 * Fluent, type-safe SQL Query Builder for local-first SQLite operations.
 * Allows writing expressive JavaScript code that compiles and executes high-performance SQL under the hood.
 */
export class QueryBuilder<T = any> {
  private client: ClientLike;
  private tableName: string;
  private selectCols: string[] = ['*'];
  private joins: JoinDefinition[] = [];
  private whereConditions: Record<string, any> = {};
  private orderColumn?: string;
  private orderDirection: 'ASC' | 'DESC' = 'ASC';
  private limitCount?: number;
  private offsetCount?: number;
  private groupByCols: string[] = [];
  private includeDeleted: boolean = false;

  constructor(client: ClientLike, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * Specifies which columns to select.
   * Supports column aliases (e.g. ['id', 'contracts.rent_amount AS rent', 'houses.house_number']).
   */
  select(...columns: Array<string | string[]>): this {
    const flat = columns.flat();
    if (flat.length > 0) {
      this.selectCols = flat;
    }
    return this;
  }

  /**
   * Inner joins another SQLite table on a matching column expression.
   */
  join(table: string, firstCol: string, secondCol: string): this {
    this.joins.push({ type: 'INNER', table, firstCol, secondCol });
    return this;
  }

  /**
   * Left joins another SQLite table on a matching column expression.
   */
  leftJoin(table: string, firstCol: string, secondCol: string): this {
    this.joins.push({ type: 'LEFT', table, firstCol, secondCol });
    return this;
  }

  /**
   * Adds WHERE criteria to filter results.
   * Supports:
   * - where({ status: 'ACTIVE' })
   * - where('status', 'ACTIVE')
   * - where('end_date', '>=', today)
   */
  where(
    columnOrFilter: string | WhereFilter,
    operatorOrValue?: any,
    value?: any,
  ): this {
    if (typeof columnOrFilter === 'string') {
      if (value !== undefined) {
        const rawOp = String(operatorOrValue).toLowerCase().trim();
        const opKey =
          rawOp === '>=' ? '$gte' :
          rawOp === '<=' ? '$lte' :
          rawOp === '>' ? '$gt' :
          rawOp === '<' ? '$lt' :
          rawOp === '!=' || rawOp === '<>' ? '$ne' :
          rawOp === '=' || rawOp === '==' ? '$eq' :
          rawOp === 'like' ? '$contains' : '$eq';

        const existing =
          typeof this.whereConditions[columnOrFilter] === 'object' &&
          this.whereConditions[columnOrFilter] !== null
            ? (this.whereConditions[columnOrFilter] as any)
            : {};
        this.whereConditions[columnOrFilter] = { ...existing, [opKey]: value };
      } else {
        this.whereConditions[columnOrFilter] = operatorOrValue;
      }
    } else if (columnOrFilter && typeof columnOrFilter === 'object') {
      this.whereConditions = { ...this.whereConditions, ...columnOrFilter };
    }
    return this;
  }

  /**
   * Orders query results by column and direction.
   */
  orderBy(column: string, direction: 'asc' | 'desc' | 'ASC' | 'DESC' = 'ASC'): this {
    this.orderColumn = column;
    this.orderDirection = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return this;
  }

  /**
   * Groups rows by one or more columns for aggregation.
   */
  groupBy(...columns: Array<string | string[]>): this {
    this.groupByCols = columns.flat();
    return this;
  }

  /**
   * Limits the number of returned records.
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /**
   * Offsets the starting record position.
   */
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /**
   * Includes soft-deleted rows in results.
   */
  withDeleted(include: boolean = true): this {
    this.includeDeleted = include;
    return this;
  }

  /**
   * Applies standard QueryOptions (select, where, orderBy, limit, offset, includeDeleted) to this query.
   */
  applyOptions(options?: QueryOptions): this {
    if (!options) return this;
    if (options.select) this.select(options.select);
    if (options.where && typeof options.where === 'object') this.where(options.where);
    if (options.orderBy) this.orderBy(options.orderBy, options.order || 'ASC');
    if (typeof options.limit === 'number') this.limit(options.limit);
    if (typeof options.offset === 'number') this.offset(options.offset);
    if (options.includeDeleted) this.withDeleted(true);
    return this;
  }

  /**
   * Compiles the current builder state into an executable SQL string and parameter list.
   */
  toSQL(): { sql: string; params: any[] } {
    const params: any[] = [];
    const projections = this.selectCols.map(formatColumnIdentifier).join(', ');
    const fromTable = `"${this.tableName.replace(/"/g, '""')}"`;
    let sql = `SELECT ${projections} FROM ${fromTable}`;

    // Append JOINs
    for (const j of this.joins) {
      const joinTable = `"${j.table.replace(/"/g, '""')}"`;
      const col1 = formatColumnIdentifier(j.firstCol);
      const col2 = formatColumnIdentifier(j.secondCol);
      sql += ` ${j.type} JOIN ${joinTable} ON ${col1} = ${col2}`;
    }

    // Build WHERE clauses
    const whereClauses: string[] = [];
    if (this.whereConditions && typeof this.whereConditions === 'object') {
      for (const [col, val] of Object.entries(this.whereConditions)) {
        if (col === '$or' || col === '$and') continue;
        const safeCol = formatColumnIdentifier(col);

        if (val === null) {
          whereClauses.push(`${safeCol} IS NULL`);
        } else if (typeof val === 'boolean') {
          whereClauses.push(`${safeCol} = ?`);
          params.push(val ? 1 : 0);
        } else if (typeof val === 'string' || typeof val === 'number') {
          whereClauses.push(`${safeCol} = ?`);
          params.push(val);
        } else if (typeof val === 'object' && !Array.isArray(val)) {
          const ops = val as any;
          const eqVal = ops.$eq !== undefined ? ops.$eq : ops.eq;
          if (eqVal !== undefined) {
            whereClauses.push(`${safeCol} = ?`);
            params.push(typeof eqVal === 'boolean' ? (eqVal ? 1 : 0) : eqVal);
          }
          const neVal = ops.$ne !== undefined ? ops.$ne : ops.ne;
          if (neVal !== undefined) {
            whereClauses.push(`${safeCol} != ?`);
            params.push(typeof neVal === 'boolean' ? (neVal ? 1 : 0) : neVal);
          }
          const gtVal = ops.$gt !== undefined ? ops.$gt : ops.gt;
          if (gtVal !== undefined) {
            whereClauses.push(`${safeCol} > ?`);
            params.push(gtVal);
          }
          const gteVal = ops.$gte !== undefined ? ops.$gte : ops.gte;
          if (gteVal !== undefined) {
            whereClauses.push(`${safeCol} >= ?`);
            params.push(gteVal);
          }
          const ltVal = ops.$lt !== undefined ? ops.$lt : ops.lt;
          if (ltVal !== undefined) {
            whereClauses.push(`${safeCol} < ?`);
            params.push(ltVal);
          }
          const lteVal = ops.$lte !== undefined ? ops.$lte : ops.lte;
          if (lteVal !== undefined) {
            whereClauses.push(`${safeCol} <= ?`);
            params.push(lteVal);
          }
          const inVal = ops.$in !== undefined ? ops.$in : ops.in;
          if (Array.isArray(inVal) && inVal.length > 0) {
            const placeholders = inVal.map(() => '?').join(', ');
            whereClauses.push(`${safeCol} IN (${placeholders})`);
            params.push(...inVal);
          }
          const ninVal = ops.$nin !== undefined ? ops.$nin : ops.nin;
          if (Array.isArray(ninVal) && ninVal.length > 0) {
            const placeholders = ninVal.map(() => '?').join(', ');
            whereClauses.push(`${safeCol} NOT IN (${placeholders})`);
            params.push(...ninVal);
          }
          const containsVal = ops.$contains !== undefined ? ops.$contains : ops.contains;
          if (containsVal !== undefined) {
            whereClauses.push(`${safeCol} LIKE ?`);
            params.push(`%${containsVal}%`);
          }
          const nullVal = ops.$null !== undefined ? ops.$null : ops.null;
          if (nullVal !== undefined) {
            whereClauses.push(nullVal ? `${safeCol} IS NULL` : `${safeCol} IS NOT NULL`);
          }
        }
      }
    }

    // Push down soft-deletion check on primary table if deleted column exists and not explicitly overridden
    const schemaManager =
      'schemaManager' in this.client
        ? (this.client as LocalFirstClient).schemaManager
        : (this.client as any).parent?.schemaManager;

    if (!this.includeDeleted && schemaManager?.hasColumn(this.tableName, 'deleted')) {
      const delCol = this.tableName.includes('.')
        ? `${formatColumnIdentifier(this.tableName)}."deleted"`
        : `"${this.tableName.replace(/"/g, '""')}"."deleted"`;
      whereClauses.push(`(${delCol} IS NULL OR (${delCol} != 1 AND ${delCol} != 'true'))`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    // GROUP BY
    if (this.groupByCols.length > 0) {
      sql += ` GROUP BY ${this.groupByCols.map(formatColumnIdentifier).join(', ')}`;
    }

    // ORDER BY
    if (this.orderColumn) {
      sql += ` ORDER BY ${formatColumnIdentifier(this.orderColumn)} ${this.orderDirection}`;
    }

    // LIMIT & OFFSET
    if (typeof this.limitCount === 'number' && this.limitCount > 0) {
      sql += ` LIMIT ?`;
      params.push(this.limitCount);
      if (typeof this.offsetCount === 'number' && this.offsetCount > 0) {
        sql += ` OFFSET ?`;
        params.push(this.offsetCount);
      }
    }

    return { sql, params };
  }

  /**
   * Executes the compiled SQL query against SQLite and returns rows.
   */
  async execute(): Promise<T[]> {
    const schemaManager =
      'schemaManager' in this.client
        ? (this.client as LocalFirstClient).schemaManager
        : (this.client as any).parent?.schemaManager;
    const db =
      'db' in this.client ? (this.client as LocalFirstClient).db : (this.client as any).tx;
    if (schemaManager && db) {
      await schemaManager.ensureTableIntrospected(db, this.tableName);
      for (const j of this.joins) {
        await schemaManager.ensureTableIntrospected(db, j.table);
      }
    }

    const { sql, params } = this.toSQL();
    try {
      const rawRows = await this.client.query<T>(sql, params);
      const hydrator =
        'hydrateRow' in this.client
          ? (this.client as any).hydrateRow.bind(this.client)
          : (this.client as any).parent?.hydrateRow?.bind((this.client as any).parent);
      if (hydrator && rawRows && rawRows.length > 0) {
        return rawRows.map((r: any) => hydrator(this.tableName, r));
      }
      return rawRows;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('no such table') || msg.includes('no such column')) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Returns the first matching record or null if not found.
   */
  async first(): Promise<T | null> {
    const originalLimit = this.limitCount;
    this.limitCount = 1;
    const rows = await this.execute();
    this.limitCount = originalLimit;
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Executes a COUNT(*) in SQLite and returns the numeric count directly.
   */
  async count(): Promise<number> {
    const originalSelect = this.selectCols;
    this.selectCols = ['COUNT(*) AS _count'];
    const rows = await this.execute();
    this.selectCols = originalSelect;
    const countVal = (rows[0] as any)?._count;
    return typeof countVal === 'number' ? countVal : Number(countVal) || 0;
  }

  /**
   * Executes a SUM(column) in SQLite and returns the numeric total directly.
   */
  async sum(column: string): Promise<number> {
    const originalSelect = this.selectCols;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`COALESCE(SUM(${safeCol}), 0) AS _sum`];
    const rows = await this.execute();
    this.selectCols = originalSelect;
    const sumVal = (rows[0] as any)?._sum;
    return typeof sumVal === 'number' ? sumVal : Number(sumVal) || 0;
  }

  /**
   * Executes an AVG(column) in SQLite and returns the average directly.
   */
  async avg(column: string): Promise<number | null> {
    const originalSelect = this.selectCols;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`AVG(${safeCol}) AS _avg`];
    const rows = await this.execute();
    this.selectCols = originalSelect;
    const avgVal = (rows[0] as any)?._avg;
    return avgVal === null || avgVal === undefined ? null : Number(avgVal) || 0;
  }
}
