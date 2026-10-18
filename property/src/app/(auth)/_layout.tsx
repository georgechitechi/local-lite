import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import SPressable from '@/shared/components/SlightPressable';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function AuthLayout() {
  const router = useRouter();
  const colors = useThemeColors();
  const { isDarkMode } = useTheme();

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: {
            backgroundColor: colors.surface,
          },
          headerTintColor: colors.onSurface,
          headerTitleStyle: {
            color: colors.onSurface,
          },
        }}
      >
        <Stack.Screen
          name="privacy-policy"
          options={{
            headerShown: true,
            headerTitle: 'Privacy Policy',
            headerBackVisible: false,
            headerRight: () => (
              <SPressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(auth)/login');
                  }
                }}
                style={{ marginRight: 8 }}
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.onSurface} />
              </SPressable>
            ),
          }}
        />
        <Stack.Screen
          name="terms-of-use"
          options={{
            headerShown: true,
            headerTitle: 'Terms of Use',
            headerBackVisible: false,
            headerRight: () => (
              <SPressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(auth)/login');
                  }
                }}
                style={{ marginRight: 8 }}
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.onSurface} />
              </SPressable>
            ),
          }}
        />
      </Stack>
    </>
  );
}
