import { useEffect, useState, useCallback } from 'react';
import type { GoogleAuthClient, GoogleUser } from '../auth/google.js';
import type { MicrosoftAuthClient, MicrosoftUser } from '../auth/microsoft.js';
import type { GitHubAuthClient, GitHubUser } from '../auth/github.js';
import type { AppleAuthClient, AppleUser, AppleNativeCredential } from '../auth/apple.js';
import type {
  LocalAuthEngine,
  LocalUser,
  SignUpOptions,
  SignInOptions,
  SignInResult,
} from '../auth/local.js';
import type { SessionRecord } from '../auth/session.js';

// ----------------------------------------------------
// Google Auth Hook
// ----------------------------------------------------

export interface UseGoogleAuthResult {
  user: GoogleUser | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<GoogleUser | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<GoogleUser | null>;
}

export function useGoogleAuth(
  client: GoogleAuthClient | null | undefined,
): UseGoogleAuthResult {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    client
      .getUser()
      .then(currentUser => {
        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    const unsubscribe = client.onAuthStateChange(updatedUser => {
      if (isMounted) {
        setUser(updatedUser);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(async () => {
    if (!client) throw new Error('GoogleAuthClient is not initialized.');
    setError(null);
    setLoading(true);
    try {
      const res = await client.signIn();
      setUser(res);
      return res;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    setError(null);
    setLoading(true);
    try {
      await client.signOut();
      setUser(null);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const refetchUser = useCallback(async () => {
    if (!client) return null;
    const res = await client.getUser();
    setUser(res);
    return res;
  }, [client]);

  return {
    user,
    isSignedIn: Boolean(user),
    loading,
    error,
    signIn,
    signOut,
    refetchUser,
  };
}

// ----------------------------------------------------
// Microsoft / OneDrive Auth Hook
// ----------------------------------------------------

export interface UseMicrosoftAuthResult {
  user: MicrosoftUser | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<MicrosoftUser | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<MicrosoftUser | null>;
}

export function useMicrosoftAuth(
  client: MicrosoftAuthClient | null | undefined,
): UseMicrosoftAuthResult {
  const [user, setUser] = useState<MicrosoftUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    client
      .getUser()
      .then(currentUser => {
        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    const unsubscribe = client.onAuthStateChange(updatedUser => {
      if (isMounted) {
        setUser(updatedUser);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(async () => {
    if (!client) throw new Error('MicrosoftAuthClient is not initialized.');
    setError(null);
    setLoading(true);
    try {
      const res = await client.signIn();
      setUser(res);
      return res;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    setError(null);
    setLoading(true);
    try {
      await client.signOut();
      setUser(null);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const refetchUser = useCallback(async () => {
    if (!client) return null;
    const res = await client.getUser();
    setUser(res);
    return res;
  }, [client]);

  return {
    user,
    isSignedIn: Boolean(user),
    loading,
    error,
    signIn,
    signOut,
    refetchUser,
  };
}

// ----------------------------------------------------
// GitHub Auth Hook
// ----------------------------------------------------

export interface UseGitHubAuthResult {
  user: GitHubUser | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<GitHubUser | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<GitHubUser | null>;
}

export function useGitHubAuth(
  client: GitHubAuthClient | null | undefined,
): UseGitHubAuthResult {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    client
      .getUser()
      .then(currentUser => {
        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    const unsubscribe = client.onAuthStateChange(updatedUser => {
      if (isMounted) {
        setUser(updatedUser);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(async () => {
    if (!client) throw new Error('GitHubAuthClient is not initialized.');
    setError(null);
    setLoading(true);
    try {
      const res = await client.signIn();
      setUser(res);
      return res;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    setError(null);
    setLoading(true);
    try {
      await client.signOut();
      setUser(null);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const refetchUser = useCallback(async () => {
    if (!client) return null;
    const res = await client.getUser();
    setUser(res);
    return res;
  }, [client]);

  return {
    user,
    isSignedIn: Boolean(user),
    loading,
    error,
    signIn,
    signOut,
    refetchUser,
  };
}

// ----------------------------------------------------
// Apple Auth Hook
// ----------------------------------------------------

export interface UseAppleAuthResult {
  user: AppleUser | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: (nativeCredential?: AppleNativeCredential) => Promise<AppleUser | null>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<AppleUser | null>;
}

export function useAppleAuth(
  client: AppleAuthClient | null | undefined,
): UseAppleAuthResult {
  const [user, setUser] = useState<AppleUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    client
      .getUser()
      .then(currentUser => {
        if (isMounted) {
          setUser(currentUser);
          setLoading(false);
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    const unsubscribe = client.onAuthStateChange(updatedUser => {
      if (isMounted) {
        setUser(updatedUser);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(
    async (nativeCredential?: AppleNativeCredential) => {
      if (!client) throw new Error('AppleAuthClient is not initialized.');
      setError(null);
      setLoading(true);
      try {
        const res = await client.signIn(nativeCredential);
        setUser(res);
        return res;
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    setError(null);
    setLoading(true);
    try {
      await client.signOut();
      setUser(null);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [client]);

  const refetchUser = useCallback(async () => {
    if (!client) return null;
    const res = await client.getUser();
    setUser(res);
    return res;
  }, [client]);

  return {
    user,
    isSignedIn: Boolean(user),
    loading,
    error,
    signIn,
    signOut,
    refetchUser,
  };
}

// ----------------------------------------------------
// Local Auth Hook
// ----------------------------------------------------

export interface UseLocalAuthResult<TMetadata = any> {
  user: LocalUser<TMetadata> | null;
  session: SessionRecord<LocalUser<TMetadata>> | null;
  isSignedIn: boolean;
  loading: boolean;
  error: Error | null;
  signIn: (
    identifier: string,
    password: string,
    options?: Omit<SignInOptions, 'identifier' | 'password'>
  ) => Promise<SignInResult<TMetadata>>;
  signUp: (options: SignUpOptions<TMetadata>) => Promise<SignInResult<TMetadata>>;
  signOut: () => Promise<void>;
  refetchUser: () => Promise<LocalUser<TMetadata> | null>;
}

/**
 * Reactive React hook for the fully local, zero-backend authentication engine.
 * Automatically synchronizes with local user state and offline sessions in SQLite.
 *
 * Example:
 * const { user, isSignedIn, signIn, signUp, signOut } = useLocalAuth(client.auth);
 */
export function useLocalAuth<TMetadata = any>(
  engine: LocalAuthEngine | null | undefined
): UseLocalAuthResult<TMetadata> {
  const [user, setUser] = useState<LocalUser<TMetadata> | null>(null);
  const [session, setSession] = useState<SessionRecord<LocalUser<TMetadata>> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshState = useCallback(async () => {
    if (!engine) {
      setUser(null);
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const sessionMgr = engine.getSessionManager();
      const currentSession = await sessionMgr.getActiveSession<LocalUser<TMetadata>>();
      setSession(currentSession);
      const currentUser = await engine.getCurrentUser<TMetadata>();
      setUser(currentUser);
      setError(null);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    refreshState();
    if (!engine) return;

    const unsub = engine.onAuthStateChange(() => {
      refreshState();
    });

    return () => {
      unsub();
    };
  }, [engine, refreshState]);

  const signIn = useCallback(
    async (
      identifier: string,
      password: string,
      options?: Omit<SignInOptions, 'identifier' | 'password'>
    ) => {
      if (!engine) throw new Error('LocalAuthEngine is not initialized.');
      setError(null);
      setLoading(true);
      try {
        const result = await engine.signIn<TMetadata>({
          identifier,
          password,
          ...options,
        });
        setUser(result.user);
        setSession(result.session ?? null);
        return result;
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [engine]
  );

  const signUp = useCallback(
    async (options: SignUpOptions<TMetadata>) => {
      if (!engine) throw new Error('LocalAuthEngine is not initialized.');
      setError(null);
      setLoading(true);
      try {
        const result = await engine.signUp<TMetadata>(options);
        setUser(result.user);
        setSession(result.session ?? null);
        return result;
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [engine]
  );

  const signOut = useCallback(async () => {
    if (!engine) return;
    setError(null);
    setLoading(true);
    try {
      await engine.signOut();
      setUser(null);
      setSession(null);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [engine]);

  return {
    user,
    session,
    isSignedIn: Boolean(user),
    loading,
    error,
    signIn,
    signUp,
    signOut,
    refetchUser: refreshState as any,
  };
}
