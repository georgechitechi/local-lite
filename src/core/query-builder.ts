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

export interface WithRelationSpec {
  /** Related table name to load. */
  table: string;
  /** Property name to attach on each parent row (defaults to `table`). */
  as?: string;
  /** Foreign key column name (auto-resolved from client.relationships if omitted). */
  foreignKey?: string;
  /** Local key column name (defaults to primaryKey / 'id'). */
  localKey?: string;
  /** Explicit cardinality; inferred from client.relationships when omitted. */
  type?: 'hasMany' | 'belongsTo';
  /** Optional filter applied to the related rows query. */
  where?: WhereFilter;
}

export interface PreparedQuery<T = any> {
  sql: string;
  params: any[];
  execute(overrideParams?: any[]): Promise<T[]>;
  first(overrideParams?: any[]): Promise<T | null>;
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

const OP_MAP: Record<string, string> = {
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

function mergeWhereOperator(
  target: Record<string, any>,
  column: string,
  operatorOrValue: any,
  value?: any,
): void {
  if (value !== undefined) {
    const rawOp = String(operatorOrValue).toLowerCase().trim();
    const opKey = OP_MAP[rawOp] ?? '$eq';
    const existing =
      typeof target[column] === 'object' && target[column] !== null
        ? (target[column] as any)
        : {};
    target[column] = { ...existing, [opKey]: value };
  } else {
    target[column] = operatorOrValue;
  }
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

  // Handle $not — negate the compiled sub-conditions
  if (where.$not && typeof where.$not === 'object') {
    const notList = compileWhereConditions(where.$not, params);
    if (notList.length > 0) {
      clauses.push(`NOT (${notList.join(' AND ')})`);
    }
  }

  // Handle regular column conditions
  for (const [col, val] of Object.entries(where)) {
    if (col === '$or' || col === '$and' || col === '$not') continue;
    const safeCol = formatColumnIdentifier(col);
    const clause = compileComparison(safeCol, val, params);
    if (clause) {
      clauses.push(clause);
    }
  }

  return clauses;
}

/**
 * Batch-loads declared relationships or explicit WithRelationSpec entries for hydrated rows.
 */
async function preloadRelations(
  client: ClientLike,
  parentTable: string,
  rows: any[],
  relations: Array<string | WithRelationSpec>,
  includeDeleted: boolean,
): Promise<void> {
  if (!rows || rows.length === 0 || relations.length === 0) return;

  const rootClient: any = 'parent' in client ? (client as any).parent : client;
  const declaredRels: Array<{
    table: string;
    foreignKey: string;
    references: string;
  }> = rootClient?.relationships ?? [];
  const defaultPk: string = rootClient?.primaryKey ?? 'id';

  for (const relInput of relations) {
    const spec: WithRelationSpec =
      typeof relInput === 'string' ? { table: relInput } : relInput;

    let relType = spec.type;
    let targetTable = spec.table;
    let foreignKey = spec.foreignKey;
    let localKey = spec.localKey ?? defaultPk;
    const propName = spec.as ?? spec.table;

    if (!relType || !foreignKey) {
      // 1) Check hasMany: child.references === parentTable && child.table === targetTable
      const hasManyMatch = declaredRels.find(
        (r) => r.references === parentTable && r.table === targetTable,
      );
      if (hasManyMatch) {
        relType = relType ?? 'hasMany';
        foreignKey = foreignKey ?? hasManyMatch.foreignKey;
      } else {
        // 2) Check belongsTo: parentTable.references === targetTable (or singular/plural match)
        const belongsToMatch = declaredRels.find(
          (r) =>
            r.table === parentTable &&
            (r.references === targetTable ||
              r.references === `${targetTable}s` ||
              r.foreignKey === `${targetTable}_id`),
        );
        if (belongsToMatch) {
          relType = relType ?? 'belongsTo';
          targetTable = belongsToMatch.references;
          foreignKey = foreignKey ?? belongsToMatch.foreignKey;
        }
      }
    }

    if (!relType || !foreignKey) {
      throw new Error(
        `Cannot resolve relation "${propName}" from "${parentTable}". Declare it in client relationships or pass an explicit WithRelationSpec.`,
      );
    }

    if (relType === 'hasMany') {
      const parentKeys = Array.from(
        new Set(
          rows
            .map((r) => r?.[localKey])
            .filter((v) => v !== null && v !== undefined),
        ),
      );
      if (parentKeys.length === 0) {
        for (const r of rows) r[propName] = [];
        continue;
      }
      const qb = new QueryBuilder(client, targetTable)
        .where({ [foreignKey]: { $in: parentKeys } })
        .withDeleted(includeDeleted);
      if (spec.where) qb.where(spec.where);
      const children = await qb.execute();
      const grouped = new Map<any, any[]>();
      for (const child of children) {
        const fkVal = child?.[foreignKey];
        let bucket = grouped.get(fkVal);
        if (!bucket) {
          bucket = [];
          grouped.set(fkVal, bucket);
        }
        bucket.push(child);
      }
      for (const r of rows) {
        r[propName] = grouped.get(r?.[localKey]) ?? [];
      }
    } else {
      // belongsTo
      const fkValues = Array.from(
        new Set(
          rows
            .map((r) => r?.[foreignKey])
            .filter((v) => v !== null && v !== undefined),
        ),
      );
      if (fkValues.length === 0) {
        for (const r of rows) r[propName] = null;
        continue;
      }
      const qb = new QueryBuilder(client, targetTable)
        .where({ [localKey]: { $in: fkValues } })
        .withDeleted(includeDeleted);
      if (spec.where) qb.where(spec.where);
      const parents = await qb.execute();
      const byKey = new Map<any, any>();
      for (const p of parents) {
        byKey.set(p?.[localKey], p);
      }
      for (const r of rows) {
        r[propName] = byKey.get(r?.[foreignKey]) ?? null;
      }
    }
  }
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
  private isDistinct: boolean = false;
  private joins: JoinDefinition[] = [];
  private whereConditions: Record<string, any> = {};
  private havingConditions: Record<string, any> = {};
  private withRelations: Array<string | WithRelationSpec> = [];
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
   * Adds DISTINCT to the SELECT projection.
   */
  distinct(enabled: boolean = true): this {
    this.isDistinct = enabled;
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
      mergeWhereOperator(
        this.whereConditions,
        columnOrFilter,
        operatorOrValue,
        value,
      );
    } else if (columnOrFilter && typeof columnOrFilter === 'object') {
      this.whereConditions = { ...this.whereConditions, ...columnOrFilter };
    }
    return this;
  }

  /**
   * Adds a negated WHERE condition ($not). Multiple calls are combined with $and.
   */
  whereNot(filter: Record<string, any>): this {
    if (!filter || typeof filter !== 'object') return this;
    if (this.whereConditions.$not === undefined) {
      this.whereConditions.$not = filter;
    } else {
      const existing = Array.isArray(this.whereConditions.$and)
        ? this.whereConditions.$and
        : [];
      this.whereConditions.$and = [...existing, { $not: filter }];
    }
    return this;
  }

  /**
   * Adds an OR group of filter objects to the WHERE clause.
   */
  orWhere(...filters: Record<string, any>[]): this {
    const valid = filters.filter((f) => f && typeof f === 'object');
    if (valid.length === 0) return this;
    if (Array.isArray(this.whereConditions.$or)) {
      const existing = Array.isArray(this.whereConditions.$and)
        ? this.whereConditions.$and
        : [];
      this.whereConditions.$and = [...existing, { $or: valid }];
    } else {
      this.whereConditions.$or = valid;
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
   * Adds HAVING criteria to filter grouped aggregation results.
   */
  having(
    columnOrFilter: string | Record<string, any>,
    operatorOrValue?: any,
    value?: any,
  ): this {
    if (typeof columnOrFilter === 'string') {
      mergeWhereOperator(
        this.havingConditions,
        columnOrFilter,
        operatorOrValue,
        value,
      );
    } else if (columnOrFilter && typeof columnOrFilter === 'object') {
      this.havingConditions = { ...this.havingConditions, ...columnOrFilter };
    }
    return this;
  }

  /**
   * Eagerly preloads related records from declared client relationships or explicit relation specs.
   */
  with(...relations: Array<string | WithRelationSpec>): this {
    this.withRelations.push(...relations);
    return this;
  }

  /**
   * Returns a shallow-cloned QueryBuilder with independent mutable state.
   */
  clone(): QueryBuilder<T> {
    const copy = new QueryBuilder<T>(this.client, this.tableName);
    copy.selectCols = [...this.selectCols];
    copy.isDistinct = this.isDistinct;
    copy.joins = this.joins.map((j) => ({ ...j }));
    copy.whereConditions = { ...this.whereConditions };
    copy.havingConditions = { ...this.havingConditions };
    copy.withRelations = [...this.withRelations];
    copy.orderColumn = this.orderColumn;
    copy.orderDirection = this.orderDirection;
    copy.limitCount = this.limitCount;
    copy.offsetCount = this.offsetCount;
    copy.groupByCols = [...this.groupByCols];
    copy.includeDeleted = this.includeDeleted;
    return copy;
  }

  /**
   * Compiles the query once into a reusable PreparedQuery handle.
   */
  prepare(): PreparedQuery<T> {
    const { sql, params } = this.toSQL();
    const client = this.client;
    const tableName = this.tableName;
    const withRelations = [...this.withRelations];
    const includeDeleted = this.includeDeleted;

    const run = async (overrideParams?: any[]): Promise<T[]> => {
      const effectiveParams = overrideParams ?? params;
      const rawRows = await client.query<T>(sql, effectiveParams);
      const hydrator =
        'hydrateRow' in client
          ? (client as any).hydrateRow.bind(client)
          : (client as any).parent?.hydrateRow?.bind((client as any).parent);
      const hydrated =
        hydrator && rawRows && rawRows.length > 0
          ? rawRows.map((r: any) => hydrator(tableName, r))
          : rawRows;
      if (withRelations.length > 0 && hydrated.length > 0) {
        await preloadRelations(
          client,
          tableName,
          hydrated,
          withRelations,
          includeDeleted,
        );
      }
      return hydrated;
    };

    return {
      sql,
      params,
      execute: run,
      async first(overrideParams?: any[]): Promise<T | null> {
        const rows = await run(overrideParams);
        return rows.length > 0 ? rows[0] : null;
      },
    };
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
    let sql = `SELECT ${this.isDistinct ? 'DISTINCT ' : ''}${projections} FROM ${fromTable}`;

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

    // HAVING
    if (
      this.havingConditions &&
      Object.keys(this.havingConditions).length > 0
    ) {
      const havingClauses = compileWhereConditions(
        this.havingConditions,
        params,
      );
      if (havingClauses.length > 0) {
        sql += ` HAVING ${havingClauses.join(' AND ')}`;
      }
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
      const hydrated =
        hydrator && rawRows && rawRows.length > 0
          ? rawRows.map((r: any) => hydrator(this.tableName, r))
          : rawRows;
      if (this.withRelations.length > 0 && hydrated && hydrated.length > 0) {
        await preloadRelations(
          this.client,
          this.tableName,
          hydrated,
          this.withRelations,
          this.includeDeleted,
        );
      }
      return hydrated;
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
    const originalWith = this.withRelations;
    this.selectCols = ['COUNT(*) AS _count'];
    this.withRelations = [];
    try {
      const rows = await this.execute();
      const countVal = (rows[0] as any)?._count;
      return typeof countVal === 'number' ? countVal : Number(countVal) || 0;
    } finally {
      this.selectCols = originalSelect;
      this.withRelations = originalWith;
    }
  }

  /**
   * Executes a SUM(column) in SQLite and returns the numeric total directly.
   */
  async sum(column: string): Promise<number> {
    const originalSelect = this.selectCols;
    const originalWith = this.withRelations;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`COALESCE(SUM(${safeCol}), 0) AS _sum`];
    this.withRelations = [];
    try {
      const rows = await this.execute();
      const sumVal = (rows[0] as any)?._sum;
      return typeof sumVal === 'number' ? sumVal : Number(sumVal) || 0;
    } finally {
      this.selectCols = originalSelect;
      this.withRelations = originalWith;
    }
  }

  /**
   * Executes an AVG(column) in SQLite and returns the average directly.
   */
  async avg(column: string): Promise<number | null> {
    const originalSelect = this.selectCols;
    const originalWith = this.withRelations;
    const safeCol = formatColumnIdentifier(column);
    this.selectCols = [`AVG(${safeCol}) AS _avg`];
    this.withRelations = [];
    try {
      const rows = await this.execute();
      const avgVal = (rows[0] as any)?._avg;
      return avgVal === null || avgVal === undefined
        ? null
        : Number(avgVal) || 0;
    } finally {
      this.selectCols = originalSelect;
      this.withRelations = originalWith;
    }
  }
}
