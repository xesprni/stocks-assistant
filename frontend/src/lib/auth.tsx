import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  clearAuthTokens,
  getMe,
  getSetupStatus,
  getStoredAccessToken,
  login as apiLogin,
  logout as apiLogout,
  setAuthTokens,
  setupAdmin,
} from "@/lib/api";
import type { AuthUser } from "@/types/app";

type AuthState = {
  loading: boolean;
  setupRequired: boolean;
  user: AuthUser | null;
  permissions: Set<string>;
  login: (username: string, password: string) => Promise<void>;
  setup: (payload: { username: string; password: string; display_name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const setup = await getSetupStatus();
        if (!mounted) return;
        setSetupRequired(setup.setup_required);
        if (setup.setup_required) {
          clearAuthTokens();
          setUser(null);
          return;
        }
        if (getStoredAccessToken()) {
          const me = await getMe();
          if (mounted) setUser(me);
        }
      } catch {
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);

  const value = useMemo<AuthState>(() => ({
    loading,
    setupRequired,
    user,
    permissions,
    async login(username: string, password: string) {
      const tokens = await apiLogin({ username, password });
      setAuthTokens(tokens);
      setSetupRequired(false);
      setUser(tokens.user);
    },
    async setup(payload) {
      const tokens = await setupAdmin(payload);
      setAuthTokens(tokens);
      setSetupRequired(false);
      setUser(tokens.user);
    },
    async logout() {
      await apiLogout();
      setUser(null);
    },
    can(permission: string) {
      return permissions.has("*") || permissions.has(permission);
    },
  }), [loading, permissions, setupRequired, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
