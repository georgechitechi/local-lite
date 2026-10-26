import { useState, useEffect, useCallback } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { SessionRecord, CreateSessionOptions } from '../auth/session.js';

export interface UseSessionResult<TUser = any> {
  session: SessionRecord<TUser> | null;
  user: TUser | null;
  isAuthenticated: boolean;
  isOffline: boolean;
  loading: boolean;
  createSession: (options: CreateSessionOptions<TUser>) => Promise<SessionRecord<TUser>>;
  updateUser: (partialUser: Partial<TUser>) => Promise<SessionRecord<TUser> | null>;
  updateTokens: (tokens: {
    token?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refetchSession: () => Promise<SessionRecord<TUser> | null>;
}

/**
 * Reactive React hook for persistent, offline-first user session management.
 * The session remains authenticated even when offline, ensuring uninterrupted UX.
 *
 * Example:
 * const { user, isAuthenticated, isOffline, signOut } = useSession(client);
 */
export function useSession<TUser = any>(
  client: LocalFirstClient | null | undefined
): UseSessionResult<TUser> {
  const [session, setSession] = useState<SessionRecord<TUser> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isOffline, setIsOffline] = useState<boolean>(false);

  const loadSession = useCallback(async () => {
    if (!client) {
      setSession(null);
      setLoading(false);
      return null;
    }

    try {
      const active = await client.session.getActiveSession<TUser>();
      setSession(active);
      return active;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client) {
      setSession(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Check network
    const checkNetwork = () => {
      const net = (client as any).syncWorker?.networkStatusProvider;
      if (net && typeof net.isOnline === 'function') {
        const res = net.isOnline();
        if (typeof res === 'boolean') {
          if (isMounted) setIsOffline(!res);
        } else if (res && typeof res.then === 'function') {
          res.then((online: boolean) => {
            if (isMounted) setIsOffline(!online);
          });
        }
      }
    };

    checkNetwork();
    loadSession();

    // Listen to session changes
    const unsubscribeSession = client.events.on('_local_sessions', () => {
      if (isMounted) {
        loadSession();
      }
    });

    // Listen to network changes if available
    const unsubscribeNetwork = client.events.on('network', (status: any) => {
      if (isMounted && status && typeof status.online === 'boolean') {
        setIsOffline(!status.online);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeSession();
      if (typeof unsubscribeNetwork === 'function') {
        unsubscribeNetwork();
      }
    };
  }, [client, loadSession]);

  const createSession = useCallback(
    async (options: CreateSessionOptions<TUser>) => {
      if (!client) throw new Error('Client not provided to useSession.');
      const res = await client.session.createSession<TUser>(options);
      setSession(res);
      return res;
    },
    [client]
  );

  const updateUser = useCallback(
    async (partialUser: Partial<TUser>) => {
      if (!client) return null;
      const res = await client.session.updateUser<TUser>(partialUser);
      setSession(res);
      return res;
    },
    [client]
  );

  const updateTokens = useCallback(
    async (tokens: {
      token?: string | null;
      refreshToken?: string | null;
      expiresAt?: number | null;
    }) => {
      if (!client) return;
      await client.session.updateTokens(tokens);
      await loadSession();
    },
    [client, loadSession]
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.session.clearSession();
    setSession(null);
  }, [client]);

  return {
    session,
    user: session ? session.user : null,
    isAuthenticated: session !== null,
    isOffline,
    loading,
    createSession,
    updateUser,
    updateTokens,
    signOut,
    refetchSession: loadSession,
  };
}
