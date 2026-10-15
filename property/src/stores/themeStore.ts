import Storage from 'expo-sqlite/kv-store';
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';
import { sendDarkModeNotification } from '@/shared/services/notifications';

export type ThemeMode = 'auto' | 'light' | 'dark';

export type ThemeColors = MD3Theme['colors'] & {
  success: string;
  warning: string;
  info: string;
  successContainer: string;
  warningContainer: string;
  infoContainer: string;
  onSuccessContainer: string;
  onWarningContainer: string;
  onInfoContainer: string;
  errorContainerBorder: string;
  warningContainerBorder: string;
};

export interface CustomTheme extends MD3Theme {
  colors: ThemeColors;
}

export const getCustomTheme = (isDark: boolean): CustomTheme => {
  const baseTheme = isDark ? MD3DarkTheme : MD3LightTheme;

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: isDark ? '#121212' : '#F5F5F5',
      success: isDark ? '#4CAF50' : '#4CAF50',
      warning: isDark ? '#FFB74D' : '#FF9800',
      info: isDark ? '#64B5F6' : '#2196F3',
      error: isDark ? '#F44336' : '#F44336',
      successContainer: isDark ? '#1B2D1B' : '#E8F5E8',
      warningContainer: isDark ? '#2D1B1B' : '#FFF3E0',
      infoContainer: isDark ? '#0D1B2D' : '#E3F2FD',
      onSuccessContainer: isDark ? '#C8E6C9' : '#1B5E20',
      onWarningContainer: isDark ? '#FFE0B2' : '#E65100',
      onInfoContainer: isDark ? '#BBDEFB' : '#0D47A1',
      errorContainerBorder: isDark ? '#5D2A2A' : '#FFCDD2',
      warningContainerBorder: isDark ? '#5D2A2A' : '#FFE0B2',
    },
  };
};

export const loadStoredThemeMode = async (): Promise<ThemeMode> => {
  try {
    const storedMode = await Storage.getItem('themeMode');
    if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'auto') {
      return storedMode;
    }
    return 'auto';
  } catch (error) {
    console.error('Error loading theme preference:', error);
    return 'auto';
  }
};

export const persistThemeMode = async (mode: ThemeMode, isDark: boolean): Promise<void> => {
  try {
    await Storage.setItem('themeMode', mode);
    sendDarkModeNotification(isDark);
  } catch (error) {
    console.error('Error saving theme preference:', error);
  }
};
