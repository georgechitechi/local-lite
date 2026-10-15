import pkg from './package.json' with { type: 'json' };

const APP_VARIANT = process.env.APP_VARIANT || 'production';
const IS_DEV = APP_VARIANT === 'development';
const IS_PREVIEW = APP_VARIANT === 'preview';

const getUniqueIdentifier = (): string => {
  if (IS_DEV) {
    return 'com.propertyadmin.dev';
  }
  if (IS_PREVIEW) {
    return 'com.propertyadmin.preview';
  }
  return 'com.propertyadmin.manager';
};

const getAppName = (): string => {
  if (IS_DEV) {
    return 'Property Dev';
  }
  if (IS_PREVIEW) {
    return 'Property Preview';
  }
  return 'Property Admin';
};

const getGoogleServicesFile = (): string => {
  return './google-services.json';
};

interface ExpoConfig {
  config?: {
    ios?: Record<string, unknown>;
    android?: Record<string, unknown>;
  };
}

const APP_VERSION = pkg.version;

export default ({ config }: ExpoConfig) => ({
  ...config,
  name: getAppName(),
  slug: 'property-admin',
  scheme: 'propertyadmin',
  version: APP_VERSION,
  description: 'Property Administration and Management',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    ...config?.ios,
    supportsTablet: true,
    bundleIdentifier: getUniqueIdentifier(),
  },
  android: {
    ...config?.android,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    softwareKeyboardLayoutMode: 'resize',
    predictiveBackGestureEnabled: false,
    package: getUniqueIdentifier(),
    googleServicesFile: getGoogleServicesFile(),
    permissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.INTERNET',
      'android.permission.READ_CONTACTS',
      'android.permission.WRITE_CONTACTS',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.SEND_SMS',
      'android.permission.READ_PHONE_STATE',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'server',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-sqlite',
    'expo-status-bar',
    'expo-secure-store',
    'expo-sharing',
    'expo-background-task',
    '@react-native-vector-icons/material-design-icons',
    [
      'expo-contacts',
      {
        contactsPermission: 'Allow $(PRODUCT_NAME) to access your contacts.',
      },
    ],
    [
      'expo-file-system',
      {
        androidDownloadDirectory: true,
        filePermission: 'Allow $(PRODUCT_NAME) to access your files.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification.png',
        color: '#ffffff',
        sounds: ['./assets/sound.mp3'],
        androidMode: 'default',
        androidCollapsedTitle: getAppName(),
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          backgroundColor: '#000000',
        },
        text: getAppName(),
      },
    ],
  ],
  extra: {
    router: {},
    eas: {
      projectId: 'd02525b1-5047-4fcf-87da-acdbce57fb0d',
    },

    variant: process.env.APP_VARIANT,
    centralUrl: process.env.EXPO_PUBLIC_CENTRAL_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    isEASBuild: process.env.EAS_BUILD === 'true',
  },

  updates: {
    url: 'https://u.expo.dev/d02525b1-5047-4fcf-87da-acdbce57fb0d',
  },

  runtimeVersion: { policy: 'appVersion' },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});



