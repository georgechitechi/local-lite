import { useState, useEffect, useCallback } from 'react';
import { LocalFirstClient } from '../core/client.js';

/**
 * Reactive React hook for client.kv key-value preferences.
 * Automatically re-renders whenever the key is updated or deleted.
 *
 * Example:
 * const [theme, setTheme, loading] = useKV(client, 'theme', 'light');
 */
export function useKV<T = any>(
  client: LocalFirstClient | null | undefined,
  key: string,
  defaultValue?: T
): [T | undefined, (value: T) => Promise<void>, boolean] {
  const [value, setValueState] = useState<T | undefined>(defaultValue);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!client) {
      setValueState(defaultValue);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const load = async () => {
      try {
        const val = await client.kv.get<T>(key, defaultValue);
        if (isMounted) {
          setValueState(val);
          setLoading(false);
        }
      } catch {
        if (isMounted) setLoading(false);
      }
    };

    load();

    const unsubscribe = client.events.on('_local_kv', (e: any) => {
      if (!e || e.key === key || !e.key) {
        load();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [client, key, defaultValue]);

  const setKVValue = useCallback(
    async (newValue: T) => {
      if (!client) return;
      await client.kv.set(key, newValue);
      setValueState(newValue);
    },
    [client, key]
  );

  return [value, setKVValue, loading];
}
