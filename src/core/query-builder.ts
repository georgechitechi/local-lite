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

// ---------------------------------------------------------------------------
// Module-scoped SQL compilation helpers (defined once, reused on every query)
// ---------------------------------------------------------------------------

function escapeLikePattern(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

/**
 * Compiles a single column comparison value into one or more SQL fragments.
 * Supports null, boolean, scalar, and operator-object forms ($eq, $gt, $in, …).
 */
function compileComparison(
  safeCol: string,
  val: any,
  params: any[],
): string | null {
  if (val === null) {
    return `${safeCol} IS NULL`;
  }
  if (typeof val === 'boolean') {
    params.push(val ? 1 : 0);
    return `${safeCol} = ?`;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    params.push(val);
    return `${safeCol} = ?`;
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const ops = val as any;
    const subClauses: string[] = [];

    if (ops.$eq !== undefined) {
      subClauses.push(`${safeCol} = ?`);
      params.push(typeof ops.$eq === 'boolean' ? (ops.$eq ? 1 : 0) : ops.$eq);
    }
    if (ops.$ne !== undefined) {
      subClauses.push(`${safeCol} != ?`);
      params.push(typeof ops.$ne === 'boolean' ? (ops.$ne ? 1 : 0) : ops.$ne);
    }
    if (ops.$gt !== undefined) {
      subClauses.push(`${safeCol} > ?`);
      params.push(ops.$gt);
    }
    if (ops.$gte !== undefined) {
      subClauses.push(`${safeCol} >= ?`);
      params.push(ops.$gte);
    }
    if (ops.$lt !== undefined) {
      subClauses.push(`${safeCol} < ?`);
      params.push(ops.$lt);
    }
    if (ops.$lte !== undefined) {
      subClauses.push(`${safeCol} <= ?`);
      params.push(ops.$lte);
    }
    if (Array.isArray(ops.$in) && ops.$in.length > 0) {
      const placeholders = ops.$in.map(() => '?').join(', ');
      subClauses.push(`${safeCol} IN (${placeholders})`);
      params.push(...ops.$in);
    }
    if (Array.isArray(ops.$nin) && ops.$nin.length > 0) {
      const placeholders = ops.$nin.map(() => '?').join(', ');
      subClauses.push(`${safeCol} NOT IN (${placeholders})`);
      params.push(...ops.$nin);
    }
    if (ops.$contains !== undefined) {
      subClauses.push(`${safeCol} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(ops.$contains)}%`);
    }
    if (ops.$startsWith !== undefined) {
      subClauses.push(`${safeCol} LIKE ? ESCAPE '\\'`);
      params.push(`${escapeLikePattern(ops.$startsWith)}%`);
    }
    if (ops.$endsWith !== undefined) {
      subClauses.push(`${safeCol} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(ops.$endsWith)}`);
    }
    if (ops.$null !== undefined) {
      subClauses.push(
        ops.$null ? `${safeCol} IS NULL` : `${safeCol} IS NOT NULL`,
      );
    }

    if (subClauses.length > 0) {
      return subClauses.join(' AND ');
    }
  }
  return null;
}

/**
 * Recursively compiles a where-conditions object (including $or / $and) into SQL clauses.
 */
function compileWhereConditions(
  where: Record<string, any>,
  params: any[],
): string[] {
  const clauses: string[] = [];

  // Handle $or — compile each branch, join with OR
  if (Array.isArray(where.$or) && where.$or.length > 0) {
    const orClauses: string[] = [];
    for (const sub of where.$or) {
      if (typeof sub === 'object' && sub !== null) {
        const subList = compileWhereConditions(sub, params);
        if (subList.length > 0) {
          orClauses.push(`(${subList.join(' AND ')})`);
        }
      }
    }
    if (orClauses.length > 0) {
      clauses.push(`(${orClauses.join(' OR ')})`);
    }
  }

  // Handle $and — compile each branch, join with AND
  if (Array.isArray(where.$and) && where.$and.length > 0) {
    const andClauses: string[] = [];
    for (const sub of where.$and) {
      if (typeof sub === 'object' && sub !== null) {
        const subList = compileWhereConditions(sub, params);
        if (subList.length > 0) {
          andClauses.push(`(${subList.join(' AND ')})`);
        }
      }
    }
    if (andClauses.length > 0) {
      clauses.push(`(${andClauses.join(' AND ')})`);
    }
  }

  // Handle regular column conditions
  for (const [col, val] of Object.entries(where)) {
    if (col === '$or' || col === '$and') continue;
    const safeCol = formatColumnIdentifier(col);
    const clause = compileComparison(safeCol, val, params);
    if (clause) {
      clauses.push(clause);
    }
  }

  return clauses;
}

// ---------------------------------------------------------------------------

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
        const opMap: Record<string, string> = {
          '>=': '$gte',
          '<=': '$lte',
          '>': '$gt',
          '<': '$lt',
          '!=': '$ne',
          '<>': '$ne',
          '=': '$eq',
          '==': '$eq',
          like: '$contains',
          in: '$in',
          'not in': '$nin',
          $eq: '$eq',
          $ne: '$ne',
          $gt: '$gt',
          $gte: '$gte',
          $lt: '$lt',
          $lte: '$lte',
          $in: '$in',
          $nin: '$nin',
          $contains: '$contains',
          $startswith: '$startsWith',
          $endswith: '$endsWith',
        };
        const opKey = opMap[rawOp] ?? '$eq';

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
  orderBy(
    column: string,
    direction: 'asc' | 'desc' | 'ASC' | 'DESC' = 'ASC',
  ): this {
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
    if (options.where && typeof options.where === 'object')
      this.where(options.where);
    if (options.orderBy) this.orderBy(options.orderBy, options.order || 'ASC');
    if (typeof options.limit === 'number') this.limit(options.limit);
    if (typeof options.offset === 'number') this.offset(options.offset);
    if (options.includeDeleted) this.withDeleted(true);
    return this;
  }

  /**
   * Compiles the current builder state into an executable SQL string and parameter list.
   * Uses module-scoped compileComparison / compileWhereConditions helpers (defined once).
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

    // Build WHERE clauses (delegates to module-scoped helpers)
    const whereClauses: string[] = [];
    if (this.whereConditions && typeof this.whereConditions === 'object') {
      whereClauses.push(
        ...compileWhereConditions(this.whereConditions, params),
      );
    }

    // Push down soft-deletion check on primary table if deleted column exists and not explicitly overridden
    const schemaManager =
      'schemaManager' in this.client
        ? (this.client as LocalFirstClient).schemaManager
        : (this.client as any).parent?.schemaManager;

    if (
      !this.includeDeleted &&
      schemaManager?.hasColumn(this.tableName, 'deleted')
    ) {
      const delCol = this.tableName.includes('.')
        ? `${formatColumnIdentifier(this.tableName)}."deleted"`
        : `"${this.tableName.replace(/"/g, '""')}"."deleted"`;
      whereClauses.push(
        `(${delCol} IS NULL OR (${delCol} != 1 AND ${delCol} != 'true'))`,
      );
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
    if (typeof this.limitCount === 'number' && this.limitCount >= 0) {
      sql += ` LIMIT ?`;
      params.push(this.limitCount);
      if (typeof this.offsetCount === 'number' && this.offsetCount > 0) {
        sql += ` OFFSET ?`;
        params.push(this.offsetCount);
      }
    } else if (typeof this.offsetCount === 'number' && this.offsetCount > 0) {
      sql += ` LIMIT -1 OFFSET ?`;
      params.push(this.offsetCount);
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
      'db' in this.client
        ? (this.client as LocalFirstClient).db
        : (this.client as any).tx;
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
          : (this.client as any).parent?.hydrateRow?.bind(
              (this.client as any).parent,
            );
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
    try {
      const rows = await this.execute();
      return rows.length > 0 ? rows[0] : null;
    } finally {
      this.limitCount = originalLimit;
    }
  }

  /**
   * Executes a COUNT(*) in SQLite and returns the numeric count directly.
   */
  async count(): Promise<number> {
    const originalSelect = this.selectCols;
    this.selectCols = ['COUNT(*) AS _count'];
    try {
      const rows = await this.execute();
      const countVal = (rows[0] as any)?._count;
      return typeof countVal === 'number' ? countVal : Number(countVal) || 0;
    } finally {
      this.selectCols = originalSelect;
    }
  }

  /**
   * Executes a SUM(column) in SQLite and returns the numeric total directly.
   */
  async sum(column: string): Promise<number> {
    const originalSelect = this.selectCols;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`COALESCE(SUM(${safeCol}), 0) AS _sum`];
    try {
      const rows = await this.execute();
      const sumVal = (rows[0] as any)?._sum;
      return typeof sumVal === 'number' ? sumVal : Number(sumVal) || 0;
    } finally {
      this.selectCols = originalSelect;
    }
  }

  /**
   * Executes an AVG(column) in SQLite and returns the average directly.
   */
  async avg(column: string): Promise<number | null> {
    const originalSelect = this.selectCols;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`AVG(${safeCol}) AS _avg`];
    try {
      const rows = await this.execute();
      const avgVal = (rows[0] as any)?._avg;
      return avgVal === null || avgVal === undefined
        ? null
        : Number(avgVal) || 0;
    } finally {
      this.selectCols = originalSelect;
    }
  }
}
