import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { TOKEN_KEY } from "../api/client";
import { login as apiLogin } from "../api/services";
import type { UserRole } from "../types";

interface AuthState {
  username: string;
  role: UserRole;
  full_name?: string | null;
}

interface AuthContextValue {
  user: AuthState | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isPrivileged: boolean; // Service Admin or Service Engineer (can write)
  hasOrgScope: boolean;  // + Managing Director (org-wide read-only)
  isAdmin: boolean;
  canEditTasks: boolean; // Admin/Engineer/Technician (not Helper)
}

const AUTH_KEY = "st_auth";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(AUTH_KEY);
    const token = localStorage.getItem(TOKEN_KEY);
    if (raw && token) setUser(JSON.parse(raw));
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const t = await apiLogin(username, password);
    localStorage.setItem(TOKEN_KEY, t.access_token);
    const state: AuthState = { username: t.username, role: t.role, full_name: t.full_name };
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    setUser(state);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_KEY);
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.role;
    // isPrivileged gates WRITES — Managing Director is deliberately excluded (read-only).
    const isPrivileged = role === "Service Admin" || role === "Service Engineer";
    // hasOrgScope gates org-wide READ views (dashboard, WIP reports, escalations).
    const hasOrgScope = isPrivileged || role === "Managing Director";
    return {
      user,
      loading,
      login,
      logout,
      isPrivileged,
      hasOrgScope,
      isAdmin: role === "Service Admin",
      canEditTasks: isPrivileged || role === "Technician",
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
