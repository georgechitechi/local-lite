import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secureStorage } from '@/shared/services/secureStorage';
import type { Database } from '@/shared/types/database.types';

export interface CloudSyncState {
  isEnabled: boolean;
  isInitializing: boolean;
  wasEverConfigured: boolean;
  isLocalMode: boolean;
}

export interface AuthStateSync {
  isLoggedIn: boolean;
}

let currentCloudSyncState: CloudSyncState = {
  isEnabled: false,
  isInitializing: true,
  wasEverConfigured: false,
  isLocalMode: false,
};

let currentAuthStateSync: AuthStateSync = {
  isLoggedIn: false,
};

const cloudSyncListeners = new Set<() => void>();
const authStateListeners = new Set<() => void>();

export const subscribeCloudSyncState = (cb: () => void) => {
  cloudSyncListeners.add(cb);
  return () => {
    cloudSyncListeners.delete(cb);
  };
};

export const getCloudSyncStateSnapshot = (): CloudSyncState => currentCloudSyncState;

export const updateCloudSyncState = (patch: Partial<CloudSyncState>) => {
  currentCloudSyncState = { ...currentCloudSyncState, ...patch };
  cloudSyncListeners.forEach(cb => {
    cb();
  });
};

export const subscribeAuthStateSync = (cb: () => void) => {
  authStateListeners.add(cb);
  return () => {
    authStateListeners.delete(cb);
  };
};

export const getAuthStateSyncSnapshot = (): AuthStateSync => currentAuthStateSync;

export const updateAuthStateSync = (patch: Partial<AuthStateSync>) => {
  currentAuthStateSync = { ...currentAuthStateSync, ...patch };
  authStateListeners.forEach(cb => {
    cb();
  });
};

// The dynamic Supabase client
export let supabase = null as unknown as SupabaseClient<Database>;

// Call this on app startup
export const initializeSupabaseClient = async () => {
  try {
    updateCloudSyncState({ isInitializing: true });
    const url = (await secureStorage.getItem('supabase_custom_url')) as string | null;
    const key = (await secureStorage.getItem('supabase_custom_key')) as string | null;
    const everConfigured =
      (await secureStorage.getItem('cloud_sync_ever_configured')) === true;

    updateCloudSyncState({
      wasEverConfigured: everConfigured,
      isLocalMode: !everConfigured,
    });

    if (url && key) {
      supabase = createClient<Database>(url.trim(), key.trim(), {
        auth: {
          storage: SupabaseStorage,
          storageKey: 'supabase.auth.token',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      });
      updateCloudSyncState({ isEnabled: true });
    } else {
      supabase = null as unknown as SupabaseClient<Database>;
      updateCloudSyncState({ isEnabled: false });
    }
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabase = null as unknown as SupabaseClient<Database>;
    updateCloudSyncState({ isEnabled: false });
  } finally {
    updateCloudSyncState({ isInitializing: false });
  }
};

export const configureSupabaseClient = async (url: string, key: string) => {
  const cleanUrl = url.trim();
  const cleanKey = key.trim();

  // Wipe all potential session ghosts from the previous project
  await secureStorage.removeItem('refreshToken');
  await secureStorage.removeItem('userEmail');
  await secureStorage.removeItem('lastUser');
  await secureStorage.removeItem('biometricEnabled');
  await SupabaseStorage.removeItem('supabase.auth.token');
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }

  await secureStorage.setItem('supabase_custom_url', cleanUrl);
  await secureStorage.setItem('supabase_custom_key', cleanKey);
  await secureStorage.setItem('cloud_sync_ever_configured', true);
  await initializeSupabaseClient();
  return supabase;
};

// Call this to revert to fully offline
export const disableCloudSync = async () => {
  await secureStorage.removeItem('supabase_custom_url');
  await secureStorage.removeItem('supabase_custom_key');
  await secureStorage.removeItem('cloud_sync_ever_configured');

  // Wipe all potential session ghosts
  await secureStorage.removeItem('refreshToken');
  await secureStorage.removeItem('userEmail');
  await secureStorage.removeItem('lastUser');
  await secureStorage.removeItem('biometricEnabled');
  await SupabaseStorage.removeItem('supabase.auth.token');

  // Clear any existing session to be safe
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // Ignore errors
      console.log(`Sign out errors: ${e?.toString()}`);
    }
  }
  supabase = null as unknown as SupabaseClient<Database>;
  updateCloudSyncState({ isEnabled: false });
  updateCloudSyncState({ wasEverConfigured: false });
  updateCloudSyncState({ isLocalMode: true });
  updateAuthStateSync({ isLoggedIn: false });
};

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// This client is for server-side use in API routes (+api.ts)
// It doesn't use local storage (which is not available in Node environment)
export const serverSupabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: false,
    },
  },
);

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const SupabaseStorage = {
  getItem: (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
      return Promise.resolve();
    }
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
      return Promise.resolve();
    }
    return SecureStore.deleteItemAsync(key);
  },
};

const MGMT_API = 'https://api.supabase.com/v1';

async function mgmtRequestFetch<T>(
  method: string,
  url: string,
  pat: string,
  body?: object,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API ${method} ${url} failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Management API ${method} ${url} returned invalid JSON: ${text}`);
  }
}

export interface SupabaseProject {
  id: string;
  ref: string;
  name: string;
  region: string;
  status: string;
  created_at?: string;
  database?: {
    host?: string;
    version?: string;
  };
}

export interface ProjectApiKeys {
  publishableKey: string;
}

export async function listProjects(pat: string): Promise<SupabaseProject[]> {
  const data = await mgmtRequestFetch<any[]>('GET', `${MGMT_API}/projects`, pat);
  return data.map(p => ({
    id: p.id,
    ref: p.ref ?? p.id,
    name: p.name,
    region: p.region,
    status: p.status,
    created_at: p.created_at,
    database: p.database,
  }));
}

export async function getApiKeys(pat: string, ref: string): Promise<ProjectApiKeys> {
  const keys = await mgmtRequestFetch<any[]>(
    'GET',
    `${MGMT_API}/projects/${ref}/api-keys`,
    pat,
  );
  const publishable = keys.find(k => k.type === 'publishable')?.api_key ?? '';
  if (!publishable) throw new Error('Could not find publishable key for this project.');
  return { publishableKey: publishable };
}

export async function configureBackupReplicaSecrets(
  pat: string,
  activeRef: string,
  backupRef: string,
  userEmail?: string,
): Promise<{ userEmail?: string }> {
  const secrets = [
    { name: 'BACKUP_PROJECT_PAT', value: pat },
    { name: 'BACKUP_PROJECT_REF', value: backupRef },
  ];

  if (userEmail?.trim()) {
    secrets.push({ name: 'BACKUP_TARGET_EMAIL', value: userEmail.trim() });
  }

  await setEdgeFunctionSecrets(pat, activeRef, secrets);

  return { userEmail: userEmail?.trim() };
}

export async function removeBackupReplicaSecrets(
  pat: string,
  activeRef: string,
): Promise<void> {
  try {
    const existing = await getEdgeFunctionSecrets(pat, activeRef);
    const existingNames = new Set(existing.map(s => s.name));
    const toDelete = [
      'BACKUP_PROJECT_PAT',
      'BACKUP_PROJECT_REF',
      'BACKUP_TARGET_EMAIL',
    ].filter(name => existingNames.has(name));

    if (toDelete.length > 0) {
      await deleteEdgeFunctionSecrets(pat, activeRef, toDelete);
    }
  } catch (err: any) {
    if (err?.message?.includes('not found') || err?.message?.includes('404')) {
      return;
    }
    throw err;
  }
}

/**
 * Enables "Temporary Token-Based Database Access" (JIT) on the project.
 * Once enabled, the user's PAT can be used as the Postgres password.
 * Requires Postgres 17.6.1.081+.
 */
export async function enableJitAccess(pat: string, ref: string): Promise<void> {
  await mgmtRequestFetch('PUT', `${MGMT_API}/projects/${ref}/jit-access`, pat, {
    state: 'enabled',
  });
}

export interface MgmtMember {
  id?: string;
  gotrue_id?: string;
  user_id?: string;
  role_name: string;
  primary_email?: string;
  email?: string;
  username?: string;
}

export async function getOrganizationMembers(
  pat: string,
  ref: string,
): Promise<MgmtMember[]> {
  // Get all projects to find the organization_id for this project ref
  const projects = await mgmtRequestFetch<any[]>('GET', `${MGMT_API}/projects`, pat);
  const project = projects.find((p: any) => p.id === ref);

  if (!project?.organization_id) {
    throw new Error('Project or organization not found for this ref.');
  }

  // Fetch members for that organization
  return mgmtRequestFetch<MgmtMember[]>(
    'GET',
    `${MGMT_API}/organizations/${project.organization_id}/members`,
    pat,
  );
}

/**
 * Bulk create or update edge function secrets.
 * These secrets are injected into the environment of your Supabase Edge Functions.
 * @param pat The Personal Access Token
 * @param ref The Supabase Project Reference
 * @param secrets An array of secrets to set
 */
export async function setEdgeFunctionSecrets(
  pat: string,
  ref: string,
  secrets: { name: string; value: string }[],
): Promise<void> {
  await mgmtRequestFetch('POST', `${MGMT_API}/projects/${ref}/secrets`, pat, secrets);
}

/**
 * Delete edge function secrets by name.
 * @param pat The Personal Access Token
 * @param ref The Supabase Project Reference
 * @param secretNames Names of secrets to remove
 */
export async function deleteEdgeFunctionSecrets(
  pat: string,
  ref: string,
  secretNames: string[],
): Promise<void> {
  if (secretNames.length === 0) return;
  try {
    await mgmtRequestFetch(
      'DELETE',
      `${MGMT_API}/projects/${ref}/secrets`,
      pat,
      secretNames,
    );
  } catch (err: any) {
    if (err?.message?.includes('not found') || err?.message?.includes('404')) {
      return;
    }
    throw err;
  }
}

/**
 * Retrieve edge function secrets.
 * @param pat The Personal Access Token
 * @param ref The Supabase Project Reference
 */
export async function getEdgeFunctionSecrets(
  pat: string,
  ref: string,
): Promise<{ name: string; value: string }[]> {
  return mgmtRequestFetch<{ name: string; value: string }[]>(
    'GET',
    `${MGMT_API}/projects/${ref}/secrets`,
    pat,
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
  isPaused?: boolean;
}

/**
 * Pre-flight connection diagnostic for Supabase URL and Anon/Publishable Key.
 * Tests REST endpoint availability, measures latency, and detects paused projects.
 */
export async function testSupabaseConnection(
  rawUrl: string,
  rawKey: string,
): Promise<ConnectionTestResult> {
  const url = (rawUrl || '').trim().replace(/\/+$/, '');
  const key = (rawKey || '').trim();

  if (!url || !key) {
    return { ok: false, latencyMs: 0, error: 'URL and Key are required.' };
  }

  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'Invalid URL format (must begin with https://).',
    };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout

    // Ping PostgREST root schema endpoint
    let response = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });

    // If root endpoint returned 401 or 404 (OpenAPI docs restricted for anon on Supabase),
    // probe a standard PostgREST table endpoint to verify reachability
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      try {
        const tablePing = await fetch(`${url}/rest/v1/settings?select=id&limit=1`, {
          method: 'GET',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          signal: controller.signal,
        });
        if (
          tablePing.status === 200 ||
          tablePing.status === 204 ||
          tablePing.status === 404
        ) {
          response = tablePing;
        }
      } catch {}
    }
    clearTimeout(timer);

    const latencyMs = Date.now() - start;

    if (response.status === 503 || response.status === 521 || response.status === 523) {
      return {
        ok: false,
        latencyMs,
        statusCode: response.status,
        isPaused: true,
        error: 'Project appears to be PAUSED or temporarily offline on Supabase.',
      };
    }

    if (response.status === 401 || response.status === 403) {
      const text = await response.text();
      return {
        ok: false,
        latencyMs,
        statusCode: response.status,
        error: `Authentication failed (${response.status}): Check your Anon/Publishable key. ${text}`,
      };
    }

    // 200 OK, 204, or 404 confirms reachability
    return {
      ok: response.ok || response.status === 404 || response.status === 204,
      latencyMs,
      statusCode: response.status,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError') {
      return {
        ok: false,
        latencyMs,
        error: 'Connection timed out (10s). The database may be paused or unreachable.',
        isPaused: true,
      };
    }
    return {
      ok: false,
      latencyMs,
      error: err?.message || 'Network error: could not reach Supabase host.',
    };
  }
}
