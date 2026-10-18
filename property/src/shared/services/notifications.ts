import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSyncClient } from '@/shared/services/sync/client';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowList: true,
  }),
});

// Request local notification permissions
export async function requestLocalNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('Must use physical device for Notifications');
    return false;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get notification permissions!');
      return false;
    }

    // Configure Android channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    return true;
  } catch (error) {
    console.log('Error initializing notifications:', error);
    return false;
  }
}

// Helper to check if notifications are enabled in app settings
export async function areNotificationsEnabled(businessId?: string): Promise<boolean> {
  try {
    const client = await getSyncClient();
    const rows = await client.findMany('settings', {
      where: businessId
        ? { business_id: businessId, setting_key: 'notification_settings' }
        : { setting_key: 'notification_settings' },
    });
    const notificationSetting = rows?.[0];
    let val = notificationSetting?.setting_value;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {}
    }
    return !!val?.enabled;
  } catch {
    return false;
  }
}

// Send dark mode notification
export async function sendDarkModeNotification(isEnabled: boolean): Promise<void> {
  const title = 'Theme Updated';
  const body = isEnabled
    ? 'Dark mode has been enabled. Your app now uses a dark theme for better viewing in low light conditions.'
    : 'Light mode has been enabled. Your app now uses a light theme for better viewing in bright conditions.';

  await sendNotification(title, body, {
    type: 'theme_change',
    isDarkMode: isEnabled,
  });
}

// Send a generic notification
export async function sendNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
): Promise<void> {
  try {
    if (!(await areNotificationsEnabled())) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
      },
      trigger: null,
    });
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

// Schedule a future reminder notification
export async function scheduleReminderNotification(
  title: string,
  body: string,
  triggerDate: Date,
  data?: Record<string, any>,
): Promise<string | undefined> {
  try {
    if (!(await areNotificationsEnabled())) {
      console.warn('Notifications are disabled in app settings.');
      return undefined;
    }

    // Ensure the date is in the future
    if (triggerDate.getTime() <= Date.now()) {
      console.warn('Cannot schedule a notification in the past.');
      return undefined;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return notificationId;
  } catch (error) {
    console.error('Error scheduling reminder notification:', error);
    return undefined;
  }
}

// Schedule a daily repeating reminder
export async function scheduleDailyReminder(
  title: string,
  body: string,
  hour: number,
  minute: number,
  data?: Record<string, any>,
): Promise<string | undefined> {
  try {
    if (!(await areNotificationsEnabled())) {
      console.warn('Notifications are disabled in app settings.');
      return undefined;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });

    return notificationId;
  } catch (error) {
    console.error('Error scheduling daily reminder notification:', error);
    return undefined;
  }
}

// Cancel a scheduled local notification
export async function cancelScheduledReminder(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    console.error('Error cancelling notification:', error);
  }
}

// Get all scheduled local notifications
export async function getAllScheduledReminders() {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('Error getting scheduled notifications:', error);
    return [];
  }
}
