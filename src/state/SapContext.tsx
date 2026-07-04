import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createSapClient, resolveSapConfig, type SapPsClient } from '@/sap/client';

interface SapState {
  client: SapPsClient;
  /** Recreate the client after the Integration page changes the config. */
  reconnect: () => Promise<void>;
}

const Ctx = createContext<SapState | null>(null);

export function SapProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SapPsClient | null>(null);

  const connect = useCallback(async () => {
    setClient(await createSapClient(resolveSapConfig()));
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  const value = useMemo<SapState | null>(
    () => (client ? { client, reconnect: connect } : null),
    [client, connect],
  );

  if (!value) return null; // one frame while the adapter module loads
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSap(): SapState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSap outside SapProvider');
  return ctx;
}
