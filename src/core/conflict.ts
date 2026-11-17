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

export const lastWriteWinsResolver: ConflictResolver = (
  context: ConflictContext,
): ConflictResolution => {
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

export const clientWinsResolver: ConflictResolver = (
  context: ConflictContext,
): ConflictResolution => {
  if (context.localOutboxRecord) {
    return 'keep-local';
  }
  return 'apply-remote';
};

export interface PNCounterState {
  p: Record<string, number>;
  n: Record<string, number>;
}

/**
 * Merges two distributed PN-Counter states by taking the element-wise max of positive and negative vectors.
 */
export function mergePNCounter(
  a: PNCounterState | null | undefined,
  b: PNCounterState | null | undefined,
): PNCounterState {
  const p: Record<string, number> = { ...(a?.p ?? {}) };
  const n: Record<string, number> = { ...(a?.n ?? {}) };
  for (const [k, v] of Object.entries(b?.p ?? {})) {
    p[k] = Math.max(p[k] ?? 0, v);
  }
  for (const [k, v] of Object.entries(b?.n ?? {})) {
    n[k] = Math.max(n[k] ?? 0, v);
  }
  return { p, n };
}

/**
 * Computes the net numeric value of a PN-Counter state.
 */
export function pnCounterValue(state: PNCounterState): number {
  const pos = Object.values(state.p).reduce((acc, v) => acc + v, 0);
  const neg = Object.values(state.n).reduce((acc, v) => acc + v, 0);
  return pos - neg;
}

export interface LWWElementSetState {
  add: Record<string, number>;
  remove: Record<string, number>;
}

/**
 * Merges two LWW-Element-Set states by taking the max timestamp for each add/remove entry.
 */
export function mergeLWWElementSet(
  a: LWWElementSetState | null | undefined,
  b: LWWElementSetState | null | undefined,
): LWWElementSetState {
  const add: Record<string, number> = { ...(a?.add ?? {}) };
  const remove: Record<string, number> = { ...(a?.remove ?? {}) };
  for (const [k, ts] of Object.entries(b?.add ?? {})) {
    add[k] = Math.max(add[k] ?? 0, ts);
  }
  for (const [k, ts] of Object.entries(b?.remove ?? {})) {
    remove[k] = Math.max(remove[k] ?? 0, ts);
  }
  return { add, remove };
}

/**
 * Returns the active elements of an LWW-Element-Set (add timestamp >= remove timestamp).
 */
export function lwwElementSetValues(state: LWWElementSetState): string[] {
  const result: string[] = [];
  for (const [item, addTs] of Object.entries(state.add)) {
    const remTs = state.remove[item] ?? -1;
    if (addTs >= remTs) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Creates a smart 3-way field-level conflict resolver.
 * Merges disjoint fields from both local and remote offline mutations,
 * and resolves overlapping field changes using custom rules, timestamps, or winner strategies.
 */
export function createFieldMergeResolver(
  options: FieldMergeResolverOptions = {},
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
      } else if (rule === 'set-union') {
        const remoteArr = Array.isArray(remoteVal) ? remoteVal : [];
        const localArr = Array.isArray(localVal) ? localVal : [];
        merged[key] = Array.from(new Set([...remoteArr, ...localArr]));
      } else if (rule === 'pn-counter') {
        if (
          typeof localVal === 'object' &&
          localVal !== null &&
          'p' in localVal &&
          typeof remoteVal === 'object' &&
          remoteVal !== null &&
          'p' in remoteVal
        ) {
          merged[key] = mergePNCounter(localVal, remoteVal);
        } else {
          const baseNum = typeof baseRow[key] === 'number' ? baseRow[key] : 0;
          const localDelta = (Number(localVal) || 0) - baseNum;
          const remoteDelta = (Number(remoteVal) || 0) - baseNum;
          merged[key] = baseNum + localDelta + remoteDelta;
        }
      } else if (rule === 'lww-element-set') {
        merged[key] = mergeLWWElementSet(localVal, remoteVal);
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
  strategyOrResolver?: ConflictStrategy | ConflictResolver,
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
