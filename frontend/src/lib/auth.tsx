import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  addAuthExpiredListener,
  clearAuthTokens,
  devLogin,
  getMe,
  getSetupStatus,
  getStoredAccessToken,
  heartbeatLoginDevice,
  login as apiLogin,
  logout as apiLogout,
  rejectAuthRecovery,
  resolveAuthRecovery,
  setAuthTokens,
  setupAdmin,
  updateOwnProfile,
} from "@/lib/api";
import type { AuthUser } from "@/types/app";

type AuthState = {
  loading: boolean;
  reauthRequired: boolean;
  reauthMessage: string;
  setupRequired: boolean;
  user: AuthUser | null;
  permissions: Set<string>;
  login: (username: string, password: string) => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  setup: (payload: { username: string; password: string; display_name?: string }) => Promise<void>;
  updateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);
const DEVICE_HEARTBEAT_INTERVAL_MS = 60_000;
const DEV_AUTH_ENABLED = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS !== "false";
const DEV_AUTH_USERNAME = import.meta.env.VITE_DEV_AUTH_USERNAME || "dev_admin";
const DEV_AUTH_PASSWORD = import.meta.env.VITE_DEV_AUTH_PASSWORD || "Password123!";

const DEV_MOCK_USER: AuthUser = {
  id: "dev-local",
  username: DEV_AUTH_USERNAME,
  display_name: "Dev Admin",
  avatar_base64: "",
  roles: ["admin"],
  permissions: ["*"],
  page_permissions: {},
  is_active: true,
  created_at: null,
  updated_at: null,
  last_login_at: null,
};

async function tryDevAuth(setupRequired: boolean) {
  if (!DEV_AUTH_ENABLED) return null;
  try {
    return await devLogin();
  } catch {
    // 后端开发登录未启用时，继续尝试首次初始化或固定开发账号登录。
  }

  if (setupRequired) {
    try {
      return await setupAdmin({
        username: DEV_AUTH_USERNAME,
        password: DEV_AUTH_PASSWORD,
        display_name: "Dev Admin",
      });
    } catch {
      return null;
    }
  }

  try {
    return await apiLogin({ username: DEV_AUTH_USERNAME, password: DEV_AUTH_PASSWORD });
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthMessage, setReauthMessage] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const setup = await getSetupStatus();
        if (!mounted) return;
        const devTokens = await tryDevAuth(setup.setup_required);
        if (!mounted) return;
        if (devTokens) {
          setAuthTokens(devTokens);
          setSetupRequired(false);
          setUser(devTokens.user);
          resolveAuthRecovery();
          return;
        }
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
          if (DEV_AUTH_ENABLED) {
            setSetupRequired(false);
            setUser(DEV_MOCK_USER);
            return;
          }
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

  useEffect(() => addAuthExpiredListener((message) => {
    if (userRef.current) {
      setReauthMessage(message);
      setReauthRequired(true);
    } else {
      setUser(null);
      rejectAuthRecovery(message);
    }
  }), []);

  useEffect(() => {
    if (!user) return undefined;
    let disposed = false;
    let timer: number | undefined;

    async function sendHeartbeat() {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        await heartbeatLoginDevice();
      } catch {
        // 心跳只维护设备活跃状态；认证失效由统一请求恢复流程处理。
      }
    }

    void sendHeartbeat();
    timer = window.setInterval(() => void sendHeartbeat(), DEVICE_HEARTBEAT_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void sendHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user?.id]);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);

  const value = useMemo<AuthState>(() => ({
    loading,
    reauthRequired,
    reauthMessage,
    setupRequired,
    user,
    permissions,
    async login(username: string, password: string) {
      const tokens = await apiLogin({ username, password });
      setAuthTokens(tokens);
      setReauthRequired(false);
      setReauthMessage("");
      setSetupRequired(false);
      setUser(tokens.user);
      resolveAuthRecovery();
    },
    async reauthenticate(password: string) {
      if (!user) throw new Error("Authentication required");
      const tokens = await apiLogin({ username: user.username, password });
      if (tokens.user.id !== user.id) {
        clearAuthTokens();
        setUser(null);
        rejectAuthRecovery("Please sign in with the same account to continue");
        throw new Error("Please sign in with the same account to continue");
      }
      setAuthTokens(tokens);
      setReauthRequired(false);
      setReauthMessage("");
      setSetupRequired(false);
      setUser(tokens.user);
      resolveAuthRecovery();
    },
    async setup(payload) {
      const tokens = await setupAdmin(payload);
      setAuthTokens(tokens);
      setReauthRequired(false);
      setReauthMessage("");
      setSetupRequired(false);
      setUser(tokens.user);
      resolveAuthRecovery();
    },
    async updateProfile(payload) {
      const nextUser = await updateOwnProfile(payload);
      setUser(nextUser);
      return nextUser;
    },
    async logout() {
      await apiLogout();
      setReauthRequired(false);
      setReauthMessage("");
      setUser(null);
      rejectAuthRecovery();
    },
    can(permission: string) {
      return permissions.has("*") || permissions.has(permission);
    },
  }), [loading, permissions, reauthMessage, reauthRequired, setupRequired, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
