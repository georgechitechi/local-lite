import { ExpoConfig, ConfigContext } from 'expo/config';

const APP_VARIANT = process.env.APP_VARIANT || 'production';
const IS_DEV = APP_VARIANT === 'development' || APP_VARIANT === 'dev';
const IS_PREVIEW = APP_VARIANT === 'preview';

const getUniqueIdentifier = (): string => {
  if (IS_DEV) return 'com.myapp.app.dev';
  if (IS_PREVIEW) return 'com.myapp.app.preview';
  return 'com.myapp.app';
};

const getAppName = (baseName: string = 'Example'): string => {
  if (IS_DEV) return `${baseName} Dev`;
  if (IS_PREVIEW) return `${baseName} Preview`;
  return baseName;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: getAppName(config.name || 'Example'),
  slug: config.slug || 'example',
  android: {
    ...config.android,
    package: getUniqueIdentifier(),
  },
  ios: {
    ...config.ios,
    bundleIdentifier: getUniqueIdentifier(),
  },
});
