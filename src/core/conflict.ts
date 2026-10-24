import {
  ConflictContext,
  ConflictResolution,
  ConflictResolver,
  ConflictStrategy,
  FieldMergeResolverOptions,
} from './types.js';

export type {
  ConflictContext,
  ConflictResolution,
  ConflictResolver,
  ConflictStrategy,
  FieldMergeResolverOptions,
};


export const lastWriteWinsResolver: ConflictResolver = (context: ConflictContext): ConflictResolution => {
  const remoteTime = context.remoteChange.timestamp ?? 0;
  const localTime = context.localOutboxRecord?.timestamp ?? 0;

  if (remoteTime >= localTime) {
    return 'apply-remote';
  }
  return 'keep-local';
};

export const serverWinsResolver: ConflictResolver = (): ConflictResolution => {
  return 'apply-remote';
};

export const clientWinsResolver: ConflictResolver = (context: ConflictContext): ConflictResolution => {
  if (context.localOutboxRecord) {
    return 'keep-local';
  }
  return 'apply-remote';
};

/**
 * Creates a smart 3-way field-level conflict resolver.
 * Merges disjoint fields from both local and remote offline mutations,
 * and resolves overlapping field changes using custom rules, timestamps, or winner strategies.
 */
export function createFieldMergeResolver(
  options: FieldMergeResolverOptions = {}
): ConflictResolver {
  const defaultWinner = options.defaultWinner ?? 'newer';
  const deleteHandling = options.deleteHandling ?? 'delete-wins';
  const fieldRules = options.fieldRules ?? {};

  return (context: ConflictContext): ConflictResolution => {
    const isRemoteDelete = context.remoteChange.operation === 'DELETE';
    const isLocalDelete = context.localOutboxRecord?.operation === 'DELETE';

    if (isRemoteDelete && isLocalDelete) {
      return 'apply-remote';
    }

    if (isRemoteDelete && !isLocalDelete) {
      return deleteHandling === 'update-wins' ? 'keep-local' : 'apply-remote';
    }

    if (isLocalDelete && !isRemoteDelete) {
      return deleteHandling === 'update-wins' ? 'apply-remote' : 'keep-local';
    }

    // Both are non-delete operations (INSERT / UPDATE)
    const baseRow = context.localRow ?? {};
    const remotePayload = context.remoteChange.payload ?? {};
    const localPayload = context.localOutboxRecord?.payload ?? {};

    const merged: Record<string, any> = { ...baseRow, ...remotePayload };

    const tableRules = fieldRules[context.tableName] ?? {};
    const wildcardRules = fieldRules['*'] ?? {};

    const localTime = context.localOutboxRecord?.timestamp ?? 0;
    const remoteTime = context.remoteChange.timestamp ?? 0;

    for (const key of Object.keys(localPayload)) {
      if (!(key in remotePayload)) {
        // Field only changed locally: preserve local modification
        merged[key] = localPayload[key];
        continue;
      }

      // Field was modified by BOTH local and remote: resolve conflict
      const rule = tableRules[key] ?? wildcardRules[key];
      const localVal = localPayload[key];
      const remoteVal = remotePayload[key];

      if (typeof rule === 'function') {
        merged[key] = rule(localVal, remoteVal, context);
      } else if (rule === 'max') {
        merged[key] = localVal >= remoteVal ? localVal : remoteVal;
      } else if (rule === 'min') {
        merged[key] = localVal <= remoteVal ? localVal : remoteVal;
      } else if (rule === 'local') {
        merged[key] = localVal;
      } else if (rule === 'remote') {
        merged[key] = remoteVal;
      } else {
        const winner = rule === 'newer' ? 'newer' : defaultWinner;
        if (winner === 'local') {
          merged[key] = localVal;
        } else if (winner === 'remote') {
          merged[key] = remoteVal;
        } else {
          // 'newer': compare timestamp
          merged[key] = localTime >= remoteTime ? localVal : remoteVal;
        }
      }
    }

    return { mergePayload: merged };
  };
}

export function getConflictResolver(
  strategyOrResolver?: ConflictStrategy | ConflictResolver
): ConflictResolver {
  if (typeof strategyOrResolver === 'function') {
    return strategyOrResolver;
  }

  switch (strategyOrResolver) {
    case 'server-wins':
      return serverWinsResolver;
    case 'client-wins':
      return clientWinsResolver;
    case 'field-merge':
      return createFieldMergeResolver();
    case 'last-write-wins':
    default:
      return lastWriteWinsResolver;
  }
}

