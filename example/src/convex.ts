import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { ConvexRemoteAdapter } from 'local-lite/convex';

export const rentalTables = ['properties', 'tenants', 'maintenance_requests', 'payments'];
export const syncApi = anyApi.sync;
let client: ConvexClient | undefined;
export function getConvexClient(): ConvexClient {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Set EXPO_PUBLIC_CONVEX_URL in example/.env.local and restart Expo.');
  return client ??= new ConvexClient(url);
}
export function getConvexRemote(): ConvexRemoteAdapter {
  return new ConvexRemoteAdapter(getConvexClient(), {
    tables: rentalTables, pushMutation: syncApi.pushBatch, pullQuery: syncApi.pullDeltas,
  });
}
