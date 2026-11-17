import type { LocalFirstClient } from '../core/client.js';
import type { QueryBuilder } from '../core/query-builder.js';
import type { QueryOptions, WhereFilter } from '../core/types.js';

export type ColumnTypeTag =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'string?'
  | 'number?'
  | 'boolean?'
  | 'json?';

export type InferColumnType<T extends ColumnTypeTag> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'json'
        ? Record<string, any> | any[]
        : T extends 'string?'
          ? string | null
          : T extends 'number?'
            ? number | null
            : T extends 'boolean?'
              ? boolean | null
              : T extends 'json?'
                ? Record<string, any> | any[] | null
                : unknown;

export type SchemaDefinition = Record<string, Record<string, ColumnTypeTag>>;

export type InferTableRow<TCols extends Record<string, ColumnTypeTag>> = {
  [K in keyof TCols]: InferColumnType<TCols[K]>;
};

export type InferSchema<TSchema extends SchemaDefinition> = {
  [T in keyof TSchema]: InferTableRow<TSchema[T]>;
};

/**
 * Defines a declarative schema dictionary for compile-time TypeScript row inference.
 */
export function defineTypedSchema<TSchema extends SchemaDefinition>(
  schema: TSchema,
): TSchema {
  return schema;
}

export interface TypedQueryBuilder<TRow extends Record<string, any>> {
  select<K extends keyof TRow & string>(...columns: K[]): TypedQueryBuilder<Pick<TRow, K>>;
  where(
    filter: Partial<Record<keyof TRow & string, any>> | WhereFilter,
  ): TypedQueryBuilder<TRow>;
  orderBy(
    column: keyof TRow & string,
    direction?: 'asc' | 'desc' | 'ASC' | 'DESC',
  ): TypedQueryBuilder<TRow>;
  limit(count: number): TypedQueryBuilder<TRow>;
  offset(count: number): TypedQueryBuilder<TRow>;
  distinct(enabled?: boolean): TypedQueryBuilder<TRow>;
  execute(): Promise<TRow[]>;
  first(): Promise<TRow | null>;
  count(): Promise<number>;
}

export interface TypedLocalFirstClient<TSchema extends SchemaDefinition> {
  readonly raw: LocalFirstClient;
  from<T extends keyof TSchema & string>(
    tableName: T,
  ): TypedQueryBuilder<InferTableRow<TSchema[T]>>;
  findById<T extends keyof TSchema & string>(
    tableName: T,
    id: string,
    options?: Pick<QueryOptions, 'includeDeleted'>,
  ): Promise<InferTableRow<TSchema[T]> | null>;
  insert<T extends keyof TSchema & string>(
    tableName: T,
    payload: Partial<InferTableRow<TSchema[T]>> & Record<string, any>,
  ): Promise<string>;
  update<T extends keyof TSchema & string>(
    tableName: T,
    id: string,
    payload: Partial<InferTableRow<TSchema[T]>>,
  ): Promise<void>;
  delete<T extends keyof TSchema & string>(
    tableName: T,
    id: string,
  ): Promise<void>;
}

/**
 * Wraps a `LocalFirstClient` with strict TypeScript table and column inference derived from `defineTypedSchema()`.
 */
export function createTypedClient<TSchema extends SchemaDefinition>(
  client: LocalFirstClient,
  _schema?: TSchema,
): TypedLocalFirstClient<TSchema> {
  return {
    raw: client,
    from<T extends keyof TSchema & string>(tableName: T) {
      return client.from<InferTableRow<TSchema[T]>>(
        tableName,
      ) as unknown as TypedQueryBuilder<InferTableRow<TSchema[T]>>;
    },
    findById<T extends keyof TSchema & string>(
      tableName: T,
      id: string,
      options?: Pick<QueryOptions, 'includeDeleted'>,
    ) {
      return client.findById<InferTableRow<TSchema[T]>>(
        tableName,
        id,
        options,
      );
    },
    insert<T extends keyof TSchema & string>(
      tableName: T,
      payload: Partial<InferTableRow<TSchema[T]>> & Record<string, any>,
    ): Promise<string> {
      return client.insert(tableName, payload);
    },
    update<T extends keyof TSchema & string>(
      tableName: T,
      id: string,
      payload: Partial<InferTableRow<TSchema[T]>>,
    ): Promise<void> {
      return client.update(tableName, id, payload);
    },
    async delete<T extends keyof TSchema & string>(
      tableName: T,
      id: string,
    ): Promise<void> {
      await client.delete(tableName, id);
    },
  };
}
