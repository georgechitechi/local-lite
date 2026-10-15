import Constants from 'expo-constants';
import { Linking, Platform, Share } from 'react-native';

/**
 * Gets the official App Store or Google Play Store link for the app.
 */
export const getStoreUrl = (): string => {
  const androidPackageName =
    Constants.expoConfig?.android?.package || 'com.propertyadmin.manager';
  const iosAppId = (Constants.expoConfig?.extra as any)?.iosAppId;

  if (Platform.OS === 'ios' && iosAppId) {
    return `https://apps.apple.com/app/id${iosAppId}`;
  }

  return `https://play.google.com/store/apps/details?id=${androidPackageName}`;
};

/**
 * Triggers the native OS share sheet to share the app store link.
 */
export const shareApp = async (): Promise<boolean> => {
  const appName = Constants.expoConfig?.name || 'Property Admin';
  const storeUrl = getStoreUrl();
  const message = `Check out ${appName} - property & tenant management made simple!\n\nDownload: ${storeUrl}`;

  try {
    const result = await Share.share(
      {
        title: `Share ${appName}`,
        message,
        url: storeUrl,
      },
      {
        dialogTitle: `Share ${appName}`,
      },
    );

    return result.action === Share.sharedAction;
  } catch (error) {
    console.error('Error sharing app:', error);
    return false;
  }
};

/**
 * Opens the native store review page for the app.
 */
export const rateApp = async (): Promise<void> => {
  const androidPackageName =
    Constants.expoConfig?.android?.package || 'com.propertyadmin.manager';
  const iosAppId = (Constants.expoConfig?.extra as any)?.iosAppId;

  if (Platform.OS === 'ios') {
    if (iosAppId) {
      Linking.openURL(
        `itms-apps://itunes.apple.com/app/id${iosAppId}?action=write-review`,
      );
    } else {
      Linking.openURL(getStoreUrl());
    }
  } else if (Platform.OS === 'android') {
    try {
      await Linking.openURL(
        `market://details?id=${androidPackageName}&showAllReviews=true`,
      );
    } catch {
      await Linking.openURL(
        `https://play.google.com/store/apps/details?id=${androidPackageName}&showAllReviews=true`,
      );
    }
  } else {
    Linking.openURL(getStoreUrl());
  }
};
