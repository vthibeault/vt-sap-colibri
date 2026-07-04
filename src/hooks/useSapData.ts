import { useCallback, useEffect, useRef, useState } from 'react';
import { useSap } from '@/state/SapContext';
import type { SapPsClient } from '@/sap/client';

interface SapDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetch through the SAP client with loading/error state. `fetcher` must be
 * stable with respect to `deps` (it is re-run when they change).
 */
export function useSapData<T>(
  fetcher: (client: SapPsClient) => Promise<T>,
  deps: unknown[] = [],
): SapDataState<T> {
  const { client } = useSap();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetcherRef
      .current(client)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
