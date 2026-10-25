import { AccessGuard } from './guard.js';

/**
 * Wraps a LocalFirstClient with an AccessGuard.
 * Intercepts CRUD queries and mutations, asserting permissions before writes and
 * filtering unauthorized rows or restricted fields on reads.
 */
export function withAccess<T extends { [key: string]: any }>(client: T, guard: AccessGuard): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'insert') {
        return async (
          tableName: string,
          rowIdOrPayload: string | Record<string, any>,
          payloadOrOptions?: Record<string, any> | any,
          options?: any
        ) => {
          const payload =
            typeof rowIdOrPayload === 'string'
              ? (payloadOrOptions as Record<string, any>) || {}
              : rowIdOrPayload || {};

          guard.assertCan('create', tableName, payload);
          return target.insert(tableName, rowIdOrPayload, payloadOrOptions, options);
        };
      }

      if (prop === 'update') {
        return async (
          tableName: string,
          rowId: string,
          payload: Record<string, any>,
          options?: any
        ) => {
          guard.assertCan('update', tableName, { id: rowId, ...payload });
          return target.update(tableName, rowId, payload, options);
        };
      }

      if (prop === 'delete') {
        return async (tableName: string, rowId: string, options?: any) => {
          guard.assertCan('delete', tableName, { id: rowId });
          return target.delete(tableName, rowId, options);
        };
      }

      if (prop === 'findById') {
        return async (tableName: string, id: string, options?: any) => {
          const record = await target.findById(tableName, id, options);
          if (!record) return null;
          if (!guard.can('read', tableName, record)) {
            return null;
          }
          return guard.filterAllowedFields('read', tableName, record, record);
        };
      }

      if (prop === 'findMany') {
        return async (tableName: string, options?: any) => {
          const records = await target.findMany(tableName, options);
          return guard.filterRows('read', tableName, records);
        };
      }

      if (prop === 'accessGuard') {
        return guard;
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}
