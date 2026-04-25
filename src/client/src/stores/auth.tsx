import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type {
  AuthUser,
  AuthProfile,
  AuthSessionData,
  SignupRequest,
  LoginRequest,
  ChangePasswordRequest,
} from '@huddle/shared';
import { api } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  profile: AuthProfile | null;
  mustChangePassword: boolean;
  isLoading: boolean;
}

interface AuthActions {
  login: (req: LoginRequest) => Promise<{ ok: true } | { ok: false; error: string }>;
  signup: (req: SignupRequest) => Promise<{ ok: true } | { ok: false; error: string }>;
  changePassword: (req: ChangePasswordRequest) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  updateProfile: (profile: AuthProfile) => void;
  updateUser: (user: Partial<AuthUser>) => void;
}

type AuthContextType = AuthState & AuthActions;

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    mustChangePassword: false,
    isLoading: true,
  });

  const setAuthData = useCallback((data: AuthSessionData) => {
    setState({
      user: data.user,
      profile: data.profile,
      mustChangePassword: data.mustChangePassword,
      isLoading: false,
    });
  }, []);

  const clearAuth = useCallback(() => {
    setState({
      user: null,
      profile: null,
      mustChangePassword: false,
      isLoading: false,
    });
  }, []);

  const checkSession = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    const result = await api.get<AuthSessionData>('/api/auth/session');
    if (result.ok) {
      setAuthData(result.data);
    } else {
      clearAuth();
    }
  }, [setAuthData, clearAuth]);

  const login = useCallback(
    async (req: LoginRequest): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await api.post<AuthSessionData>('/api/auth/login', req);
      if (result.ok) {
        setAuthData(result.data);
        return { ok: true };
      }
      return { ok: false, error: result.error.message };
    },
    [setAuthData]
  );

  const signup = useCallback(
    async (req: SignupRequest): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await api.post<AuthSessionData>('/api/auth/signup', req);
      if (result.ok) {
        setAuthData(result.data);
        return { ok: true };
      }
      return { ok: false, error: result.error.message };
    },
    [setAuthData]
  );

  const changePassword = useCallback(
    async (req: ChangePasswordRequest): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await api.post<{ ok: true }>('/api/auth/change-password', req);
      if (result.ok) {
        setState((prev) => ({ ...prev, mustChangePassword: false }));
        return { ok: true };
      }
      return { ok: false, error: result.error.message };
    },
    []
  );

  const updateProfile = useCallback((profile: AuthProfile) => {
    setState((prev) => ({ ...prev, profile }));
  }, []);

  const updateUser = useCallback((partial: Partial<AuthUser>) => {
    setState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...partial } : null,
    }));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    clearAuth();
  }, [clearAuth]);

  // Auto-login on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        changePassword,
        logout,
        checkSession,
        updateProfile,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
