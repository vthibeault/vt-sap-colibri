import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthActivity, AuthObject, SapUser } from '@/sap/types';
import { authorityCheck } from '@/sap/auth';
import { useSap } from './SapContext';

interface AuthState {
  user: SapUser | null;
  /** True while restoring a persisted session on first load. */
  restoring: boolean;
  login: (personaId: string) => Promise<void>;
  logout: () => void;
  /** SAP-style authority check for the logged-on user. */
  can: (object: AuthObject, activity: AuthActivity) => boolean;
}

const Ctx = createContext<AuthState | null>(null);
const SESSION_KEY = 'colibri.persona';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { client } = useSap();
  const [user, setUser] = useState<SapUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const persisted = sessionStorage.getItem(SESSION_KEY);
    if (!persisted) {
      setRestoring(false);
      return;
    }
    client
      .getCurrentUser(persisted)
      .then(setUser)
      .finally(() => setRestoring(false));
  }, [client]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      restoring,
      login: async (personaId) => {
        const u = await client.getCurrentUser(personaId);
        sessionStorage.setItem(SESSION_KEY, personaId);
        setUser(u);
      },
      logout: () => {
        sessionStorage.removeItem(SESSION_KEY);
        setUser(null);
      },
      can: (object, activity) => authorityCheck(user, object, activity),
    }),
    [user, restoring, client],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
