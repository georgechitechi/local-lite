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

  if (ops.$contains !== undefined) {
    const str = fieldValue === null || fieldValue === undefined ? '' : String(fieldValue).toLowerCase();
    const search = String(ops.$contains).toLowerCase();
    if (!str.includes(search)) {
      return false;
    }
  }

  if (ops.$startsWith !== undefined) {
    const str = fieldValue === null || fieldValue === undefined ? '' : String(fieldValue).toLowerCase();
    const prefix = String(ops.$startsWith).toLowerCase();
    if (!str.startsWith(prefix)) {
      return false;
    }
  }

  if (ops.$endsWith !== undefined) {
    const str = fieldValue === null || fieldValue === undefined ? '' : String(fieldValue).toLowerCase();
    const suffix = String(ops.$endsWith).toLowerCase();
    if (!str.endsWith(suffix)) {
      return false;
    }
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
 * Applies in-memory filtering, sorting, offset, and limit to an array of rows.
 */
export function applyQueryOptions<T = any>(rows: T[], options?: QueryOptions): T[] {
  if (!rows || rows.length === 0) return [];
  let result = [...rows];

  // 1. Where filtering
  if (options?.where) {
    result = result.filter((row: any) => matchesWhere(row, options.where));
  }

  // 2. Order by
  if (options?.orderBy) {
    const key = options.orderBy;
    const isAsc = (options.order || 'asc').toLowerCase() === 'asc';
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
  if (options?.offset !== undefined && options.offset > 0) {
    result = result.slice(options.offset);
  }
  if (options?.limit !== undefined && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}
