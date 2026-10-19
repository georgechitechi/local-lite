import type React from 'react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Snackbar as PaperSnackbar, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  getSnackbarSnapshot,
  hideSnackbar,
  type SnackbarState,
subscribeSnackbar,
} from '@/stores/snackbarStore';

export const SnackbarProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [snackbar, setSnackbar] = useState<SnackbarState>(getSnackbarSnapshot);
  const colors = useThemeColors();

  useEffect(() => {
    return subscribeSnackbar(setSnackbar);
  }, []);

  const onPressRef = useRef<(() => void) | undefined>(undefined);
  onPressRef.current = snackbar.action?.onPress;

  const backgroundColor = (() => {
    switch (snackbar.type) {
      case 'error':
        return colors.error;
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      default:
        return colors.inverseSurface;
    }
  })();

  const textColor = (() => {
    switch (snackbar.type) {
      case 'error':
        return colors.onError;
      case 'success':
      case 'warning':
        return colors.onPrimary;
      default:
        return colors.inverseOnSurface;
    }
  })();

  return (
    <>
      {children}
      <PaperSnackbar
        visible={snackbar.visible}
        onDismiss={hideSnackbar}
        duration={snackbar.action ? 6000 : 3000}
        style={{ backgroundColor }}
      >
        <View style={{ width: '100%' }}>
          <Text style={{ color: textColor }}>{snackbar.message}</Text>
          {snackbar.action && (
            <Button
              mode="text"
              onPress={() => {
                onPressRef.current?.();
                hideSnackbar();
              }}
              textColor={textColor}
              style={{ alignSelf: 'flex-end', marginTop: 4, marginRight: -8 }}
              compact
            >
              {snackbar.action.label}
            </Button>
          )}
        </View>
      </PaperSnackbar>
    </>
  );
};

export { useSnackbar } from '@/stores/snackbarStore';

