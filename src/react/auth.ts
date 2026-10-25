import { useEffect, useState, useCallback } from 'react';
import type { GoogleAuthClient, GoogleUser } from '../auth/google.js';
import type { MicrosoftAuthClient, MicrosoftUser } from '../auth/microsoft.js';
import type { GitHubAuthClient, GitHubUser } from '../auth/github.js';
import type { AppleAuthClient, AppleUser, AppleNativeCredential } from '../auth/apple.js';

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
