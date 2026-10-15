// Prevent Expo's lazy fetch polyfill from loading native modules after tests finish.
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }),
);

import 'react-native';

jest.mock('react-native-keyboard-controller', () => {
  return {
    KeyboardAwareScrollView: 'KeyboardAwareScrollView',
    KeyboardProvider: 'KeyboardProvider',
    KeyboardToolbar: 'KeyboardToolbar',
    KeyboardController: {
      setDefaultMode: jest.fn(),
      dismiss: jest.fn(),
    },
    useKeyboardController: () => ({ enabled: true }),
    useKeyboardHandler: jest.fn(),
  };
});

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(),
    getFirstSync: jest.fn(),
    getAllSync: jest.fn(),
  })),
}));


jest.mock('expo-sqlite/kv-store', () => ({}));

jest.mock('expo-notifications', () => ({
  addPushTokenListener: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

jest.mock('native-android-sms', () => ({
  canSendSmsAsync: jest.fn(async () => true),
  getAvailableSimsAsync: jest.fn(async () => [
    {
      subscriptionId: 1,
      displayName: 'SIM 1',
      carrierName: 'Safaricom',
      slotIndex: 0,
      countryIso: 'ke',
      isActive: true,
    },
  ]),
  getPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    granted: true,
    sendSms: true,
    readPhoneState: true,
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    granted: true,
    sendSms: true,
    readPhoneState: true,
  })),
  sendSmsAsync: jest.fn(async () => 'mock-sms-uuid-123'),
  sendBulkSmsAsync: jest.fn(async () => ['mock-sms-uuid-123']),
  sendBulkSmsWithProgressAsync: jest.fn(async recipients => ({
    total: recipients.length,
    successCount: recipients.length,
    failedCount: 0,
    uuids: recipients.map(() => 'mock-uuid'),
    successful: recipients.map(r => ({
      to: r.to,
      message: r.message,
      uuid: 'mock-uuid',
    })),
    failed: [],
  })),
  sendSmsUIAsync: jest.fn(async () => true),
  addSmsSentListener: jest.fn(() => ({ remove: jest.fn() })),
  addSmsDeliveredListener: jest.fn(() => ({ remove: jest.fn() })),
  sanitizeSmsText: jest.fn(text =>
    (text || '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2026]/g, '...')
      .replace(/[\u00A0]/g, ' '),
  ),
  getSmsSegmentInfo: jest.fn(text => ({
    chars: (text || '').length,
    segments: 1,
    isUnicode: false,
    limit: 160,
    remaining: 160 - (text || '').length,
  })),
  isSimActive: jest.fn(() => true),
}));
