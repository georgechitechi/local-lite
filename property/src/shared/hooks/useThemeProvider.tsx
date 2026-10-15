import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { CustomTheme, ThemeColors, ThemeMode } from '@/stores/themeStore';
import {
  getCustomTheme,
  loadStoredThemeMode,
  persistThemeMode,
} from '@/stores/themeStore';

export type { CustomTheme, ThemeColors, ThemeMode };

export interface ThemeContextValue {
  isDarkMode: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;
  theme: CustomTheme;
  colors: ThemeColors;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('auto');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    loadStoredThemeMode().then((storedMode) => {
      if (mounted) {
        setThemeModeState(storedMode);
        setIsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isDarkMode = useMemo(() => {
    if (themeMode === 'auto') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  const theme = useMemo(() => getCustomTheme(isDarkMode), [isDarkMode]);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      const computedIsDark = mode === 'auto' ? systemColorScheme === 'dark' : mode === 'dark';
      persistThemeMode(mode, computedIsDark);
    },
    [systemColorScheme]
  );

  const setDarkMode = useCallback(
    (isDark: boolean) => {
      const mode: ThemeMode = isDark ? 'dark' : 'light';
      setThemeMode(mode);
    },
    [setThemeMode]
  );

  const toggleDarkMode = useCallback(() => {
    setDarkMode(!isDarkMode);
  }, [isDarkMode, setDarkMode]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      isDarkMode,
      themeMode,
      setThemeMode,
      toggleDarkMode,
      setDarkMode,
      theme,
      colors: theme.colors,
      isLoading,
    }),
    [isDarkMode, themeMode, setThemeMode, toggleDarkMode, setDarkMode, theme, isLoading]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    const fallbackTheme = getCustomTheme(false);
    return {
      isDarkMode: false,
      themeMode: 'auto',
      setThemeMode: () => {},
      toggleDarkMode: () => {},
      setDarkMode: () => {},
      theme: fallbackTheme,
      colors: fallbackTheme.colors,
      isLoading: false,
    };
  }
  return context;
};

export const useThemeColors = (): ThemeColors => {
  const { colors } = useTheme();
  return colors;
};
