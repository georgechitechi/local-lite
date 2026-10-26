import { useState, useEffect } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { SearchQueryOptions, SearchResult } from '../search/types.js';

export interface UseSearchOptions extends SearchQueryOptions {
  /**
   * Debounce delay in milliseconds (default: 150ms).
   */
  debounceMs?: number;
}

/**
 * Reactive React hook for instant full-text search with automatic debouncing.
 *
 * Example:
 * const { results, loading, error } = useSearch(client, 'properties', searchQuery);
 */
export function useSearch<T = any>(
  client: LocalFirstClient | null | undefined,
  table: string,
  queryText: string,
  options?: UseSearchOptions
): { results: SearchResult<T>[]; loading: boolean; error: Error | null } {
  const [results, setResults] = useState<SearchResult<T>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const debounceMs = options?.debounceMs ?? 150;

  useEffect(() => {
    if (!client || !table || !queryText.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await client.search.query<T>(table, queryText, options);
        if (isMounted) {
          setResults(res);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [client, table, queryText, debounceMs]);

  return { results, loading, error };
}
