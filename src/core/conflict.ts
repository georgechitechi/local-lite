import { ConflictContext, ConflictResolution, ConflictResolver, ConflictStrategy } from './types.js';

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
    case 'last-write-wins':
    default:
      return lastWriteWinsResolver;
  }
}
