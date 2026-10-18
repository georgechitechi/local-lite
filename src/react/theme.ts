export interface SyncThemeColors {
  isDark: boolean;
  bg: string;
  surface: string;
  surfaceSubtle: string;
  card: string;
  border: string;
  borderSubtle: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  actionBg: string;
  actionText: string;
  accent: string;
}

export const darkTheme: SyncThemeColors = {
  isDark: true,
  bg: '#111827',
  surface: '#1F2937',
  surfaceSubtle: '#1F293780',
  card: '#1F2937',
  border: '#374151',
  borderSubtle: '#37415160',
  text: '#F9FAFB',
  textSecondary: '#D1D5DB',
  textMuted: '#9CA3AF',
  actionBg: '#374151',
  actionText: '#F9FAFB',
  accent: '#8B5CF6',
};

export const lightTheme: SyncThemeColors = {
  isDark: false,
  bg: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceSubtle: '#F3F4F6',
  card: '#FFFFFF',
  border: '#E5E7EB',
  borderSubtle: '#E5E7EB80',
  text: '#111827',
  textSecondary: '#374151',
  textMuted: '#6B7280',
  actionBg: '#E5E7EB',
  actionText: '#1F2937',
  accent: '#7C3AED',
};

export function resolveSyncTheme(
  themeProp?: 'auto' | 'dark' | 'light' | Partial<SyncThemeColors>,
  systemColorScheme?: 'dark' | 'light' | null
): SyncThemeColors {
  if (typeof themeProp === 'object' && themeProp !== null) {
    const base = themeProp.isDark === false ? lightTheme : darkTheme;
    return { ...base, ...themeProp } as SyncThemeColors;
  }

  const mode =
    themeProp && themeProp !== 'auto'
      ? themeProp
      : systemColorScheme === 'light'
      ? 'light'
      : 'dark';

  return mode === 'light' ? lightTheme : darkTheme;
}
