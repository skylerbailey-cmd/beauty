import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { getMe, login as apiLogin, logout as apiLogout, User } from './api';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, userId: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

// We export this so _layout.tsx can use it to build the context provider
export function useAuthState(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) {
        setUser(null);
        return;
      }
      const me = await getMe();
      setUser(me);
    } catch {
      setUser(null);
      // Token may be expired – clear it
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('user_id');
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const login = useCallback(async (token: string, userId: string) => {
    await apiLogin(token);
    await SecureStore.setItemAsync('user_id', userId);
    setIsLoading(true);
    try {
      const me = await getMe();
      setUser(me);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refresh,
  };
}

import React from 'react';

export const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
