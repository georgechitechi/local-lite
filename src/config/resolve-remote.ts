import { RemoteDBAdapter } from '../adapters/remote/index.js';
import { SupabaseRemoteAdapter } from '../adapters/remote/supabase.js';
import { ConvexRemoteAdapter } from '../adapters/remote/convex.js';
import { FirestoreRemoteAdapter } from '../adapters/remote/firestore.js';
import { MemoryDemoRemoteAdapter } from '../adapters/remote/demo.js';
import { LocalLiteConfig } from './types.js';

/**
 * Resolves or instantiates the appropriate RemoteDBAdapter based on the provided configuration.
 * Supports Supabase, Convex, Firebase / Firestore, in-memory demo adapter, or custom adapters.
 */
export async function resolveRemoteAdapter(config: LocalLiteConfig): Promise<RemoteDBAdapter> {
  // 1. Explicit custom remote adapter
  if (config.remote) {
    return config.remote;
  }

  // 2. Firebase / Cloud Firestore
  if (config.firebase?.firestore) {
    return new FirestoreRemoteAdapter(config.firebase.firestore, {
      tables: config.tables,
      primaryKey: config.firebase.primaryKey ?? config.primaryKey,
      deletedColumn: config.firebase.deletedColumn,
      updatedAtColumn: config.firebase.updatedAtColumn,
      firestoreModule: config.firebase.firestoreModule,
    });
  }

  // 3. Convex
  if (config.convex?.client) {
    return new ConvexRemoteAdapter(config.convex.client, {
      tables: config.tables,
      primaryKey: config.convex.primaryKey ?? config.primaryKey,
      pushMutation: config.convex.pushMutation,
      pullQuery: config.convex.pullQuery,
      deletedColumn: config.convex.deletedColumn,
      updatedAtColumn: config.convex.updatedAtColumn,
    });
  }

  // 4. Supabase with pre-configured client
  if (config.supabase?.client) {
    return new SupabaseRemoteAdapter(config.supabase.client, {
      tables: config.tables,
      primaryKey: config.primaryKey,
      schema: config.supabase.schema,
      updatedAtColumn: config.supabase.updatedAtColumn,
      deletedColumn: config.supabase.deletedColumn,
      deletedValue: config.supabase.deletedValue,
      deletedAtColumn: config.supabase.deletedAtColumn,
      pushRpcName: config.supabase.pushRpcName,
      channelName: config.supabase.channelName,
    });
  }

  // 5. Supabase with URL + anonKey (lazy dynamic import)
  if (config.supabase?.url && config.supabase?.anonKey) {
    let supabaseModule: any;
    try {
      // @ts-ignore
      supabaseModule = await import('@supabase/supabase-js');
    } catch {
      throw new Error(
        'To initialize Supabase from url and anonKey, please install @supabase/supabase-js or provide a pre-configured client to config.supabase.client'
      );
    }
    const createClientFn = supabaseModule.createClient || supabaseModule.default?.createClient;
    const supabaseClient = createClientFn(config.supabase.url, config.supabase.anonKey);
    return new SupabaseRemoteAdapter(supabaseClient, {
      tables: config.tables,
      primaryKey: config.primaryKey,
      schema: config.supabase.schema,
      updatedAtColumn: config.supabase.updatedAtColumn,
      deletedColumn: config.supabase.deletedColumn,
      deletedValue: config.supabase.deletedValue,
      deletedAtColumn: config.supabase.deletedAtColumn,
      pushRpcName: config.supabase.pushRpcName,
      channelName: config.supabase.channelName,
    });
  }

  // 6. In-Memory Simulated Remote (Default when no cloud credentials provided)
  if (config.inMemoryRemote !== false) {
    return new MemoryDemoRemoteAdapter(300);
  }

  throw new Error(
    'No remote adapter configured. Please specify config.supabase, config.convex, config.firebase, or config.remote.'
  );
}
