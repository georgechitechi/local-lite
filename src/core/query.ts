import { ComparisonOperator, FieldFilter, QueryOptions, WhereFilter } from './types.js';

/**
 * Checks whether a single field value matches a field filter condition.
 */
export function matchesField(fieldValue: any, filter: FieldFilter): boolean {
  if (filter === undefined) return true;

  if (typeof filter === 'function') {
    return filter(fieldValue);
  }

  // Direct primitive / reference equality
  if (filter === null || typeof filter !== 'object') {
    return fieldValue === filter;
  }

  // Operator object: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $contains, etc.
  const ops = filter as ComparisonOperator;

  if (ops.$eq !== undefined && fieldValue !== ops.$eq) {
    return false;
  }

  if (ops.$ne !== undefined && fieldValue === ops.$ne) {
    return false;
  }

  if (ops.$in !== undefined) {
    if (!Array.isArray(ops.$in) || !ops.$in.includes(fieldValue)) {
      return false;
    }
  }

  if (ops.$nin !== undefined) {
    if (Array.isArray(ops.$nin) && ops.$nin.includes(fieldValue)) {
      return false;
    }
  }

  if (ops.$gt !== undefined && !(fieldValue > ops.$gt)) {
    return false;
  }

  if (ops.$gte !== undefined && !(fieldValue >= ops.$gte)) {
    return false;
  }

  if (ops.$lt !== undefined && !(fieldValue < ops.$lt)) {
    return false;
  }

  if (ops.$lte !== undefined && !(fieldValue <= ops.$lte)) {
    return false;
  }

  if (ops.$contains !== undefined || ops.$startsWith !== undefined || ops.$endsWith !== undefined) {
    const str = fieldValue == null ? '' : String(fieldValue).toLowerCase();
    if (ops.$contains !== undefined && !str.includes(String(ops.$contains).toLowerCase())) return false;
    if (ops.$startsWith !== undefined && !str.startsWith(String(ops.$startsWith).toLowerCase())) return false;
    if (ops.$endsWith !== undefined && !str.endsWith(String(ops.$endsWith).toLowerCase())) return false;
  }

  if (ops.$null !== undefined) {
    const isNull = fieldValue === null || fieldValue === undefined;
    if (ops.$null !== isNull) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether a given row matches a WhereFilter.
 */
export function matchesWhere(row: Record<string, any>, where?: WhereFilter): boolean {
  if (!where) return true;

  if (typeof where === 'function') {
    return where(row);
  }

  // Handle $or combinator
  if ('$or' in where && Array.isArray(where.$or)) {
    const orMatches = where.$or.some((subWhere) => matchesWhere(row, subWhere));
    if (!orMatches) return false;
  }

  // Handle $and combinator
  if ('$and' in where && Array.isArray(where.$and)) {
    const andMatches = where.$and.every((subWhere) => matchesWhere(row, subWhere));
    if (!andMatches) return false;
  }

  // Field-level conditions
  for (const [key, filter] of Object.entries(where)) {
    if (key === '$or' || key === '$and') continue;
    if (!matchesField(row[key], filter)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks whether a row is considered soft-deleted.
 */
export function isDeletedRecord(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const d = row.deleted;
  return d === 1 || d === true || d === '1' || d === 'true';
}

/**
 * Checks if a where filter explicitly specifies a condition on the 'deleted' column.
 */
export function hasExplicitDeletedFilter(where?: WhereFilter): boolean {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false;
  return 'deleted' in where;
}

/**
 * Applies in-memory filtering, sorting, offset, and limit to an array of rows.
 */
export function applyQueryOptions<T = any>(rows: T[], options?: QueryOptions): T[] {
  if (!rows || rows.length === 0) return [];

  const needsDeleteFilter = !options?.includeDeleted && !hasExplicitDeletedFilter(options?.where);
  const needsWhere = Boolean(options?.where);
  const needsSort = Boolean(options?.orderBy);
  const needsSlice = (options?.offset !== undefined && options.offset > 0) ||
                     (options?.limit !== undefined && options.limit > 0);
  const needsSelect = Array.isArray(options?.select) && (options!.select as string[]).length > 0;

  // Fast-path: nothing to do
  if (!needsDeleteFilter && !needsWhere && !needsSort && !needsSlice && !needsSelect) {
    return rows;
  }

  let result = rows as any[];

  // 0. Soft-delete filtering
  if (needsDeleteFilter) {
    result = result.filter((row: any) => !isDeletedRecord(row));
  }

  // 1. Where filtering
  if (needsWhere) {
    result = result.filter((row: any) => matchesWhere(row, options!.where));
  }

  // 2. Order by
  if (needsSort) {
    result = [...result]; // copy only before sort mutation
    const key = options!.orderBy!;
    const isAsc = (options!.order || 'asc').toLowerCase() === 'asc';
    result.sort((a: any, b: any) => {
      const valA = a[key];
      const valB = b[key];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return isAsc ? 1 : -1;
      if (valB === null || valB === undefined) return isAsc ? -1 : 1;
      if (typeof valA === 'string' && typeof valB === 'string') {
        return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return isAsc ? valA - valB : valB - valA;
      }
      return isAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });
  }

  // 3. Offset and Limit
  if (needsSlice) {
    const offset = options?.offset && options.offset > 0 ? options.offset : 0;
    const limit = options?.limit && options.limit > 0 ? options.limit : undefined;
    result = limit !== undefined ? result.slice(offset, offset + limit) : result.slice(offset);
  }

  // 4. Column projection
  if (needsSelect) {
    const fields = options!.select as string[];
    result = result.map((row: any) => {
      const projected: Record<string, any> = {};
      for (const field of fields) {
        if (field in row) projected[field] = row[field];
      }
      return projected as any;
    });
  }

  return result;
}
